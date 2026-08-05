"""Regression test for scrapers/dealapp/run.py's rent-period detection.

HISTORY — this file has been rewritten, and the rewrite REVERSED part of the earlier contract.

2026-07-28 (original): `rent_period` was hardcoded "annual" for every Rent listing, so a daily rate
was stored verbatim into `price_annual`. Live proof at the time: DA468049 showed "500 ريال" with page
text «إيجار يومي», stored as price_annual=500 — understating the annual cost ~365x. That fix scanned a
window around each «إيجار» for a period word and annualised ×365/×52/×12, defaulting to "annual" when
no word was found. This file pinned that behaviour.

2026-08-05 (this version): the apartment advanced-filter audit proved BOTH halves of that fix are
themselves fidelity violations, under the owner's standing directive —

    "never calculate, guess, fabricate, or overwrite source-published price, rent period, furnished
     status, amenities... If the source does not provide a value confidently, store it as unknown
     rather than inventing one."

  (a) The window scan walked the WHOLE document — <head> (og:description) and the broker's free-text
      description included — and returned on the first period word in document order. Reproduced
      against LIVE pages with the production function: DA443363's own price badge reads «إيجار سنوي»
      (ANNUAL, 60,000/yr) yet the scan returned "daily", storing 21,900,000. DA537587's badge reads
      «سنوي» while its description says «إيجار يومي» — same flip. Scoping to the body is NOT enough:
      DA443363's description token precedes the badge in document order.
  (b) ×365 / ×52 fabricate a magnitude dealapp never published, and label it "monthly". DA552452 is
      350/day; we stored 127,750 and the card rendered "SAR 10,645/mo" — a price that appears nowhere
      on the source.
  (c) Defaulting to "annual" when no period is found is a guess about the most consequential field on
      a rental listing, and it fires on every page that fails to hydrate.

CURRENT CONTRACT (what this file now pins):
  • the period comes ONLY from dealapp's structured price badge
    (`src="assets/imgs/coin.svg"></ion-icon><span…> إيجار {PERIOD}`) — the sole place dealapp states
    it; the JSON-LD carries price/currency only;
  • annual  -> stored verbatim;
  • monthly -> ×12, the schema's annualisation contract (price_annual holds the annual figure and the
    app divides by 12 to display, so this round-trips back to exactly what dealapp printed);
  • daily / weekly -> UNKNOWN (None, None). This schema has no daily bucket, so any conversion would
    misrepresent the source. The 2026-07-28 concern is still met — a daily rate is no longer presented
    as an annual one; it is simply not priced;
  • no badge -> UNKNOWN, never a default.

Run: python -m pytest scrapers/common/tests/test_dealapp_rent_period.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import _rent_annualize, _rent_period_window  # noqa: E402


def _badge(period_ar: str) -> str:
    """dealapp's real structured price badge, as served on a hydrated detail page."""
    return (
        '<ion-icon _ngcontent-ng-c1655884367="" src="assets/imgs/coin.svg"></ion-icon>'
        f'<span _ngcontent-ng-c1655884367="" class="typographyTextXsLd0Normal"> إيجار {period_ar} </span>'
    )


# ── the badge is the only source of truth ────────────────────────────────────────────────────────
def test_badge_is_read_for_each_period():
    assert _rent_period_window(_badge("يومي")) == "daily"
    assert _rent_period_window(_badge("أسبوعي")) == "weekly"
    assert _rent_period_window(_badge("شهري")) == "monthly"
    assert _rent_period_window(_badge("سنوي")) == "annual"


def test_description_prose_can_never_override_the_badge():
    """THE 2026-08-05 P0: DA537587's badge says سنوي, its description says «إيجار يومي»."""
    html = (
        "<head><meta property='og:description' content='إيجار يومي إيجار شهري إيجار سنوي'></head>"
        "<body>" + _badge("سنوي") +
        "<p>الوصف: إيجار يومي متاح للتواصل، إيجار شهري كذلك</p></body>"
    )
    assert _rent_period_window(html) == "annual", (
        "the badge (سنوي) must win over every period word in <head> and the description"
    )
    assert _rent_annualize(60_000, html) == (60_000, "annual"), (
        "an annual listing must be stored verbatim — the old code produced 60000*365"
    )


def test_head_only_period_words_are_ignored():
    html = "<head><title>إيجار يومي</title></head><body><p>no badge here</p></body>"
    assert _rent_period_window(html) is None, "<head> prose is not a published period"


# ── never fabricate a magnitude ──────────────────────────────────────────────────────────────────
def test_daily_rate_is_unknown_not_multiplied():
    """DA552452: 350/day. The old code stored 127,750 and the card showed 'SAR 10,645/mo'."""
    assert _rent_annualize(350, _badge("يومي")) == (None, None)


def test_weekly_rate_is_unknown_not_multiplied():
    assert _rent_annualize(1_000, _badge("أسبوعي")) == (None, None)


def test_monthly_is_annualised_by_twelve_only():
    """×12 round-trips: the app divides by 12 to display, recovering the printed figure exactly."""
    assert _rent_annualize(5_000, _badge("شهري")) == (60_000, "monthly")


def test_annual_is_stored_verbatim():
    assert _rent_annualize(48_000, _badge("سنوي")) == (48_000, "annual")


# ── never default ────────────────────────────────────────────────────────────────────────────────
def test_missing_badge_is_unknown_never_annual():
    """A page that did not hydrate must not be silently labelled annual."""
    assert _rent_period_window("<html><body>skeleton</body></html>") is None
    assert _rent_annualize(50_000, "<html><body>skeleton</body></html>") == (None, None)


def test_none_price_returns_none_none():
    assert _rent_annualize(None, _badge("سنوي")) == (None, None)


if __name__ == "__main__":
    test_badge_is_read_for_each_period()
    test_description_prose_can_never_override_the_badge()
    test_daily_rate_is_unknown_not_multiplied()
    test_monthly_is_annualised_by_twelve_only()
    test_missing_badge_is_unknown_never_annual()
    print("ok")
