"""Holoul: the unit's OWN API record is the liveness oracle (2026-10-27).

Holoul read 0% verified (30 active, never one stamped): the crawl re-reads the whole units feed every
night, so no row ever reached grace, and prune_unseen had no oracle at all. Measured that day:
  GET app.holoul.io/customer/api/v1/units/<uuid>   (no trailing slash)
    live unit     → 200 JSON, id = uuid, status «listed», project.status «listed», licence present
    missing uuid  → 404 JSON {"error": ["unit__not_found"]}
    with a trailing slash, ANY uuid → 404 HTML «Not Found» (a route miss, never an answer)
"""
from __future__ import annotations

import ast
import json
import pathlib

import scrapers.holoul.run as R
from scrapers.common.http_liveness import LivenessProbe

UID = "4b099997-83f9-4164-911f-84c7403c9ed4"
AD = f"HLL{UID}"
CTRL_UID = "36dc750f-87e2-45c6-902c-fd3c433f7f62"
CTRL = f"HLL{CTRL_UID}"
ROUTE_MISS = ("\n<!doctype html>\n<html lang=\"en\">\n<head>\n  <title>Not Found</title>\n</head>\n"
              "<body>\n  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>\n"
              "</body>\n</html>\n")


def _rec(uid=UID, unit="listed", project="listed", lic="7201234567"):
    return json.dumps({"id": uid, "status": unit, "nhc_ad_license_number": lic,
                       "nhc_end_at": 1764460800000, "project": {"status": project}})


def test_signal_measured_shapes():
    s = R._signal_for(UID)
    assert s(200, _rec(), False) == "live"
    assert s(404, json.dumps({"error": ["unit__not_found"]}), False) == "gone"
    assert s(200, _rec(unit="sold"), False) == "gone", "the source unlisted the unit"
    assert s(200, _rec(project="draft"), False) == "gone", "the source unlisted the project"
    assert s(404, ROUTE_MISS, False) is None, "a route-miss HTML 404 is never a removal"
    assert s(200, _rec(uid=CTRL_UID), False) is None, "another unit's record says nothing about this one"
    assert s(200, _rec(lic=None), False) is None
    assert s(403, "Forbidden", False) is None
    assert s(500, "", False) is None
    assert s(200, json.dumps({"id": UID}), False) is None, "no status fields → no answer"


def test_nhc_end_at_is_not_read():
    """Owner decision 2026-10-02: every kept row carries a past nhc_end_at and the site ignores it."""
    assert R._signal_for(UID)(200, _rec(), False) == "live"


def _probe(monkeypatch, answers: dict):
    def fetch(self, url):
        uid = url.rsplit("/", 1)[-1]
        got = answers.get(uid)
        if isinstance(got, Exception):
            return None, "", False
        return got
    monkeypatch.setattr(LivenessProbe, "fetch", fetch)


def test_verify_gone_live_and_gone_with_a_live_control(monkeypatch):
    _probe(monkeypatch, {UID: (404, json.dumps({"error": ["unit__not_found"]}), False),
                         CTRL_UID: (200, _rec(uid=CTRL_UID), False)})
    vg = R._make_verify_gone(lambda: None, CTRL)
    assert vg(AD)[0] == "gone"
    assert vg(CTRL)[0] == "live"


def test_removal_withheld_when_the_control_does_not_read_live(monkeypatch):
    _probe(monkeypatch, {UID: (404, json.dumps({"error": ["unit__not_found"]}), False),
                         CTRL_UID: (503, "upstream", False)})
    verdict, why = R._make_verify_gone(lambda: None, CTRL)(AD)
    assert verdict == "unknown" and "withheld" in why
    assert R._make_verify_gone(lambda: None, None)(AD)[0] == "unknown", "no control → no removal"


def test_unknown_reads_never_kill(monkeypatch):
    for answer in ((403, "Forbidden", False), (500, "err", False), TimeoutError(), (404, ROUTE_MISS, False)):
        _probe(monkeypatch, {UID: answer, CTRL_UID: (200, _rec(uid=CTRL_UID), False)})
        assert R._make_verify_gone(lambda: None, CTRL)(AD)[0] == "unknown"
    assert R._make_verify_gone(lambda: None, CTRL)("HLLnot-a-uuid")[0] == "unknown"


def test_run_wires_the_oracle_into_prune_and_the_seen_stamp():
    tree = ast.parse(pathlib.Path(R.__file__).read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    prunes = [c for c in calls if c.func.attr == "prune_unseen"]
    assert prunes and all("verify_gone" in {k.arg for k in c.keywords} for c in prunes)
    assert any(c.func.attr == "stamp_seen_alive" for c in calls)
