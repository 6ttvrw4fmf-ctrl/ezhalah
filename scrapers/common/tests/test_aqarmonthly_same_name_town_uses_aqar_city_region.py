"""A same-name town is tie-broken by Aqar's OWN city id — and only when the slug alone found no city.

Owner 2026-10-18: 13 active Aqar Monthly ads named a real catalog town in their own slug and still
had no city, so none was production_ready and no search could reach them. الدرب is catalogued in
Asir (1862) AND Jazan (3402); العقيق in four places; the slug names no «منطقة», so resolve_slug()
rightly refused to guess. Every ad also carries Aqar's own city_id, and `AQAR_CITY_REGION` holds the
region each id was measured to sit in. These pin both directions: the hint resolves the twin, and it
never touches a city the slug already resolved (Aqar's ids are not region-pure). No network/DB.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
from scrapers.aqarmonthly.run import AQAR_CITY_REGION, _resolve_location


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {
        "الدرب": [(1862, 6), (3402, 10)],                         # Asir and Jazan twins
        "العقيق": [(2819, 12), (2973, 6), (5730, 2), (15607, 6)],
        "الرياض": [(3, 1)],
        "ابها": [(7, 6)],
    })
    monkeypatch.setattr(al, "_CID_AR", {1862: "الدرب", 3402: "الدرب", 2819: "العقيق", 2973: "العقيق",
                                        5730: "العقيق", 15607: "العقيق", 3: "الرياض", 7: "أبها"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


def test_twin_town_resolves_in_the_region_of_aqars_own_city_id():
    # real ad 761622: «الدرب-الدرب-3716038», Aqar city_id 56 → Jazan
    r = _resolve_location("الدرب-الدرب-3716038", 56)
    assert (r["city_id"], r["region_id"]) == (3402, 10)
    # real ad 762555: «…-العقيق-العقيق-5831971», Aqar city_id 5 → Al-Baha
    r = _resolve_location("شارع-الحارث-بن-يزيد-بن-انيسة-العقيق-العقيق-5831971", "5")
    assert (r["city_id"], r["region_id"]) == (2819, 12)


def test_without_a_known_aqar_id_the_twin_stays_unresolved():
    for aqar_id in (None, "", 0, 99999, "x"):
        assert _resolve_location("الدرب-الدرب-3716038", aqar_id)["city_id"] is None


def test_a_city_the_slug_already_resolved_is_never_overridden():
    # Aqar id 21 is Riyadh-region, yet a slug that names أبها alone keeps أبها.
    r = _resolve_location("حي-المنهل-ابها-6000001", 21)
    assert r["city_id"] == 7


def test_the_hint_never_invents_a_town_outside_its_region():
    # id 21 → Riyadh region; الدرب has no Riyadh twin, so nothing is picked.
    assert _resolve_location("الدرب-الدرب-3716038", 21)["city_id"] is None


def test_the_measured_ids_are_pinned():
    assert AQAR_CITY_REGION[21] == 1 and AQAR_CITY_REGION[56] == 10 and AQAR_CITY_REGION[5] == 12
    assert 40 not in AQAR_CITY_REGION and 96 not in AQAR_CITY_REGION  # split evidence: never a hint


# ── 2026-10-18 (owner: «fix those bugs and investigate the 10 ads») ───────────────────────────────
# The ad's own address is the second witness: a street named after a town is not the town, and the
# address's last segment (or a catalog district of exactly one city in the region) places the rest.

import scrapers.aqarmonthly.run as am


@pytest.fixture
def address_catalog(monkeypatch):
    city = {
        "الاحساء": [(50, 5)], "العيينه": [(60, 1)], "سكاكا": [(70, 13)], "ابها": [(15, 6)],
        "تمنيه": [(80, 6)], "مدينه الملك عبدالله الاقتصاديه": [(3666, 2)], "المزاحميه": [(990, 1)],
        "مكه المكرمه": [(6, 2)], "الرياض": [(3, 1)],
    }
    monkeypatch.setattr(al, "_CITY", city)
    monkeypatch.setattr(al, "_CID_AR", {50: "الاحساء", 60: "العيينة", 70: "سكاكا", 15: "أبها", 80: "تمنية",
                                        3666: "مدينة الملك عبدالله الاقتصادية", 990: "المزاحمية",
                                        6: "مكة المكرمة", 3: "الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه عسير": 6, "منطقه الرياض": 1, "منطقه مكه المكرمه": 2})
    monkeypatch.setattr(al, "_DISTRICT_AR_BY_CITY", {
        (15, al.norm_district_tok("الفرعاء")): "الفرعاء",
        (6, al.norm_district_tok("حي العوالي")): "حي العوالي",
        (3, al.norm_district_tok("حي العوالي")): "حي العوالي",
        (990, al.norm_district_tok("حي الغطغط")): "حي الغطغط",
    })
    am._city_region.cache_clear()
    yield
    am._city_region.cache_clear()


def test_a_street_named_after_a_town_is_not_the_town(address_catalog):
    # real ad 1143345: «شارع الاحساء, العيينة», Aqar city 21 (Riyadh region) → العيينة, never الاحساء
    r = _resolve_location("شارع-الاحساء-العيينة-6000002", 21, "شارع الاحساء, العيينة")
    assert r["city_id"] == 60
    # real ad 1292182: same shape with سكاكا
    assert _resolve_location("شارع-سكاكا-العيينة-6000003", 21, "شارع سكاكا, العيينة")["city_id"] == 60


def test_a_town_named_outside_the_street_too_keeps_its_city(address_catalog):
    # real ad 762542: «شارع 44 تمنية ، تمنية ، منطقة عسير» is really in تمنية
    r = _resolve_location("شارع-44-تمنية-تمنية-منطقة-عسير-6000004", 1, "شارع 44 تمنية ، تمنية ، منطقة عسير")
    assert r["city_id"] == 80


def test_a_town_that_is_a_catalog_district_lands_in_its_city(address_catalog):
    # real ads 14201555 / 13905942: «الفرعاء ، منطقة عسير» — الفرعاء is a district of أبها
    r = _resolve_location("الفرعاء-منطقة-عسير-6582310", 4, "الفرعاء ، منطقة عسير")
    assert (r["city_id"], r["district_ar"]) == (15, "الفرعاء")
    r = _resolve_location("شارع-الصليحى-212-الفرعاء-منطقة-عسير-6836489", 4, "شارع الصليحى 212 ، الفرعاء ، منطقة عسير")
    assert r["city_id"] == 15


def test_the_address_last_segment_names_a_long_city(address_catalog):
    # real ad 1097437: «… البيلسان, مدينة الملك عبد الله الاقتصادية» (the catalog writes «عبدالله»)
    r = _resolve_location("شارع-ناردين-البيلسان-مدينة-الملك-عبد-الله-الاقتصادية-6069581", 93,
                          "شارع ناردين, البيلسان, مدينة الملك عبد الله الاقتصادية")
    assert r["city_id"] == 3666


def test_aqars_own_district_places_a_country_only_ad_only_when_unique_in_region(address_catalog):
    # real ad 1097288: address «المملكة العربية السعودية», Aqar city 94 (Makkah region), district «حي العوالي»
    r = _resolve_location("المملكة-العربية-السعودية-321333", 94, "المملكة العربية السعودية", lambda: "حي العوالي")
    assert r["city_id"] == 6
    # real ad 1097333: Aqar city 43 (Riyadh region), «حي الغطغط» → المزاحمية
    assert _resolve_location("المملكة-العربية-السعودية-5961273", 43, "المملكة العربية السعودية",
                             "حي الغطغط")["city_id"] == 990
    # no region → a district name alone never places an ad
    assert _resolve_location("المملكة-العربية-السعودية-1", 17, "المملكة العربية السعودية", "حي العوالي")["city_id"] is None


def test_an_unknown_town_stays_unresolved(address_catalog):
    # real ad 762316: «الوغل ، منطقة عسير» — الوغل is in neither the city nor the district catalog
    assert _resolve_location("الوغل-منطقة-عسير-5785059", 1, "الوغل ، منطقة عسير")["city_id"] is None


def test_a_dropped_street_city_that_finds_nothing_better_is_marked_for_clearing(address_catalog):
    # real ad 762480: «شارع مصاولي 3168 ، الوغل ، منطقة عسير» was filed under مصاولي; الوغل is uncatalogued.
    al._CITY["مصاولي"] = [(81, 6)]
    al._CID_AR[81] = "مصاولي"
    am._city_region.cache_clear()
    r = _resolve_location("شارع-مصاولي-3168-الوغل-منطقة-عسير-5818181", 1, "شارع مصاولي 3168 ، الوغل ، منطقة عسير")
    assert r["city_id"] is None and r.get("street_city_dropped") is True
    # an ordinary unresolved ad is NOT marked (its stored city must survive a weak fetch)
    assert not _resolve_location("الوغل-منطقة-عسير-5785059", 1, "الوغل ، منطقة عسير").get("street_city_dropped")


def test_the_street_pattern_really_matches_a_street_segment():
    # The first version shipped as r"^s*(?:شارع|طريق)(?:s|$)" (backslashes lost in a patch), which
    # matched no street at all, and every street-guard test above still passed for another reason.
    assert am._STREET_SEG.match("شارع مصاولي 3168") and am._STREET_SEG.match("طريق الملك فهد")
    assert not am._STREET_SEG.match("الوغل") and not am._STREET_SEG.match("شارعين")
    assert am._city_only_in_street("الاحساء", "شارع الاحساء, العيينة")
    assert not am._city_only_in_street("تمنية", "شارع 44 تمنية ، تمنية ، منطقة عسير")
