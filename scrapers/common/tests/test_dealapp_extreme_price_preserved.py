"""Regression test for the owner's extreme-price verify-then-preserve rule (2026-07-30).

The removed bug: map_listing's `price_bad` plausibility cap treated source-published prices as
invalid on looks alone (per-meter > 300k SAR/m² or total > 1B SAR → price/ppm nulled AND
active=False). But dealapp itself publishes these values — live-verified 2026-07-30: ad 548642's
own payload carries "price": 3550000000 with سعر المتر 100,000 ﷼/m². The hide also flapped daily
(crawl hid → 05:20 auto-recover resurrected → next crawl hid again; the mon_unverified_
inactivations_24h monitor counted exactly this class, 5 rows on 2026-07-30).

Owner rule: if the source displays the value, store it EXACTLY and keep the listing active. Only a
PROVEN pipeline-introduced error may be repaired. This test reproduces the original failure shape
(pre-fix: price=None + active=False; post-fix: exact price + active=True).

Run: python -m pytest scrapers/common/tests/test_dealapp_extreme_price_preserved.py -v
"""
import json
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import map_listing  # noqa: E402


def _page(price: int, ppm_text: str | None = None) -> str:
    schema = {
        "@type": "RealEstateListing",
        "name": "ارض سكنية للإيجار",
        "offers": {"price": price, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
        "itemOffered": {
            "additionalProperty": [{"name": "propertyType", "value": "أرض سكنية"}],
            "address": {}, "geo": {},
        },
    }
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema)}}
    spec = f'<div>سعر المتر<span>{ppm_text}</span></div>' if ppm_text else ""
    return (f'<html><body>{spec}'
            f'<script id="ng-state" type="application/json">{json.dumps(state)}</script>'
            f"</body></html>")


def test_billion_riyal_source_price_preserved_and_active():
    # ad 548642's real shape: total 3,550,000,000 (35,500 m² × سعر المتر 100,000).
    row, cat, sold = map_listing(_page(3_550_000_000, "100,000 ريال"), "548642")
    assert row is not None and not sold
    assert row["active"] is True                      # pre-fix: False (price_bad hide)
    assert row["price_annual"] == 3_550_000_000       # rent listing → annual, EXACT source value
    assert row["price_per_meter"] == 100_000


def test_extreme_ppm_preserved_and_active():
    # the pre-fix trigger was ppm > 300k alone — e.g. سعر المتر 800,000 ﷼/m².
    row, cat, sold = map_listing(_page(46_000_000, "800,000 ريال"), "999999")
    assert row is not None and row["active"] is True
    assert row["price_per_meter"] == 800_000          # pre-fix: None


def test_normal_price_unchanged():
    row, cat, sold = map_listing(_page(850_000), "111111")
    assert row is not None and row["active"] is True
    assert row["price_annual"] == 850_000
