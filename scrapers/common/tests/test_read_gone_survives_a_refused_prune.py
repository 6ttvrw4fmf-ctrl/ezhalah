"""An own-page «gone» reading must survive a refused absence prune (2026-10-12).

opensooq: 27 of 97 ads read «هذا الإعلان غير متوفر» on their own pages on four fleet shadow runs, but
the crawl's prune guard (re-saw 49 of 72) threw the whole prune away every night. manzo: a 2-ad
catalogue whose walk never matched the API count skipped the prune, so MNZ1403 (own page 404) froze
at 2 strikes. db.strike_read_gone strikes only the unseen ads whose OWN page reads gone.
"""
from __future__ import annotations

from scrapers.common import db
from scrapers.manzo import run as M
from scrapers.opensooq import run as O


def _wire(monkeypatch, rows):
    calls = {}

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = rows

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", lambda q, what="": _Res())

    def fake_prune(tbl, seen, **kw):
        calls["seen"], calls["kw"] = set(seen), kw
        return len(rows) - len(seen)
    monkeypatch.setattr(db, "prune_unseen", fake_prune)
    return calls


def test_only_ads_read_gone_are_struck_unknown_and_live_are_kept(monkeypatch):
    rows = [{"ad_number": f"OSQ{i}", "last_seen_at": f"2026-10-0{i}"} for i in range(1, 6)]
    calls = _wire(monkeypatch, rows)
    verdicts = {"OSQ3": ("gone", "archive"), "OSQ4": ("unknown", "blocked"), "OSQ5": ("live", "200")}
    n = db.strike_read_gone("t", {"OSQ1", "OSQ2"}, "src", lambda ad: verdicts[ad])
    assert n == 1
    assert calls["seen"] == {"OSQ1", "OSQ2", "OSQ4", "OSQ5"}, "UNKNOWN is never a strike"
    assert calls["kw"]["min_coverage"] == 0.0
    assert calls["kw"]["source"] == "src"


def test_an_oracle_that_throws_is_unknown(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "A"}, {"ad_number": "B"}])

    def boom(ad):
        raise RuntimeError("x")
    assert db.strike_read_gone("t", {"A"}, None, boom) == 0
    assert "seen" not in calls


def test_nothing_seen_reads_nothing(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "A"}])
    assert db.strike_read_gone("t", set(), None, lambda ad: ("gone", "x")) == 0
    assert "seen" not in calls, "an empty crawl has no control: no reading, no strike"


def test_the_collapse_cap_is_respected_never_raised(monkeypatch):
    rows = [{"ad_number": f"OSQ{i:02d}", "last_seen_at": f"2026-10-{i:02d}"} for i in range(1, 21)]
    calls = _wire(monkeypatch, rows)
    db.strike_read_gone("t", {"OSQ20"}, None, lambda ad: ("gone", "archive"))
    struck = {r["ad_number"] for r in rows} - calls["seen"]
    assert len(struck) == 6, "30% of 20: the prune's own collapse cap"
    assert struck == {f"OSQ{i:02d}" for i in range(1, 7)}, "oldest-seen first"


def test_a_tiny_catalogue_strikes_its_read_gone_ad(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "MNZ1403"}, {"ad_number": "MNZ1774"}])
    assert db.strike_read_gone("manzo_residential_listings", {"MNZ1774"}, M.SOURCE,
                               lambda ad: ("gone", "404")) == 1
    assert calls["seen"] == {"MNZ1774"}


def test_both_crawls_call_it():
    o = open(O.__file__, encoding="utf-8").read()
    assert 'n = db.strike_read_gone(tbl, {r["ad_number"] for r in rr}, SOURCE, verify_gone)' in o
    m = open(M.__file__, encoding="utf-8").read()
    assert m.count("n = db.strike_read_gone(tbl, seen_all, SOURCE)") == 2, \
        "manzo: on a guard trip AND on a walk that fell short"
