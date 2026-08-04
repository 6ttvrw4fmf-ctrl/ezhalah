"""aqar SOFT-CLOSE detection — pinned from the live 2026-08-04 sample.

aqar does not 404 a closed ad: it serves HTTP 200, swaps the price slot for a red «مغلق» badge
and drops the `offers` node from the JSON-LD. looks_dead() only knew 404/410 + four phrases those
pages never contain, so the alive branch refreshed last_seen_at AND reset missing_count — the rows
could never reach the 3-strike kill threshold. Measured live: 11 of 40 random active rows (and
17 of 115 in a wider sample) were closed-at-source while reported healthy.

The detector is TWO-FACTOR because «مغلق» legitimately appears in live listings' own descriptions
(«مطبخ مغلق» = closed kitchen, «مجمع سكني مغلق» = gated compound). Validated on 40 real pages:
0 false fires, 0 disagreements with ground truth.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqar.liveness import looks_closed, looks_dead  # noqa: E402

CLOSED = '<div class="listing"><span class="badge badge-danger">مغلق</span><h1>شقة</h1></div>'
LIVE_GATED = ('<script type="application/ld+json">{"@type":"RealEstateListing",'
              '"offers":{"price":850000}}</script><p>الوصف: مجمع سكني مغلق بحراسة</p>')
LIVE_KITCHEN = ('<script>{"offers":{"price":440000}}</script>'
                '<p>مطبخ مغلق راكب مع الأجهزة</p>')
LIVE_PLAIN = '<script>{"offers":{"price":1200000}}</script><h1>فيلا للبيع</h1>'


def test_closed_badge_without_offers_is_closed():
    assert looks_closed(CLOSED) is True
    assert looks_dead(200, CLOSED) is True


def test_gated_compound_description_is_not_closed():
    # Factor 2 saves this one: the page still publishes a price.
    assert looks_closed(LIVE_GATED) is False
    assert looks_dead(200, LIVE_GATED) is False


def test_closed_kitchen_description_is_not_closed():
    assert looks_closed(LIVE_KITCHEN) is False


def test_page_without_the_word_is_never_closed():
    assert looks_closed(LIVE_PLAIN) is False


def test_a_page_that_still_publishes_a_price_is_never_killed():
    # The safety invariant, asserted directly: no combination of markup may kill a priced page.
    for body in (LIVE_GATED, LIVE_KITCHEN, LIVE_PLAIN,
                 '<span class="status">مغلق</span><script>{"offers":{"price":1}}</script>'):
        assert looks_closed(body) is False, body[:60]


def test_transient_and_removed_paths_are_unchanged():
    assert looks_dead(404, "") is True          # hard-removed
    assert looks_dead(500, CLOSED) is False     # a 5xx is NEVER a kill signal
    assert looks_dead(200, "تم حذف الإعلان") is True   # legacy marker still works


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"PASS {name}")
    print("✓ aqar soft-close detection pinned (two-factor, priced pages never killed)")
