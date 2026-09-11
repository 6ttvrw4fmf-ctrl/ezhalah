"""Regression tests for the universal "never default a missing/unclear city to a specific real
city" rule (owner directive, 2026-07-10, following the Ramz Al Qassim 69-row backfill). Same bug
class already fixed for Deal/Ramzalqasim/AlNokhba in test_scope1_city_fixes.py; this file covers
the two additional platforms found by the repo-wide sweep:

- Nowaisiry: `city = "Riyadh"` base default, overridden only on a CITY_TOKENS match. CITY_TOKENS
  explicitly recognizes BOTH Riyadh-area and Hail-area plan names, so the scraper is demonstrably
  multi-city — an unrecognized plan name silently became "Riyadh" even for a real Hail listing.
  Confirmed violation; fixed.
- Awal: `LOC_DEFAULT_CITY.get(loc_slug or "", "Sakaka")` guessed "Sakaka" whenever the structured
  city field/text scan failed to name a city (the "jouf" slug case, and any other/unknown slug).
  Fixed — city is now left unresolved (None) in that case. The "arar" -> "Arar" branch is
  INTENTIONALLY left untouched pending independent verification of the "arar listings are all in
  Arar" claim (docs/LOCATION_RESOLUTION.md) — do not extend this fix to that branch without proof.
"""
from __future__ import annotations

from scrapers.nowaisiry.run import _city as nowaisiry_city
from scrapers.awal.run import map_listing as awal_map_listing


# ── Nowaisiry — city = "Riyadh" base default, CITY_TOKENS knows both Riyadh AND Hail plans ────────

def test_nowaisiry_unrecognized_plan_name_is_none_not_riyadh():
    text = "للبيع مخطط غير معروف قطعة رقم 12"
    city, neighborhood = nowaisiry_city(text)
    assert city is None


def test_nowaisiry_riyadh_token_still_resolves_riyadh():
    text = "للبيع في مخطط الخير الأمراء 3541"
    city, neighborhood = nowaisiry_city(text)
    assert city == "Riyadh"


def test_nowaisiry_hail_token_still_resolves_hail():
    text = "للبيع قطعة في الجلة مخطط 520"
    city, neighborhood = nowaisiry_city(text)
    assert city == "Hail"


# ── Awal — LOC_DEFAULT_CITY.get(loc_slug or "", "Sakaka") guessed on parse failure ─────────────────

def _awal_post(loc_slug: str | None, title: str = "أرض للبيع", content: str = "أرض للبيع في المخطط"):
    class_list = ["rtcl_category-residential-land"]
    if loc_slug:
        class_list.append(f"rtcl_location-{loc_slug}")
    return {
        "title": {"rendered": title},
        "content": {"rendered": content},
        "class_list": class_list,
        "link": "https://awaalun.com/listing/x",
    }


def test_awal_jouf_slug_with_no_city_text_is_none_not_sakaka():
    row, category, gone = awal_map_listing(_awal_post("jouf"), None)
    assert row is not None
    assert row["city"] is None


def test_awal_unknown_slug_with_no_city_text_is_none_not_sakaka():
    row, category, gone = awal_map_listing(_awal_post(None), None)
    assert row is not None
    assert row["city"] is None


def test_awal_arar_slug_is_unaffected_pending_independent_verification():
    # This branch is intentionally NOT part of this fix — confirms it still behaves exactly as
    # before (owner: "do not change the Arar branch until it is independently verified").
    row, category, gone = awal_map_listing(_awal_post("arar"), None)
    assert row is not None
    assert row["city"] == "Arar"


def test_awal_real_city_text_is_unaffected():
    row, category, gone = awal_map_listing(
        _awal_post("jouf", content="المدينة : سكاكا الحي : الروضة"), None
    )
    assert row is not None
    assert row["city"] == "Sakaka"
