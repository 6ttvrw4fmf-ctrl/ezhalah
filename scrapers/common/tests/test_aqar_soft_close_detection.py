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


# ── liveness price refresh (owner-approved 2026-08-04) ───────────────────────────────────────────
# liveness already downloads every active page daily and used to DISCARD the body — which is why
# 43,112 aqar rows (54.5%) still carried prices from the 2026-07-01 backfill while last_seen_at
# reported them fresh. It now re-reads the published price from that same body.
from scrapers.aqar.liveness import price_from_body  # noqa: E402


def test_price_is_read_from_the_published_offer():
    assert price_from_body('<script>{"offers":{"price":440000}}</script>') == 440000
    assert price_from_body('{"price":"520041.38"}') == 520041   # decimals round to the stored int
    assert price_from_body('{"price": 8900000 }') == 8900000


def test_no_published_price_returns_none_so_the_stored_value_is_kept():
    # The safety property: a closed ad / «طلب تسويق» / unrecognised render must NEVER null a price.
    assert price_from_body(CLOSED) is None
    assert price_from_body('<h1>أرض للبيع</h1><span>طلب تسويق</span>') is None
    assert price_from_body('') is None
    assert price_from_body('{"price":0}') is None      # 0 is not a published price
    assert price_from_body('{"price":"abc"}') is None


def test_refresh_never_derives_a_price():
    # PRICE = SOURCE: the refresh copies the source's own number — there is no arithmetic here.
    import inspect
    from scrapers.aqar import liveness
    src = inspect.getsource(liveness.price_from_body)
    assert "*" not in src.split('"""')[-1], "no multiplication may appear in the price refresh"
    assert "area" not in src.lower(), "price must never be computed from area"
