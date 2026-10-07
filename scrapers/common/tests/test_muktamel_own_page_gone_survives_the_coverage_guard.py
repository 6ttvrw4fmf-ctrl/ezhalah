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


def test_fetch_records_redirect_404_as_read_gone_and_not_available_as_nothing():
    src = open(R.__file__, encoding="utf-8").read()
    assert '_note_gone(listing_id, "redirect_404")' in src
    assert '_note_gone(listing_id, "dead_404")' in src
    assert '_note("not_available_or_zero_price")' in src, "not-available stays UNKNOWN"
    assert "n = _strike_read_gone(tbl, set(_read_gone_ids), args.shards, args.shard)" in src
