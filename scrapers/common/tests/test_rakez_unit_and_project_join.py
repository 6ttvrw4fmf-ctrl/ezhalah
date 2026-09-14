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
             title="أدوار إرث ( اي كيو ) - الياسمين الرياض", features=(), offer=None):
    terms = [{"taxonomy": "city", "id": t, "name": TREE[t]["name"]} for t in city_terms]
    if offer:
        terms.append({"taxonomy": "offer-group", "name": offer})
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


# ── 3b. OFF-PLAN is not a listing we show ───────────────────────────────────────────────────────
@pytest.mark.parametrize("offer,ingested", [
    ("البيع على الخارطة", False),   # "selling on the map" — a drawing, a price and a wait
    ("Off-plan sales", False),      # the English twin carries it too
    ("by rakez", True),             # an ordinary marketing group, not a construction signal
    ("سكف", True),
    (None, True),                   # untagged → "not stated", and NOT excluded
])
def test_an_off_plan_project_contributes_no_listings(offer, ingested):
    """«البيع على الخارطة» is a SECOND not-yet-built signal, independent of property-status: a
    project can be «متاح» (available to buy) AND off-plan at the same time. That combination is
    exactly how 99 listings across 7 projects reached production on 2026-09-14 — the card showed a
    finished building and a ready price for something that does not physically exist."""
    row, _ = _map(proj=_project(status="متاح", offer=offer))
    assert (row is not None) is ingested


def test_off_plan_is_checked_on_EITHER_language_record():
    # The bridge can fail; the English record must still be able to veto.
    en = _project(offer="Off-plan sales")
    ar = _project(offer=None)
    row, _ = R.map_unit(_unit(), en, ar, TREE)
    assert row is None, "an off-plan tag on the English record alone must still exclude"
    row2, _ = R.map_unit(_unit(), _project(offer=None), _project(offer="البيع على الخارطة"), TREE)
    assert row2 is None, "…and on the Arabic record alone"


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


# ── 6b. The Arabic bridge is retried — one flaky fetch costs a whole project ────────────────────
def test_the_arabic_bridge_retries_before_giving_up(monkeypatch):
    """A project with no Arabic twin yields no Arabic property-type, so map_unit() drops EVERY unit
    under it. With 274 bridge fetches per run, a single un-retried miss is near-certain and silently
    costs ~14 listings."""
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    calls = {"n": 0}

    class _Flaky:
        def get(self, url, timeout=None):
            calls["n"] += 1
            if calls["n"] < 3:
                raise TimeoutError("curl: (28) timed out")
            class _R:
                status_code = 200
                text = '<body class="rtl postid-66825 single-project">'
            return _R()

    assert R.arabic_project_id(_Flaky(), 66800) == 66825
    assert calls["n"] == 3, f"expected 3 attempts, made {calls['n']}"


