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
    # dealapp's structured price badge — the ONLY place it publishes the rental period (fidelity fix
    # 2026-08-05). Without it the period is UNKNOWN and no price is stored, so a fixture that omits it
    # is not a realistic rent page. These ads are annual leases.
    badge = ('<ion-icon src="assets/imgs/coin.svg"></ion-icon>'
             '<span class="typographyTextXsLd0Normal"> إيجار سنوي </span>')
    return (f'<html><body>{spec}{badge}'
            f'<script id="ng-state" type="application/json">{json.dumps(state)}</script>'
            f"</body></html>")


def _page_without_period_badge(price: int) -> str:
    """A page that did not hydrate its price badge — the period is genuinely unknown."""
    full = _page(price)
    return full.replace('<ion-icon src="assets/imgs/coin.svg"></ion-icon>', "")


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


def test_unhydrated_page_stores_no_price_rather_than_guessing_annual():
    """Fidelity over completeness (owner directive 2026-08-05).

    price_annual asserts the price is ANNUAL. When dealapp's badge is absent we do not know the
    period, so filling that column would be a guess about the most consequential field on a rental —
    and a monthly figure parked in an annual column understates the real cost 12x. Unknown stays
    unknown; the listing keeps every other field. This is a deliberate trade, pinned so it is not
    "fixed" back into a default.
    """
    row, cat, sold = map_listing(_page_without_period_badge(850_000), "222222")
    assert row is not None
    assert row["price_annual"] is None, "no published period -> no annual price asserted"
    assert row["rent_period"] is None, "period must be unknown, never defaulted to annual"
