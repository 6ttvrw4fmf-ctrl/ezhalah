"""A soft-dead site is re-checked for deletion by ITS OWN oracle, never by its listing page (2026-09-29).

On aqargate, souq24, hajer, eaqartabuk (and more) a removed ad's listing_url still answers 200 — an SPA
shell, a redirect to the home page, a sold badge — so the page-body check calls a dead ad LIVE and
cleanup would reactivate it. `PLATFORMS[site]["oracle"] = True` makes cleanup ask the same
verify_gone fleet_liveness reads every day. Fake client + fake oracle: no network, no database.

    python -m pytest scrapers/common/tests/test_cleanup_site_oracle.py -q
"""
from __future__ import annotations

import sys
import types

import scrapers.common.cleanup as C
import scrapers.common.fleet_liveness as F
from scrapers.common.tests.test_cleanup import POL, _cand, _install

ANSWERS: dict[str, tuple[str, str]] = {}
_mod = types.ModuleType("fake_site_oracle")
_mod.verify_gone = lambda ad: ANSWERS.get(ad, ("unknown", "no answer"))
sys.modules["fake_site_oracle"] = _mod


def _oracle_site(mp, rows, answers, **pol):
    ANSWERS.clear()
    ANSWERS.update(answers)
    mp.setitem(C.PLATFORMS, "orp", {"tables": ["orp_listings"], "oracle": True, "controls": True})
    mp.setitem(F.SITES, "orp", "fake_site_oracle:verify_gone")
    return _install(rows, POL(**pol), probe=lambda url: (200, "an SPA shell that looks the same dead or alive"),
                    platform="orp", tables=("orp_listings",), dead_marker=None)


def _live_control(i):
    return {"id": i, "ad_number": f"A{i}", "listing_url": f"http://x/{i}", "missing_count": 0,
            "last_seen_at": "2999-01-01T00:00:00+00:00", "active": True}


CONTROLS = [_live_control(100 + i) for i in range(5)]
CONTROLS_LIVE = {f"A{100 + i}": ("live", "status=publish") for i in range(5)}


def test_oracle_gone_deletes_although_the_page_answers_200(monkeypatch):
    c = _oracle_site(monkeypatch, {"orp_listings": [_cand(1)] + CONTROLS}, {"A1": ("gone", "status=expired"), **CONTROLS_LIVE})
    s = C.run("orp", force=True)
    assert s["aborted"] is False and s["deleted"] == 1 and c.deleted["orp_listings"] == [1]
    ev = c.inserted["cleanup_deletion_log"][0][0]["reason"]["evidence"]
    assert "status=expired" in ev                      # the ledger names the oracle's own reason


def test_oracle_live_reactivates_and_unknown_skips_never_deleting(monkeypatch):
    c = _oracle_site(monkeypatch, {"orp_listings": [_cand(1), _cand(2)] + CONTROLS},
                     {"A1": ("live", "status=publish"), **CONTROLS_LIVE})   # A2 unanswered → unknown
    s = C.run("orp", force=True)
    assert s["deleted"] == 0 and c.deleted == {}
    assert s["reactivated"] == 1 and s["skipped"] == 1


def test_controls_that_do_not_read_live_through_the_oracle_delete_nothing(monkeypatch):
    c = _oracle_site(monkeypatch, {"orp_listings": [_cand(1)] + CONTROLS}, {"A1": ("gone", "status=expired")})
    s = C.run("orp", force=True)                        # controls answer unknown → the run is void
    assert s["aborted"] is True and "known-live controls failed" in s["abort_reason"]
    assert c.deleted == {}


def test_a_retired_sibling_copy_is_never_revived_by_its_live_twin(monkeypatch):
    twin = dict(_live_control(7), ad_number="A1")                 # the same ad, live in the other table
    c = _oracle_site(monkeypatch, {"orp_listings": [_cand(1)] + CONTROLS, "orp_other": [twin]},
                     {"A1": ("live", "status=publish"), **CONTROLS_LIVE})
    C.PLATFORMS["orp"]["tables"] = ["orp_listings", "orp_other"]
    s = C.run("orp", force=True)
    assert s["reactivated"] == 0 and s["skipped"] == 1 and c.deleted == {}
    assert not c.updated.get("orp_listings")


def test_every_oracle_site_has_the_daily_checks_oracle():
    real = {p for p, r in C.PLATFORMS.items() if r.get("oracle")}
    assert {"aqargate", "eaqartabuk", "hajer", "souq24"} <= real
    assert not [p for p in real if p not in F.SITES], "an oracle site cleanup cannot resolve"