def test_the_bridge_still_gives_up_bounded_on_a_dead_project(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    calls = {"n": 0}

    class _Dead:
        def get(self, url, timeout=None):
            calls["n"] += 1
            raise TimeoutError("curl: (28) timed out")

    assert R.arabic_project_id(_Dead(), 66800) is None
    assert calls["n"] == 3, "must stop after 3 attempts, not loop"


def test_a_non_200_from_the_bridge_is_also_retried_then_refused(monkeypatch):
    # Unlike a REST feed, a 502/503 on this HTML page is worth retrying — it is a page fetch, not
    # the source deliberately answering a query.
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    calls = {"n": 0}

    class _FiveHundred:
        def get(self, url, timeout=None):
            calls["n"] += 1
            class _R:
                status_code = 503
                text = ""
            return _R()

    assert R.arabic_project_id(_FiveHundred(), 66800) is None
    assert calls["n"] == 3


# ── 6c. An empty prerequisite must FAIL the run, not produce a quiet 0-row success ──────────────
@pytest.mark.parametrize("empty,expect", [
    ("units", "no units"),
    ("en_projects", "ZERO projects"),
    ("tree", "ZERO location terms"),
    ("ar_projects", "ZERO Arabic projects"),
])
def test_an_empty_prerequisite_raises_instead_of_upserting_nothing(empty, expect, monkeypatch,
                                                                   capsys):
    """A unit carries only numbers — its type and location live on the project and the tree. If
    either came back empty while units did not, every unit maps to None: a run that reads as merely
    disappointing (0 rows, ok=true) while being a total fetch failure, which then hands
    prune_unseen an empty seen-set."""
    full_unit = [{"id": 1, "acf": {"unit_project": 66800, "unit_status": "available"}}]
    monkeypatch.setattr(R, "fetch_units", lambda s: [] if empty == "units" else full_unit)
    monkeypatch.setattr(R, "fetch_city_terms", lambda s: {} if empty == "tree" else TREE)
    monkeypatch.setattr(R, "fetch_projects",
                        lambda s, lang="": ({} if empty == ("ar_projects" if lang else "en_projects")
                                            else {66800: _project()}))
    monkeypatch.setattr(R.db, "begin_run", lambda *a, **k: 1, raising=False)
    ended = {}
    monkeypatch.setattr(R.db, "end_run",
                        lambda rid, **kw: ended.update(kw) or True, raising=False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    rc = R.main()
    assert rc == 1, "an empty prerequisite must fail the run"
    assert ended.get("ok") is False, "and it must be recorded as a FAILED run, not a quiet success"
    assert expect in (ended.get("notes") or ""), (
        f"the note must name which leg broke; got {ended.get('notes')!r}")


def test_a_TOTAL_bridge_failure_fails_the_run(monkeypatch):
    """REST answering while the HTML bridge does not is an outage, not a shortfall: nothing can be
    typed or located, so the run would end 0-rows-ok. The likeliest cause in production is a WAF
    treating the CI runner's IP differently from a laptop — exactly when nobody is watching."""
    monkeypatch.setattr(R, "fetch_units", lambda s: [
        {"id": 1, "acf": {"unit_project": 66800, "unit_status": "available"}}])
    monkeypatch.setattr(R, "fetch_city_terms", lambda s: TREE)
    monkeypatch.setattr(R, "fetch_projects", lambda s, lang="": {66800: _project()})
    monkeypatch.setattr(R, "arabic_project_id", lambda s, en_id: None)   # bridge is dead
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(R.db, "begin_run", lambda *a, **k: 1, raising=False)
    ended = {}
    monkeypatch.setattr(R.db, "end_run", lambda rid, **kw: ended.update(kw) or True, raising=False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 1
    assert ended.get("ok") is False
    assert "Arabic bridge resolved 0" in (ended.get("notes") or ""), ended.get("notes")


def test_a_PARTIAL_bridge_failure_does_not_fail_the_run(monkeypatch):
    # Losing some projects is a shortfall worth printing, not a reason to discard a good run.
    monkeypatch.setattr(R, "fetch_units", lambda s: [
        {"id": 1, "acf": {"unit_project": 66800, "unit_status": "available",
                          "price": 1, "rooms_count": 1, "area": 1, "floor": "first"}},
        {"id": 2, "acf": {"unit_project": 999, "unit_status": "available"}}])
    monkeypatch.setattr(R, "fetch_city_terms", lambda s: TREE)
    # the ARABIC dict is keyed by the TWIN id (66825), which is what the bridge resolves to
    monkeypatch.setattr(R, "fetch_projects", lambda s, lang="": (
        {66825: _project(66825)} if lang == "ar" else {66800: _project(), 999: _project(999)}))
    monkeypatch.setattr(R, "arabic_project_id", lambda s, en_id: 66825 if en_id == 66800 else None)
    monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(R.db, "begin_run", lambda *a, **k: 1, raising=False)
    monkeypatch.setattr(R.db, "end_run", lambda rid, **kw: True, raising=False)
    monkeypatch.setattr(R.db, "upsert_rakez_residential_batch", lambda rows: None, raising=False)
    monkeypatch.setattr(R.db, "upsert_rakez_commercial_batch", lambda rows: None, raising=False)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0, raising=False)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **kw: 0, raising=False)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert R.main() == 0, "a partial bridge loss must not discard the rest of the run"


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
