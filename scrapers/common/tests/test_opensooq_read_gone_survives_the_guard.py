"""opensooq: an own-page «gone» reading must survive the prune guard (2026-10-12).

27 of 97 ads read «هذا الإعلان غير متوفر» on their own pages on four fleet shadow runs, but the crawl's
prune guard (re-saw 49 of 72) threw the whole prune away every night, so they stayed shown.
"""
from __future__ import annotations

from scrapers.opensooq import run as R


def _wire(monkeypatch, rows):
    calls = {}

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = rows

    monkeypatch.setattr(R.db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(R.db, "_execute", lambda q, what="": _Res())

    def fake_prune(tbl, seen, **kw):
        calls["seen"], calls["kw"] = set(seen), kw
        return len(rows) - len(seen)
    monkeypatch.setattr(R.db, "prune_unseen", fake_prune)
    return calls


def test_only_ads_read_gone_are_struck_unknown_and_live_are_kept(monkeypatch):
    rows = [{"ad_number": f"OSQ{i}", "last_seen_at": f"2026-10-0{i}"} for i in range(1, 6)]
    calls = _wire(monkeypatch, rows)
    verdicts = {"OSQ3": ("gone", "archive"), "OSQ4": ("unknown", "blocked"), "OSQ5": ("live", "200")}
    n = R._strike_read_gone(R.RES_TABLE, {"OSQ1", "OSQ2"}, lambda ad: verdicts[ad])
    assert n == 1
    assert calls["seen"] == {"OSQ1", "OSQ2", "OSQ4", "OSQ5"}, "UNKNOWN is never a strike"
    assert calls["kw"]["min_coverage"] == 0.0
    assert calls["kw"]["source"] == R.SOURCE


def test_nothing_read_gone_calls_no_prune(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "OSQ1", "last_seen_at": None}])
    assert R._strike_read_gone(R.RES_TABLE, set(), lambda ad: ("unknown", "x")) == 0
    assert "seen" not in calls


def test_the_collapse_cap_is_respected_never_raised(monkeypatch):
    rows = [{"ad_number": f"OSQ{i:02d}", "last_seen_at": f"2026-10-{i:02d}"} for i in range(1, 21)]
    calls = _wire(monkeypatch, rows)
    R._strike_read_gone(R.RES_TABLE, set(), lambda ad: ("gone", "archive"))
    struck = {r["ad_number"] for r in rows} - calls["seen"]
    assert len(struck) == 6, "30% of 20: the prune's own collapse cap"
    assert struck == {f"OSQ{i:02d}" for i in range(1, 7)}, "oldest-seen first"


def test_the_crawl_calls_it_when_the_guard_trips():
    src = open(R.__file__, encoding="utf-8").read()
    assert 'n = _strike_read_gone(tbl, {r["ad_number"] for r in rr}, verify_gone)' in src
