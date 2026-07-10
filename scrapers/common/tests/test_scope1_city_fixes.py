"""Regression tests for the 3 city-placeholder fixes shipped in the 2026-07-10 location-fix
Scope 1 follow-up: scrapers/deal, scrapers/ramzalqasim, scrapers/alnokhba each had the exact
`city = ... or "<hardcoded placeholder>"` shape already fixed elsewhere in this PR.

Placed here (not in each platform's own tests/ dir, the repo's usual convention — see
scrapers/wasalt/tests/) because these are three small, related point-fixes for the SAME bug class
this file's sibling tests already cover, not a new subsystem; this also gets CI coverage for free
from the existing `common-location-tests.yml` trigger (`scrapers/common/**`) without a new workflow
per platform. Each test reproduces the EXACT real-data pattern documented in project memory
(project_location-placeholder-architecture-redesign-2026-07-10.md) that proved the bug live, and
confirms the fix doesn't change the ALREADY-correct case.
"""
from __future__ import annotations

from scrapers.deal.run import _city as deal_city
from scrapers.alnokhba.run import parse_address as alnokhba_parse_address
from scrapers.ramzalqasim.run import map_marker as ramzalqasim_map_marker
from scrapers.common import normalize


# ── Deal (dealapp.sa) — city = CITY_MAP.get(raw, raw) if raw else "Other" ─────────────────────────

def test_deal_no_source_city_is_none_not_other():
    assert deal_city(None) is None
    assert deal_city({}) is None


def test_deal_real_unmapped_city_still_passes_through_unchanged():
    # The bug only ever fired when there was NO city info at all — an unmapped-but-real name always
    # passed through as-is, both before and after this fix. Confirms zero regression on that path.
    assert deal_city("Some Unmapped Town") == "Some Unmapped Town"


# ── Ramz Al Qassim — DEFAULT_CITY = "Unaizah" fired on blank source (68/184 real rows, 37%) ───────

def test_ramzalqasim_blank_source_city_is_none_not_unaizah():
    rec = {"id": 999001, "city": "", "district": "", "type": "شقة", "status": "sell", "price": 500000}
    row, category, is_sold = ramzalqasim_map_marker(rec)
    assert row["city"] is None
    assert row["additional_info"].get("city_ar") is None
    # Region is a fixed business fact for this Qassim-only brokerage, untouched by this fix.
    assert row["region"] == "Qassim"


def test_ramzalqasim_genuine_unaizah_is_unaffected():
    # The other 77 rows genuinely resolved to Unaizah via a real "عنيزة" source value — the fix
    # must not touch this path at all.
    rec = {"id": 999002, "city": "عنيزة", "district": "", "type": "شقة", "status": "sell", "price": 400000}
    row, category, is_sold = ramzalqasim_map_marker(rec)
    assert row["city"] == "Unaizah"


# ── Al Nokhba — city defaulted to "Mecca"/region to "Makkah" when parse_address() failed ──────────
# (dormant on live data today — all 6 real rows parse correctly — but the same placeholder shape)

def test_alnokhba_unparseable_address_is_none_not_mecca():
    city, neigh = alnokhba_parse_address("")
    assert city is None
    assert normalize.region_for_city(city) is None


def test_alnokhba_real_address_is_unaffected():
    city, neigh = alnokhba_parse_address("مكة المكرمة - النواريه - الطيب")
    assert city == "Mecca"
    assert neigh == "النواريه"
