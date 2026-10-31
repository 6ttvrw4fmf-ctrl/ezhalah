"""A refused prune's own-page reading must record LIVE answers, not only «gone» (2026-10-31, ♻️).

albukaeri: the walk re-saw 6 of 12 every night, the collapse guard refused the prune, and
db.strike_read_gone read the 6 unseen ads through albukaeri's own oracle (real title + property
block = live) — then threw every «live» away. Those 6 shown ads had no reading recorded since 10-13
(66.7% checked in time), 3 frozen at missing_count 2. A live reading from the caller's OWN oracle is
now stamped (the contract's direct_alive_patch) and resets the strike; the shared status-only
default oracle still stamps nothing.
"""
from __future__ import annotations

from scrapers.common import db


def _wire(monkeypatch, rows):
    calls = {"updates": []}

    class _Q:
        def __init__(self):
            self.patch, self.ads = None, None

        def update(self, patch):
            self.patch = patch
            return self

        def in_(self, col, vals):
            self.ads = list(vals)
            return self

        def __getattr__(self, _):
            return lambda *a, **k: self

    class _Res:
        data = rows

    def fake_execute(q, what=""):
        if getattr(q, "patch", None) is not None:
            calls["updates"].append((q.patch, q.ads))
        return _Res()

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())
    monkeypatch.setattr(db, "_execute", fake_execute)
    monkeypatch.setattr(db, "own_page_status_oracle",
                        lambda c, t, seen: (lambda ad: ("live", "bare 200")))

    def fake_prune(tbl, seen, **kw):
        calls["seen"] = set(seen)
        return 0
    monkeypatch.setattr(db, "prune_unseen", fake_prune)
    return calls


def test_own_oracle_live_is_stamped_and_resets_the_strike(monkeypatch):
    rows = [{"ad_number": a, "last_seen_at": "2026-10-13"} for a in ("A", "B", "C", "D")]
    calls = _wire(monkeypatch, rows)
    verdicts = {"B": ("live", "real title"), "C": ("gone", "shell"), "D": ("unknown", "HTTP 503")}
    db.strike_read_gone("albukaeri_residential_listings", {"A"}, "src", lambda ad: verdicts[ad])
    assert len(calls["updates"]) == 1
    patch, ads = calls["updates"][0]
    assert ads == ["B"], "only the ad its own oracle read live is stamped; unknown writes nothing"
    assert patch["missing_count"] == 0 and patch["last_verified_alive_at"] and patch["last_liveness_probe_at"]
    assert "active" not in patch, "a live reading can never hide or show anything"
    assert calls["seen"] == {"A", "B", "D"}, "the gone ad is still the only strike"


def test_the_shared_default_oracle_never_stamps(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "A"}, {"ad_number": "B"}])
    db.strike_read_gone("t", {"A"}, None)          # no oracle of its own → status-only default
    assert calls["updates"] == [], "a bare 200 from the shared default is not a live verdict"


def test_nothing_live_writes_nothing(monkeypatch):
    calls = _wire(monkeypatch, [{"ad_number": "A"}, {"ad_number": "B"}])
    db.strike_read_gone("t", {"A"}, None, lambda ad: ("unknown", "blocked"))
    assert calls["updates"] == []
