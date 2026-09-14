"""راكز العقارية (rakez.sa): the unit↔project join, and every trap the real data laid.

Measured over ALL 14,319 units and 435 projects on 2026-09-14 — not sampled:
  · 8,549 units are 'available' … but only 4,901 of those are bound to a project.
  · 3,648 available units are ORPHANS: unit_project=None, empty title, empty code, empty
    description, no features. A price floating free with nothing to say where or what it is.
  · 4 units spell the status 'Available' with a capital A.
  · Project property-status: متاح 206, (none) 127, تم البيع 89, قريبا 7, وقف التسويق 3.

Run: python -m pytest scrapers/common/tests/test_rakez_unit_and_project_join.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402

_RIYADH, _KHOBAR = 3, 15
from scrapers.rakez import run as R  # noqa: E402

# The REAL taxonomy tree, verbatim ids and parents from rakez's own /wp/v2/city?lang=ar.
#   الياسمين → شمال الرياض → الرياض   ·   العليا → وسط الرياض → الرياض
#   البندرية → الشرقية  ← a REGION root, NOT a city: the trap the walk must survive.
TREE = {
    443:  {"name": "الرياض",        "parent": 0},
    1434: {"name": "شمال الرياض",   "parent": 443},
    1436: {"name": "وسط الرياض",    "parent": 443},
    566:  {"name": "الياسمين",      "parent": 1434},
    601:  {"name": "العليا",        "parent": 1436},
    2720: {"name": "الشرقية",       "parent": 0},
    4620: {"name": "البندرية",      "parent": 2720},
    9999: {"name": "مكان مخترع",    "parent": 443},   # not in our catalog
}


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    """Catalog slice keyed the way PRODUCTION keys it (norm_district_tok), scoped per test."""
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    for cid, districts in ((_RIYADH, ["حي الياسمين", "حي العليا"]),
                           (_KHOBAR, ["حي البندرية"])):
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, cid,
                            {_al.norm_district_tok(d) for d in districts})
        for d in districts:
            monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: {
        "الرياض": (_RIYADH, 1), "الخبر": (_KHOBAR, 5)}.get(name, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _al.find_district_in_text)


def _project(pid=66800, city_terms=(566,), ptype="أدوار", status="متاح", photo=True,
             title="أدوار إرث ( اي كيو ) - الياسمين الرياض", features=()):
    terms = [{"taxonomy": "city", "id": t, "name": TREE[t]["name"]} for t in city_terms]
    if ptype:
        terms.append({"taxonomy": "property-type", "name": ptype})
    if status:
        terms.append({"taxonomy": "property-status", "name": status})
    terms += [{"taxonomy": "feature", "name": f} for f in features]
    emb = {"wp:term": [terms]}
    if photo:
        emb["wp:featuredmedia"] = [{"source_url": "https://rakez.sa/wp-content/uploads/2026/07/a.jpg"}]
    return {"id": pid, "title": {"rendered": title}, "_embedded": emb,
            "link": f"https://rakez.sa/en/project/{pid}/"}


def _unit(uid=72544, project=66800, status="available", price=1350000, rooms=2,
          area=160.49, floor="rooftop", code="F1-144-3", desc="مجلس • دورة مياه"):
    return {"id": uid, "link": f"https://rakez.sa/en/unit/slug-{uid}/",
            "title": {"rendered": "ارث الياسمين"},
            "acf": {"unit_project": project, "unit_status": status, "price": price,
                    "rooms_count": rooms, "area": area, "floor": floor, "code": code,
                    "description_ar": desc}}


def _map(unit=None, proj=None):
    p = proj if proj is not None else _project()
    return R.map_unit(unit or _unit(), p, p, TREE)


# ── 1. THE LINK. A unit URL redirects to rakez's HOME PAGE — never send a user there ─────────────
def test_the_card_links_to_the_project_page_not_the_dead_unit_url():
    row, _ = _map()
    assert row["listing_url"] == "https://rakez.sa/ar/project/66800/", (
        "unit.link answers 200 but lands on https://rakez.sa/en/ (<title>Home - Rakez). The "
        "project page is the only destination that actually shows this unit.")
    assert "/unit/" not in row["listing_url"], "a unit URL must never reach a card"


def test_the_unit_code_is_kept_so_the_user_can_find_its_row_on_that_page():
    # The project page prints «#F1-144-3 متاحة 1,350,000 ريال 2 160.49 م² rooftop» — verified live.
    row, _ = _map()
    assert row["additional_info"]["unit_code"] == "F1-144-3"
    assert row["additional_info"]["project_id"] == 66800


# ── 2. WHICH UNITS COUNT ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("status,ingested", [
    ("available", True),
    ("Available", True),       # 4 of 14,319 spell it this way; an exact compare dropped them
    ("AVAILABLE", True),
    ("reserved", False),       # 4,030 units — the source saying "not purchasable"
    ("sold-out", False),       # 1,740 units
    ("", False),
])
def test_only_available_units_are_ingested_case_insensitively(status, ingested):
    row, _ = _map(_unit(status=status))
    assert (row is not None) is ingested


def test_an_orphan_unit_is_skipped_because_it_can_say_nothing_about_itself():
    # 3,648 of the 8,549 available units. Price and area only — no project, title, code,
    # description or features. There is no honest way to place it or link to it.
    orphan = _unit(project=None, code="", desc="")
    orphan["title"] = {"rendered": ""}
    row, _ = R.map_unit(orphan, None, None, TREE)
    assert row is None, "a unit with no parent project has no location, no photo and no page"


# ── 3. THE PROJECT-LEVEL GATE ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("status,ingested", [
    ("متاح", True),
    ("قريبا", False),           # coming soon — not yet a purchasable unit
    ("وقف التسويق", False),      # marketing stopped
    ("تم البيع", False),         # sold out
    (None, True),               # 127 projects state NO status — silence is not a denial
])
def test_the_projects_own_status_gates_its_units(status, ingested):
    row, _ = _map(proj=_project(status=status))
    assert (row is not None) is ingested


# ── 4. LOCATION BY TREE WALK, catalog-validated at every level ──────────────────────────────────
def test_the_deepest_term_is_the_district_and_the_walk_finds_the_city():
    row, _ = _map(proj=_project(city_terms=(566,)))       # الياسمين → شمال الرياض → الرياض
    assert (row["city_ar"], row["city_id"]) == ("الرياض", _RIYADH)
    assert row["district_ar"] == "حي الياسمين"


def test_a_zone_is_never_mistaken_for_the_city():
    # «شمال الرياض» is a ZONE. It must not become city_ar — الرياض is the city.
    row, _ = _map(proj=_project(city_terms=(1434, 566)))
    assert row["city_ar"] == "الرياض", "the direction-prefixed zone is not a city"
    assert row["district_ar"] == "حي الياسمين"


@pytest.mark.parametrize("name,accepted", [
    ("الرياض", True),      # region 1 AND a real city in region 1 → the label is also the city
    ("جازان", True),       # same shape
    ("تبوك", True),
    ("الشرقية", False),    # region 5, but the only city of that name is a village in region 6
])
def test_a_bare_region_label_resolves_only_to_a_city_in_ITS_OWN_region(name, accepted, monkeypatch):
    """to_catalog() refuses an explicit «منطقة X» (the 2026-08-10 rule). rakez writes the BARE form,
    so that guard never fires and «الشرقية» matched a HOMONYM — loc_catalog_city really does hold a
    village called الشرقية in region 6. 182 Khobar/Dammam units were being filed under it."""
    monkeypatch.setattr(R, "_REGION_AR_FOR", {1: "منطقة الرياض", 5: "المنطقة الشرقية",
                                              7: "منطقة تبوك", 10: "منطقة جازان"})
    monkeypatch.setattr(R, "to_catalog", lambda n, region_hint=None: {
        "الرياض": (3, 1), "جازان": (17, 10), "تبوك": (1, 7),
        "الشرقية": (14645, 6),          # the village, in the WRONG region
    }.get(n, (None, None)))
    cid, _ = R._city_or_region_homonym(name)
    assert (cid is not None) is accepted


def test_a_region_root_does_not_become_a_city():
    # البندرية's chain ends at الشرقية — the Eastern PROVINCE, skipping الخبر. Trusting the tree's
    # own root would file a Khobar unit under a region that is not a city in our catalog.
    row, _ = _map(proj=_project(city_terms=(4620,), title="شقق ألين 152 - البندرية الخبر"))
    assert row is not None
    assert row["city_ar"] != "الشرقية", "a region must never be stored as the city"
    assert row["city_id"] is None and row["district_ar"] is None, (
        "nothing in the chain validates as a catalog city, so location stays NULL — never guessed")


def test_a_district_not_in_our_catalog_stays_null():
    row, _ = _map(proj=_project(city_terms=(9999,)))
    assert row["city_ar"] == "الرياض" and row["city_id"] == _RIYADH
    assert row["district_ar"] is None, "an unrecognised place is never invented"


def test_no_location_terms_at_all_yields_nulls_not_a_default():
    row, _ = _map(proj=_project(city_terms=()))
    assert row["city_ar"] is None and row["city_id"] is None and row["district_ar"] is None


# ── 5. FLOOR — the same field also carries property types and free text ─────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("ground", 0), ("Ground", 0), ("الأرضي", 0),
    ("first", 1), ("First", 1), ("الأول", 1),
    ("Second", 2), ("Fifth", 5),
    ("Villa", None), ("شقة", None), ("بنتهاوس", None),      # types, not floors
    ("الدور الأرضي ونصف الأول", None),                       # free text
    (False, None), (None, None),
])
def test_floor_number_only_from_a_real_ordinal(raw, expected):
    row, _ = _map(_unit(floor=raw))
    assert row["floor_number"] == expected


def test_the_raw_floor_value_is_never_lost():
    row, _ = _map(_unit(floor="Villa"))
    assert row["floor_number"] is None
    assert row["additional_info"]["floor_raw"] == "Villa", "kept verbatim rather than discarded"


# ── 6. TYPE, PRICE, PHOTO ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("ar_type,expected", [
    ("أدوار", "Floor"), ("شقق", "Apartment"), ("فلل", "Villa"), ("بنتهاوس", "Apartment"),
])
def test_the_projects_arabic_type_maps_exactly(ar_type, expected):
    row, _ = _map(proj=_project(ptype=ar_type))
    assert row["property_type"] == expected


def test_an_unmapped_or_missing_type_is_skipped_never_guessed():
    assert _map(proj=_project(ptype="شيء غريب"))[0] is None
    assert _map(proj=_project(ptype=None))[0] is None


def test_price_and_area_are_the_units_own_and_a_silent_field_stays_null():
    row, _ = _map(_unit(price=1350000, area=160.49, rooms=2))
    assert (row["price_total"], row["area_m2"], row["bedrooms"]) == (1350000, 160, 2)
    assert row["bathrooms"] is None, "not published per unit — never inferred from room count"
    bare, _ = _map(_unit(price=None, area=None, rooms=None))
    assert bare["price_total"] is None and bare["area_m2"] is None


def test_the_photo_is_inherited_from_the_project_and_absent_means_empty():
    row, _ = _map()
    assert row["photo_urls"] == ["https://rakez.sa/wp-content/uploads/2026/07/a.jpg"]
    bare, _ = _map(proj=_project(photo=False))
    assert bare["photo_urls"] == [], "no photo at source stays empty, never a placeholder"


def test_the_deal_is_buy_because_this_source_publishes_no_rent():
    row, _ = _map()
    assert row["transaction_type"] == "Buy" and row["price_annual"] is None


def test_amenities_from_the_project_are_preserved_verbatim():
    row, _ = _map(proj=_project(features=("مصعد", "أنظمة أمن وسلامة")))
    assert "مصعد" in row["additional_info"]["features_ar"]


# ── 7. The liveness oracle: UNKNOWN must never kill ─────────────────────────────────────────────
def test_verify_gone_treats_a_bare_404_as_unknown_not_gone(monkeypatch):
    class _R:
        status_code = 404
        def json(self): return {"code": "waf_blocked"}
    monkeypatch.setattr(R.cc, "get", lambda *a, **k: _R())
    verdict, why = R._verify_gone("RKZ1")
    assert verdict == "unknown", f"a 404 without rest_post_invalid_id is not proof of removal: {why}"


def test_verify_gone_reads_a_status_flip_as_gone(monkeypatch):
    class _R:
        status_code = 200
        def json(self): return {"id": 1, "acf": {"unit_status": "sold-out"}}
    monkeypatch.setattr(R.cc, "get", lambda *a, **k: _R())
    assert R._verify_gone("RKZ1")[0] == "gone"


def test_verify_gone_says_live_while_the_unit_is_still_available(monkeypatch):
    class _R:
        status_code = 200
        def json(self): return {"id": 1, "acf": {"unit_status": "Available"}}
    monkeypatch.setattr(R.cc, "get", lambda *a, **k: _R())
    assert R._verify_gone("RKZ1")[0] == "live", "the capital-A variant must not read as dead"
