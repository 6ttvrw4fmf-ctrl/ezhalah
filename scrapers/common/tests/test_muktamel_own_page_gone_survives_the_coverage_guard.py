"""muktamel: a page read as removed is a direct reading the coverage guard must not discard (2026-10-07).

Every run read ~212 pages as redirect_404, but the prune's coverage guard (re-saw 488 of 618, floor
80%) threw them away, so ~575 active rows sat at 3-19 strikes, unseen since 2026-09-03, still shown.
"""
from __future__ import annotations

from scrapers.muktamel import run as R


def test_split_strikes_only_ids_read_gone():
    struck, kept = R.split_read_gone(["MK1", "MK2", "MK3", "bogus"], {2, 9})
    assert struck == ["MK2"]
    assert kept == {"MK1", "MK3", "bogus"}, "unread and not-available rows are kept (UNKNOWN)"


def test_nothing_read_gone_strikes_nothing():
    assert R._strike_read_gone("t", set(), 1, 0) == 0


def test_strike_reruns_the_prune_with_only_read_gone_rows_unseen(monkeypatch):
    calls = {}

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = [{"ad_number": "MK1"}, {"ad_number": "MK2"}, {"ad_number": "MK3"}]

    monkeypatch.setattr(R.db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(R.db, "_execute", lambda q, what="": _Res())

    def fake_prune(tbl, seen, **kw):
        calls["seen"], calls["kw"] = seen, kw
        return 1
    monkeypatch.setattr(R.db, "prune_unseen", fake_prune)
    assert R._strike_read_gone("muktamel_residential_listings", {2}, 4, 1) == 1
    assert calls["seen"] == {"MK1", "MK3"}
    assert calls["kw"]["verify_gone"] == R._probe.verify_gone, "a kill still re-reads behind the canary"
    assert calls["kw"]["shards"] == 4 and calls["kw"]["shard"] == 1
    assert calls["kw"]["min_coverage"] == 0.0, "every unseen row here was read gone: no absence floor"


def test_fetch_records_redirect_404_as_read_gone_and_not_available_as_nothing():
    src = open(R.__file__, encoding="utf-8").read()
    assert '_note_gone(listing_id, "redirect_404")' in src
    assert '_note_gone(listing_id, "dead_404")' in src
    # 2026-10-09 (armed): the hollow shell on this id's OWN page is a read-gone strike; on another
    # page, or the rest of the not-available disjunction, it is still only counted (UNKNOWN).
    assert '_note("hollow_shell" if _is_hollow_offer(offer) else "not_available_or_zero_price")' in src, \
        "not-available stays UNKNOWN"
    assert "if HOLLOW_SHELL_KILLS and own and _is_hollow_offer(offer):" in src
    assert '_note_gone(listing_id, "hollow_shell")' in src
    assert "n = _strike_read_gone(tbl, set(_read_gone_ids), args.shards, args.shard)" in src


# ── 2026-10-08: the hollow shell (isAvailable false AND price null), shadow first ────────────────
class _Resp:
    def __init__(self, status, url, text):
        self.status_code, self.url, self.text = status, url, text


def _probe_with(monkeypatch, landed, offer, kills):
    monkeypatch.setattr(R, "HOLLOW_SHELL_KILLS", kills)
    monkeypatch.setattr(R, "_extract_nuxt", lambda body: "src" if offer is not None else None)
    monkeypatch.setattr(R, "_nuxt_via_node", lambda src: {"offer": offer})
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_canary", lambda: (True, "control live"))

    class _S:
        def get(self, url, timeout=None, allow_redirects=True):
            return _Resp(200, landed, "<html>" + "x" * 3000 + "</html>")
    return R._MuktamelProbe(platform="muktamel", signal=R._liveness_signal, session=lambda: _S(),
                            url_for=lambda ad: f"{R.BASE}/real-estates/{ad[2:]}", canary=R._canary)


HOLLOW = {"isAvailable": False, "price": None}
OWN = "https://muktamel.com/real-estates/123/شقة"


def test_hollow_shell_in_shadow_is_unknown_but_says_what_it_would_do(monkeypatch):
    v, why = _probe_with(monkeypatch, OWN, HOLLOW, kills=False).verify_gone("MK123")
    assert v == "unknown" and why.startswith("SHADOW hollow_shell")


def test_hollow_shell_once_armed_is_gone(monkeypatch):
    assert _probe_with(monkeypatch, OWN, HOLLOW, kills=True).verify_gone("MK123")[0] == "gone"


def test_only_the_conjunction_on_this_listings_own_page_is_gone(monkeypatch):
    for offer in ({"isAvailable": True, "price": None}, {"isAvailable": False, "price": 0},
                  {"isAvailable": True, "price": 500000}, None):
        v, why = _probe_with(monkeypatch, OWN, offer, kills=True).verify_gone("MK123")
        assert v == "unknown", offer
        v, why = _probe_with(monkeypatch, OWN, offer, kills=False).verify_gone("MK123")
        assert "SHADOW" not in why, offer
    other = "https://muktamel.com/real-estates/999/شقة"
    assert _probe_with(monkeypatch, other, HOLLOW, kills=True).verify_gone("MK123")[0] == "unknown"
    assert "SHADOW" not in _probe_with(monkeypatch, other, HOLLOW, kills=False).verify_gone("MK123")[1]


def test_armed_after_the_shadow_night():
    assert R.HOLLOW_SHELL_KILLS is True


# ── 2026-10-09: the double-check and the dead-visible score read muktamel like its oracle ─────────
def _verdict_with(monkeypatch, status, landed, offer, kills=True):
    monkeypatch.setattr(R, "HOLLOW_SHELL_KILLS", kills)
    monkeypatch.setattr(R, "_extract_nuxt", lambda body: "src" if offer is not None else None)
    monkeypatch.setattr(R, "_nuxt_via_node", lambda src: {"offer": offer})

    class _S:
        def get(self, url, timeout=None, allow_redirects=True):
            return _Resp(status, landed, "<html/>")
    monkeypatch.setattr(R, "_session", lambda: _S())
    return R.page_verdict("https://www.muktamel.com/real-estates/123")


def test_page_verdict(monkeypatch):
    from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN
    live = {"isAvailable": True, "price": 500000}
    assert _verdict_with(monkeypatch, 200, OWN, live) == ALIVE
    assert _verdict_with(monkeypatch, 200, OWN, HOLLOW) == DEAD
    assert _verdict_with(monkeypatch, 200, OWN, HOLLOW, kills=False) == UNKNOWN
    assert _verdict_with(monkeypatch, 200, "https://www.muktamel.com/404", None) == DEAD
    assert _verdict_with(monkeypatch, 404, OWN, None) == DEAD
    assert _verdict_with(monkeypatch, 500, OWN, live) == UNKNOWN
    assert _verdict_with(monkeypatch, 200, "https://muktamel.com/real-estates/999/x", live) == UNKNOWN
    assert _verdict_with(monkeypatch, 200, "https://muktamel.com/real-estates/999/x", HOLLOW) == UNKNOWN
    assert _verdict_with(monkeypatch, 200, OWN, {"isAvailable": False, "price": 0}) == UNKNOWN
    assert _verdict_with(monkeypatch, 200, OWN, None) == UNKNOWN


def test_spot_check_and_dead_visible_use_it_not_status_only():
    from scrapers.common import lifecycle_spot_check as L
    assert L._reader_for("muktamel") is R.page_verdict
