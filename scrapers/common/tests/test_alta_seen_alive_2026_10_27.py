"""Alta: the post's OWN REST record is the liveness oracle (2026-10-27).

Alta read 0% verified (7 active, never one stamped) and had NO prune at all: a post that left the REST
list stayed on screen for ever. Measured that day:
  GET alta.com.sa/wp-json/wp/v2/estate_property/<wp_id>
    live post    → 200 JSON, id = wp_id, status «publish», property_status [133] (متاح)
    deleted id   → 404 {"code": "rest_post_invalid_id", ...}
  property_status terms: 133 متاح · 157 تم البيع · 134 / 158 the other measured terms.
"""
from __future__ import annotations

import ast
import json
import pathlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alta import run as ALT  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402

TAX = {"property_status": {133: "متاح", 157: "تم البيع", 134: "تم التأجير", 158: "غير متاح"}}
PID, SLUG = 25759, "synthetic-live"
AD = ALT._ad_number({"id": PID, "slug": SLUG})
CPID, CSLUG = 24864, "synthetic-control"
CTRL = ALT._ad_number({"id": CPID, "slug": CSLUG})
GONE_404 = json.dumps({"code": "rest_post_invalid_id", "message": "رقم المقالة خاطئ.", "data": {"status": 404}})


def _rec(pid=PID, slug=SLUG, status="publish", statuses=(133,)):
    return json.dumps({"id": pid, "slug": slug, "status": status, "property_status": list(statuses)})


def test_signal_measured_shapes():
    s = ALT._signal_for(PID, AD, TAX)
    assert s(200, _rec(), False) == "live"
    assert s(200, _rec(statuses=()), False) == "live", "no status term: the source states nothing (crawl keeps it active)"
    assert s(404, GONE_404, False) == "gone"
    assert s(200, _rec(statuses=(157,)), False) == "gone", "تم البيع on its own record"
    assert s(200, _rec(statuses=(158,)), False) == "gone", "غير متاح on its own record"
    assert s(200, _rec(status="draft"), False) == "gone"
    assert s(200, _rec(statuses=(999,)), False) is None, "a status the map cannot name is no answer"
    assert s(200, _rec(pid=CPID), False) is None, "another post's record"
    assert s(200, _rec(slug="someone-else"), False) is None, "a slug that is not this row's ad_number"
    assert s(401, json.dumps({"code": "rest_forbidden"}), False) is None
    assert s(404, "<html>Not Found</html>", False) is None
    assert s(500, "", False) is None


def _probe(monkeypatch, answers: dict):
    def fetch(self, url):
        got = answers.get(int(url.rsplit("/", 1)[-1]))
        if isinstance(got, Exception):
            return None, "", False
        return got
    monkeypatch.setattr(LivenessProbe, "fetch", fetch)


def _vg(control=CTRL, lookup=lambda ad: None):
    return ALT._make_verify_gone(lambda: None, TAX, {AD: PID, CTRL: CPID}, control, wp_id_lookup=lookup)


def test_live_and_gone_with_a_live_control(monkeypatch):
    _probe(monkeypatch, {PID: (404, GONE_404, False), CPID: (200, _rec(CPID, CSLUG), False)})
    assert _vg()(AD)[0] == "gone"
    assert _vg()(CTRL)[0] == "live"


def test_removal_withheld_without_a_live_control(monkeypatch):
    _probe(monkeypatch, {PID: (404, GONE_404, False), CPID: (503, "busy", False)})
    verdict, why = _vg()(AD)
    assert verdict == "unknown" and "withheld" in why
    assert _vg(control=None)(AD)[0] == "unknown"


def test_unknown_reads_never_kill(monkeypatch):
    for answer in ((403, "Forbidden", False), (429, "slow down", False), (500, "x", False), TimeoutError()):
        _probe(monkeypatch, {PID: answer, CPID: (200, _rec(CPID, CSLUG), False)})
        assert _vg()(AD)[0] == "unknown"


def test_an_unseen_row_is_read_through_its_stored_wp_id(monkeypatch):
    other_ad = ALT._ad_number({"id": 777, "slug": "gone-post"})
    _probe(monkeypatch, {777: (404, GONE_404, False), CPID: (200, _rec(CPID, CSLUG), False)})
    vg = ALT._make_verify_gone(lambda: None, TAX, {CTRL: CPID}, CTRL,
                               wp_id_lookup=lambda ad: 777 if ad == other_ad else None)
    assert vg(other_ad)[0] == "gone"
    assert vg("ALT123")[0] == "unknown", "no stored wp_id → nothing to read → UNKNOWN"


def test_run_wires_the_oracle_into_prune_and_the_seen_stamp():
    tree = ast.parse(pathlib.Path(ALT.__file__).read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    prunes = [c for c in calls if c.func.attr == "prune_unseen"]
    assert prunes and all("verify_gone" in {k.arg for k in c.keywords} for c in prunes)
    assert any(c.func.attr == "stamp_seen_alive" for c in calls)


def test_ad_number_is_unchanged_by_the_refactor():
    import hashlib
    p = {"id": 5, "slug": "x-y"}
    assert ALT._ad_number(p) == f"ALT{int(hashlib.md5(b'x-y').hexdigest()[:12], 16)}"
