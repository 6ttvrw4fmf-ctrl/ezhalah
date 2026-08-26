"""Regression tests for the district city-name-suffix corruption found live 2026-07-21 (post-deploy
Filter QA sweep, follow-up investigation): `resolve_slug()`'s district capture
(`\\bحي\\s+([؀-ۿ]+(?:\\s+[؀-ۿ]+){0,2})`) grabs "حي" plus up to 3 following Arabic tokens with no stop
condition, so on aqarmonthly's own slug format (district+city, back-to-back, no delimiter — e.g.
`...حي-المهدية-الرياض-5924177`) it swallows the city name (and/or an "امارة"/"منطقة" admin marker) as
trailing "district" tokens. Confirmed live: 988 of 1,471 aqarmonthly search_listings_ar rows (67.2%)
carried a corrupted district_ar, across 32 cities, all production_ready=true, still happening in the
newest ingested batch.

Six real corruption shapes were found live (all explained by "regex grabs 3 tokens, no boundary
check" — token-order differs per how Aqar happened to lay out district/city/امارة/منطقة in that
listing's own slug), reproduced here as regression cases. No network/DB: monkeypatch the module's
loaded-catalog state directly, exactly like test_arabic_location_resolve.py's fixture.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {
        "الرياض": [(3, 1)],
        "جده": [(4, 2)],       # note: _CITY keys are norm_ar()'d — ة/ه folded, so "جدة" -> "جده"
        "المحاله": [(5, 6)],   # a city whose name coincidentally equals a real district's own name
    })
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض", 4: "جدة", 5: "المحالة"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


def test_plain_city_suffix_is_stripped():
    # real live example: district_ar came out "حي المهدية الرياض" instead of "حي المهدية"
    r = al.resolve_slug("شارع-محمد-بن-أحمد-الغزوي-حي-المهدية-الرياض-5924177")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_city_plus_region_marker_suffix_is_stripped():
    # real live example: "حي المهدية الرياض منطقة" (district+city+"منطقة", capped at 3 tokens)
    r = al.resolve_slug("حي-المهدية-الرياض-منطقة-الرياض-5839666")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_duplicated_city_name_is_collapsed_not_erased():
    # real live example: "حي المهدية الرياض الرياض" (district+city+region-name, reads as duplicated)
    r = al.resolve_slug("حي-المهدية-الرياض-الرياض-5196392")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_city_plus_emirate_marker_suffix_is_stripped():
    # real live example: "حي الرمال الرياض امارة" (district+city+"امارة")
    r = al.resolve_slug("حي-الرمال-الرياض-امارة-منطقة-الرياض-5510892")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي الرمال"


def test_region_marker_before_city_name_is_stripped():
    # real live example: "حي الربوة منطقة الرياض" (district+"منطقة"+region-name, region-word first)
    r = al.resolve_slug("الرياض-حي-الربوة-منطقة-الرياض-5714262")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي الربوة"


def test_district_name_equal_to_city_name_is_preserved_once_not_erased():
    # real live example: "حي المحالة المحالة امارة" — the district is genuinely named after its own
    # city (المحالة), so after stripping the "امارة" marker and one duplicated city-name occurrence,
    # exactly ONE "المحالة" must remain — never zero.
    r = al.resolve_slug("حي-المحالة-المحالة-امارة-منطقة-عسير-5455838")
    assert r["city_id"] == 5
    assert r["district_ar"] == "حي المحالة"


def test_legitimate_multiword_district_not_ending_in_city_name_is_untouched():
    # a real, non-corrupted 3-word district (no city name or marker as a trailing token) must survive
    # completely unmodified — the fix must never touch a LEADING token.
    r = al.resolve_slug("حي-ام-الحمام-الغربي-الرياض-1234567")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي ام الحمام الغربي"


def test_short_district_with_no_suffix_to_strip_is_untouched():
    r = al.resolve_slug("حي-الملقا-الرياض-7654321".replace("-الرياض", "", 1))  # no city suffix present at all
    assert r["district_ar"] == "حي الملقا"


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 2026-08-22: the guard above shipped WITHOUT two of the SQL backfill's rules (normalised comparison,
# and stripping an abbreviated official city's FIRST token), so every re-scrape re-introduced the
# corruption the backfill had cleaned. 38 rows were dirty again — 0 of them catchable by the guard.
# The cases below are the 26 distinct (district, city) shapes those 38 rows actually had, pulled
# live from production on 2026-08-22, with the output the already-approved SQL rule produces.
# ─────────────────────────────────────────────────────────────────────────────────────────────────

LIVE_DIRTY_SHAPES = [
 ("حي أبها الجديدة ابها","أبها","حي أبها الجديدة"),
 ("حي أريم ابها","أبها","حي أريم"),
 ("حي الاندلس ابها","أبها","حي الاندلس"),
 ("حي البديع ابها","أبها","حي البديع"),
 ("حي الروضة ابها","أبها","حي الروضة"),
 ("حي الرونق ابها","أبها","حي الرونق"),
 ("حي العرين ابها","أبها","حي العرين"),
 ("حي الفيصلية ابها","أبها","حي الفيصلية"),
 ("حي المحالة ابها","أبها","حي المحالة"),
 ("حي المروج ابها","أبها","حي المروج"),
 ("حي المروج ابها أبهــــا","أبها","حي المروج"),
 ("حي المفتاحة ابها","أبها","حي المفتاحة"),
 ("حي ال قيشه أحد","احد رفيده","حي ال قيشه"),
 ("حي بني حارثة المدينة","المدينة المنورة","حي بني حارثة"),
 ("حي بني ظفر المدينة","المدينة المنورة","حي بني ظفر"),
 ("حي حى الخضراء المدينة","المدينة المنورة","حي حى الخضراء"),
 ("حي ذو الحليفة المدينة","المدينة المنورة","حي ذو الحليفة"),
 ("حي سيد الشهداء المدينة","المدينة المنورة","حي سيد الشهداء"),
 ("حي المطار ابها خميس","خميس مشيط","حي المطار ابها"),
 ("حي أم الجود مكة","مكة المكرمة","حي أم الجود"),
 ("حي البحيرات مكة","مكة المكرمة","حي البحيرات"),
 ("حي الراشدية مكة","مكة المكرمة","حي الراشدية"),
 ("حي العمرة الجديدة مكة","مكة المكرمة","حي العمرة الجديدة"),
 ("حي العوالي مكة","مكة المكرمة","حي العوالي"),
 ("حي بطحاء قريش مكة","مكة المكرمة","حي بطحاء قريش"),
 ("حي وادي جليل مكة","مكة المكرمة","حي وادي جليل"),
]


@pytest.mark.parametrize("district,city,expected", LIVE_DIRTY_SHAPES)
def test_live_production_corruption_shapes_are_all_repaired(district, city, expected):
    assert al.strip_city_suffix(district, city) == expected


def test_alef_variants_normalise_before_comparison():
    """«ابها» (bare alef) must match city «أبها» (hamza) — the raw comparison missed all 38 rows."""
    assert al.strip_city_suffix("حي المروج ابها", "أبها") == "حي المروج"
    assert al.strip_city_suffix("حي المروج أبها", "ابها") == "حي المروج"


def test_tatweel_and_repeated_suffix_are_both_removed():
    assert al.strip_city_suffix("حي المروج ابها أبهــــا", "أبها") == "حي المروج"


def test_official_two_word_city_abbreviated_to_first_token_is_stripped():
    assert al.strip_city_suffix("حي أم الجود مكة", "مكة المكرمة") == "حي أم الجود"
    assert al.strip_city_suffix("حي بني حارثة المدينة", "المدينة المنورة") == "حي بني حارثة"


def test_first_token_rule_never_eats_a_real_district_down_past_two_tokens():
    """«حي أحد» in «احد رفيده» — the last token IS the city's first token, but two tokens is the
    floor, so a genuine short district is never hollowed out."""
    assert al.strip_city_suffix("حي أحد", "احد رفيده") == "حي أحد"
    assert al.strip_city_suffix("حي مكة", "مكة المكرمة") == "حي مكة"


def test_only_this_rows_city_is_stripped_a_foreign_city_token_is_preserved():
    """«حي المطار ابها خميس» in خميس مشيط: strip «خميس» (this row's city), keep «ابها» exactly as
    the source published it — we remove what the slug glued on, we do not rewrite the district."""
    assert al.strip_city_suffix("حي المطار ابها خميس", "خميس مشيط") == "حي المطار ابها"


def test_leading_city_name_inside_the_district_is_preserved():
    assert al.strip_city_suffix("حي أبها الجديدة ابها", "أبها") == "حي أبها الجديدة"


def test_strip_is_idempotent_so_the_backfill_can_be_re_run_safely():
    for district, city, expected in LIVE_DIRTY_SHAPES:
        once = al.strip_city_suffix(district, city)
        assert al.strip_city_suffix(once, city) == once == expected


def test_strip_only_ever_removes_trailing_tokens_never_invents_any():
    """Structural anti-fabrication check: the output is always a leading token-slice of the input."""
    for district, city, _ in LIVE_DIRTY_SHAPES:
        out = al.strip_city_suffix(district, city).split()
        assert out == district.split()[:len(out)]


def test_blank_or_unknown_inputs_stay_untouched():
    assert al.strip_city_suffix(None, "أبها") is None
    assert al.strip_city_suffix("", "أبها") == ""
    assert al.strip_city_suffix("حي المروج ابها", None) == "حي المروج ابها"
    assert al.strip_city_suffix("حي المروج ابها", "") == "حي المروج ابها"


# ── exact-location-only must survive this change (audit 2026-08-10) ──────────────────────────────

def test_region_label_is_not_upgraded_into_a_city(monkeypatch):
    """«منطقة الرياض» is an administrative area, never a city, even though it shares Riyadh's name.
    It must resolve region-only — (None, region_id) — never city_id 3."""
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه الرياض": 1, "الرياض": 1})
    city_id, region_id = al.to_catalog("منطقة الرياض")
    assert city_id is None, "region label silently upgraded to a city — invented precision"
    assert region_id == 1


def test_unresolvable_location_stays_unknown(monkeypatch):
    monkeypatch.setattr(al, "_REGION_NORM", {})
    assert al.to_catalog("مدينة لا توجد في الكتالوج") == (None, None)


def test_unresolved_slug_keeps_its_district_and_claims_no_city():
    r = al.resolve_slug("شارع-بدون-مدينة-معروفة-حي-المروج-9999")
    assert r["city_ar"] is None and r["city_id"] is None
    assert r["confidence"] == "unresolved"


def test_resolve_also_refuses_to_upgrade_a_region_label_into_a_city(monkeypatch):
    """The 2026-08-10 audit closed this in to_catalog() but NOT in resolve() — which is the function
    this module tells new scrapers to use, and the one scrapers/gathern/run.py already calls. It
    returned city_id=3 / confidence="city" for «منطقة الرياض» until 2026-08-23."""
    monkeypatch.setattr(al, "_REGION_AR_FOR", {1: "منطقة الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه الرياض": 1, "الرياض": 1})
    r = al.resolve("منطقة الرياض")
    assert r["city_id"] is None, "region label upgraded to a city — invented precision"
    assert r["region_id"] == 1 and r["confidence"] == "region_only"


def test_resolve_still_accepts_a_governorate_as_its_seat_city(monkeypatch):
    """«محافظة X» IS named after its seat city — that retry is a real resolution, not a fabrication,
    and must survive the fix above."""
    monkeypatch.setattr(al, "_CITY", {"الرياض": [(3, 1)], "الخرج": [(9, 1)]})
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض", 9: "الخرج"})
    monkeypatch.setattr(al, "_REGION_AR_FOR", {1: "منطقة الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه الرياض": 1})
    r = al.resolve("محافظة الخرج")
    assert r["city_id"] == 9 and r["confidence"] == "city"


def test_resolve_leaves_a_genuinely_unknown_location_unknown(monkeypatch):
    monkeypatch.setattr(al, "_REGION_NORM", {})
    r = al.resolve("مدينة لا توجد في الكتالوج")
    assert (r["city_id"], r["region_id"], r["confidence"]) == (None, None, "unresolved")
