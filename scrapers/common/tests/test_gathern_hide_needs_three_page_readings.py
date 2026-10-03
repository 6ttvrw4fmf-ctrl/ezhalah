"""A Gathern hide needs three of the ad's OWN page readings; an absence strike is not one (2026-10-03).

`missing_count` is shared with the crawl's prune_unseen, which bumps it when an ad is missing from
Gathern's feed. On 2026-10-03 7 ads were hidden at 12:07 UTC after a 404 at 04:40 (0→1), a feed miss
(1→2) and a 404 at 12:07 — two page readings. Two ads hidden that way answered 200 a day later.
LISTING_LIVENESS.md §2: absence is a candidate, never a vote; three consecutive DIRECT readings hide.
"""
from __future__ import annotations

from scrapers.gathern import liveness as L


def _h(lid, at, verdict, status=404, applied=True):
    return {"listing_id": lid, "run_at": at, "verdict": verdict, "http_status": status, "applied": applied}


def test_counts_only_applied_direct_dead_readings_after_the_last_alive():
    hist = [
        _h(1, "2026-10-01T00:00:00+00:00", "alive", 200),
        _h(1, "2026-10-02T13:05:00+00:00", "strike"),
        _h(1, "2026-10-02T11:28:00+00:00", "strike", applied=False),   # an unapplied read is no vote
        _h(1, "2026-09-30T00:00:00+00:00", "strike"),                  # before it was read alive
        _h(2, "2026-10-03T04:40:00+00:00", "strike"),
        _h(2, "2026-10-03T05:00:00+00:00", "strike", status=0),        # no verdict is no vote
    ]
    assert L.direct_strikes_since_alive(hist) == {1: 1, 2: 1}


def test_a_kill_on_two_page_readings_and_an_absence_strike_is_held():
    kills, strikes = L.demote_unearned_kills([(7, 3), (8, 3)], {7: 1, 8: 2}, grace=3)
    assert kills == [(8, 3)]
    assert strikes == [(7, 2)], "held at grace-1 so its next own 404 can hide it"


def test_unreadable_history_hides_nothing():
    kills, strikes = L.demote_unearned_kills([(7, 3)], None, grace=3)
    assert kills == [] and strikes == [(7, 2)]
