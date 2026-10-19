"""razre (راز العقارية, www.razre.sa) — the five things that would silently break this platform.

Every fixture below is a VERBATIM Wix cloud-data record captured from
POST /_api/cloud-data/v1/wix-data/collections/query on 2026-09-24, trimmed to the keys the shipping
code reads (galleries and scheme lists cut to one entry). Every assertion executes the SHIPPING
functions — scrapers.razre.run.map_listing / city_from_address / units_on_page / _signal — never a
copy of them.

WHAT IS GUARDED, AND WHY EACH ONE IS A REAL DEFECT ON THIS SITE
--------------------------------------------------------------
1. THE PRICE FIELD IS TEXT AND ITS NUMERIC SIBLING IS A TRAP. `Depart.price` and `Import726.price1`
   hold "560,000" / "840,000"; `Import726` also has a numeric `price` present on only 350 of its 418
   rows. normalize.to_int_numeric("560,000") is None because float() raises on the comma, so a mapper
   that reached for the "numeric" helper — the natural choice for a JSON API — would store NO price
   for any razre unit while every other field looked perfect.

   MUTATION-VERIFIED (2026-09-24). Five bugs were re-introduced into scrapers/razre/run.py one at a
   time, each watched to FAIL here and then pass again after restoring (31 passed each time). The
   quoted text is the assertion message pytest actually printed:
     (a) the core price guard — `normalize.to_int(price_text)` → `normalize.to_int_numeric(...)`:
         4 failed. test_price_is_the_source_text_read_verbatim —
           "RAZ 10 A5: stored AUTHORITATIVE_NULL for the source's own '560,000'."
     (b) reading the numeric column where it exists (`unit.get(uk["price_num"]) if uk["price_num"]`):
         2 failed. test_the_numeric_price_sibling_is_never_preferred_over_the_text —
           "stored AUTHORITATIVE_NULL for '840,000' while the row's own source_price_numeric_raw
            is None" — i.e. exactly the 60 com rows that publish only the text.
     (c) deriving a missing price from the area (`… else (_pos(area) or 0) * 5000`):
         1 failed. test_a_blank_price_is_an_authoritative_null —
           "RAZ 15 B1 stored 0 — the source prints an EMPTY «السعر:»."
     (d) the removal oracle's family gate — `_lists_every_unit` → `return True`:
         1 failed. test_absence_is_death_on_the_family_whose_pages_list_every_unit_… —
           the /com/ page, which shows 20 of up to 98 units, would have been trusted to prove
           absence, so every unit on its unseen pages becomes a false kill.
     (e) not skipping a sold/reserved unit (`if ustatus != _UNIT_AVAILABLE` → a dead branch):
         3 failed, including both parametrised cases of
         test_the_sources_own_status_words_skip_with_their_own_counted_reason — 330 «مباع» units
         would have been published as available inventory.

2. RENT PERIOD. razre sells only — no period field, no rent vocabulary in any of the 924 unit
   records (measured). So the guard is that rent_period and price_annual are NEVER written, not even
   when a period WORD is present in the record's own text: a stated «شهري» must not become a ×12
   conversion of a SALE price. test_a_period_word_in_the_record_never_creates_a_rent_period proves
   the silence holds and that the figure is stored unconverted as a total.

3. PDPL. `Properties.agentEmail` is a field named for an e-mail that actually holds «الحي»
   (the district). The payloads are built from key ALLOWLISTS, so a poisoned record with a phone in
   the title, a real address in agentEmail, a wa.me link in a gallery caption and an extra
   `advertiserPhone` key must leak none of it into any column, additional_info or source_capture.

4. THE SOURCE'S OWN READY / SOLD MARKERS. «قريباً» (project coming soon), «تم البيع بالكامل»
   (project sold out), «مباع» (unit sold) and «محجوز» (unit reserved) each skip with their OWN
   counted reason, using the source's word — never a heuristic, never silently dropped.

5. IDENTITY. «رقم الوحدة» is a unit MODEL that repeats down the building: RAZ 34 has seven units all
   labelled «A». The ad_number must be the CMS record's `_id`, or seven listings collapse into one.

Run: python -m pytest scrapers/common/tests/test_razre_price_status_identity_and_pdpl.py -v
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.arabic_location as _al  # noqa: E402
from scrapers.common import db  # noqa: E402
from scrapers.razre import run as R  # noqa: E402

_JEDDAH, _REGION = 18, 2          # loc_catalog_city, read from production 2026-09-24
_DISTRICTS = ["حي السلامة", "حي المنار", "حي النسيم", "حي النخيل", "حي النهضة"]


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    """The real catalog rows for Jeddah, so to_catalog / find_district_in_text run for real."""
    monkeypatch.setitem(_al._CITY, _al.norm_ar("جدة"), [(_JEDDAH, _REGION)])
    monkeypatch.setitem(_al._REGION_NORM, _al.norm_ar("مكة المكرمة"), _REGION)
    monkeypatch.setitem(_al._CID_AR, _JEDDAH, "جدة")
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _JEDDAH,
                        {_al.norm_district_tok(d) for d in _DISTRICTS})
    for d in _DISTRICTS:
        monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
        monkeypatch.setitem(_al._DISTRICT_AR_BY_CITY, (_JEDDAH, _al.norm_district_tok(d)), d)
    monkeypatch.setattr(_al, "_load", lambda: None)


# ── VERBATIM CAPTURES ────────────────────────────────────────────────────────────────────────────
_JEDDAH_SUBDIVISIONS = [
    {"code": "Makkah Province", "name": "Makkah Province", "type": "ADMINISTRATIVE_AREA_LEVEL_1"},
    {"code": "Jeddah", "name": "Jeddah", "type": "ADMINISTRATIVE_AREA_LEVEL_2"},
    {"code": "SA", "name": "Saudi Arabia", "type": "COUNTRY"},
]
_GALLERY = [{"description": "", "slug": "496182_455821f929554962bea824f6f5131658~mv2.jpg",
             "alt": "", "title": "", "type": "image",
             "src": "wix:image://v1/496182_455821f929554962bea824f6f5131658~mv2.jpg/_.jpg"
                    "#originWidth=7008&originHeight=4672"}]

# Properties/10 «RAZ 10» — a SELLING building whose address carries the structured city.
P10 = {"noid": "10", "title": "RAZ 10", "status": "بدأ البيع", "hide": True,
       "agentEmail": "المنار-الياسمين مول",          # named agentEmail, holds «الحي»
       "floors": 4.0, "bedrooms": 12.0, "bathrooms": 2.0,
       "address": {"subdivisions": _JEDDAH_SUBDIVISIONS, "city": "Jeddah",
                   "formatted": "H6XJ+JM6, Al-Manar, Jeddah 23462", "country": "SA",
                   "postalCode": "23462", "subdivision": "02"},
       "gallery": _GALLERY,
       "image": "wix:image://v1/496182_53472ff0499e4dffa9d48bf934c60810~mv2.jpg/_DSC4403-Edit.jpg"
                "#originWidth=4977&originHeight=3318",
       "scheme": _GALLERY, "link-copy-of-onepro-1-title": "/onepro-1/10"}

# Properties/15 «RAZ 15» — SELLING, and its address has NO structured `city`: the city is only in
# `formatted`. Reading address.city alone dropped this building's one available unit.
P15 = {"noid": "15", "title": "RAZ 15", "status": "بدأ البيع", "hide": True,
       "agentEmail": "النسيم", "floors": 4.0, "bedrooms": 15.0, "bathrooms": 1.0,
       "address": {"formatted": "G68H+2X An Naseem, Jeddah"},
       "gallery": _GALLERY, "link-copy-of-onepro-1-title": "/onepro-1/15"}

# Properties/05 «RAZ 5» — «تم البيع بالكامل».
P_SOLD_OUT = {"noid": "05", "title": "RAZ 5", "status": "تم البيع بالكامل", "hide": True,
              "agentEmail": "المنار", "floors": 4.0,
              "address": {"subdivisions": _JEDDAH_SUBDIVISIONS, "city": "Jeddah",
                          "formatted": "J65H+GX Al-Manar, Jeddah"},
              "gallery": _GALLERY, "link-copy-of-onepro-1-title": "/onepro-1/05"}

# Import872/1 «HAVEN 1» — a SELLING compound with 22 available units that names NO city anywhere
# (no `address` key at all; /com/1's HTML contains neither "Jeddah" nor «جدة»).
C1 = {"no_id": 1.0, "title": "HAVEN 1", "status": "بدأ البيع", "hide": True, "dist": "النهضة",
      "floor": 5.0, "no_dep": 68.0, "no_building": 4.0, "extension": 8.0,
      "gallery": _GALLERY, "link-compound-title": "/com/1"}

# Import872/5 «INVEST 2» — «قريباً» (the site's own off-plan badge), 98 units behind it.
C5 = {"no_id": 5.0, "title": "INVEST 2", "status": "قريباً", "hide": False, "dist": "الروضة",
      "floor": 2.0, "no_dep": 98.0,
      "address": {"subdivisions": _JEDDAH_SUBDIVISIONS, "city": "Jeddah",
                  "formatted": "JERB3209, 3209 Muhammad Iqbal, 7575, AR Rawdah District, "
                               "Jeddah 23433, Saudi Arabia"},
      "gallery": _GALLERY, "link-compound-title": "/com/5"}

# Depart — RAZ 10's «A5»: available, a ملحق, and its card on /onepro-1/10 reads
# «A5 رقم الوحدة متاح ريال 560,000 السعر: … ملحق الخامس داخلية … 144 3 2».
D_A5 = {"_id": "dcf0be5f-95cb-4dea-a15f-bede94815233", "title": "10", "depno": "A5",
        "type": "ملحق", "flour": "الخامس", "area": 144.0, "rooms": 3.0, "bath": "2",
        "direction": "داخلية", "status": "متاح", "price": "560,000"}

# Depart — RAZ 15's «B1»: available and its card prints an EMPTY «ريال ​ السعر:» and no area. The
# record simply has no `price` and no `area` key.
D_B1 = {"_id": "7718b382-5d79-4daa-bf03-2abf30e1d6f3", "title": "15", "depno": "B1",
        "type": "شقة", "flour": "الرابع", "rooms": 4.0, "bath": "3", "direction": "أمامية",
        "status": "متاح"}

D_SOLD = {"_id": "d3776872-91b2-45e1-bfe6-813ac9a7c43e", "title": "10", "depno": "B1",
          "type": "شقة", "flour": "الأول", "area": 93.0, "rooms": 3.0, "bath": "2",
          "direction": "أمامية", "status": "مباع", "price": "450,000"}
D_RESERVED = {"_id": "d5ece748-8310-4437-8733-6235ed28f53e", "title": "15", "depno": "D2",
              "type": "شقة", "flour": "الثاني", "area": 99.0, "rooms": 3.0, "bath": "3",
              "direction": "داخلية", "status": "محجوز", "price": "480,000"}

# Import726 — HAVEN 1's «C / A1»: text price and NO numeric sibling (60 com rows are like this).
U_TEXT_ONLY = {"_id": "d139dae2-5f5f-4438-a956-749a772f4a2b", "no_id": 1.0, "b_name": "C",
               "dep_no": "A1", "form": "A", "kind": "شقة", "floor": "الأول", "area": 110.5,
               "rooms": 4.0, "bath": 4.0, "face": "أمامية", "status": "متاح", "price1": "840,000"}
# Import726 — INVEST 2's «B / B»: BOTH fields, and they agree (350 of 350 measured).
U_BOTH = {"_id": "acba432d-97b3-4231-93bd-d555e75c24ef", "no_id": 5.0, "b_name": "B",
          "dep_no": "B", "kind": "ملحق", "floor": "الثالث", "area": 164.0, "rooms": 2.0,
          "bath": 2.0, "face": "شارع", "status": "متاح", "price": 855600.0, "price1": "855,600"}

# Depart — RAZ 34's seven «A» units, one per floor. The same «رقم الوحدة» seven times over.
D_DUP_A = [
    {"_id": "7c0d04be-4d8c-4d30-b3c4-841e0cbbf95b", "flour": "الأول", "area": 144.7},
    {"_id": "ea6fac71-104f-4673-893e-631f35a69b0b", "flour": "الثاني", "area": 145.83},
    {"_id": "e17eeb89-1c31-4dc1-9500-c3801d43bc42", "flour": "الثالث", "area": 144.05},
    {"_id": "3f5da7c1-f7fe-4ba0-86f0-db47c02a5e2f", "flour": "الرابع", "area": 140.35},
    {"_id": "f89192a9-94ce-4e84-a661-d4ecf88735f3", "flour": "الخامس", "area": 144.44},
    {"_id": "e9dc6e73-2904-4e50-b8a4-5e9711b516c0", "flour": "السادس", "area": 146.25},
    {"_id": "9881a868-fa81-4172-8ade-dd4b71b7a58d", "flour": "السابع", "area": 161.63},
]
P34 = {**P10, "noid": "34", "title": "RAZ 34", "agentEmail": "السلامة",
       "link-copy-of-onepro-1-title": "/onepro-1/34"}


def _row(unit, parent, fam="onepro"):
    row, cat, why = R.map_listing(copy.deepcopy(unit), copy.deepcopy(parent), fam)
    assert row is not None, f"expected a row, got skip {why!r}"
    return row, cat


def _skip(unit, parent, fam="onepro"):
    row, _cat, why = R.map_listing(copy.deepcopy(unit), copy.deepcopy(parent), fam)
    assert row is None, f"expected a skip, got a row {row.get('ad_number')}"
    return why


# ── 1. THE PRICE TRAP ────────────────────────────────────────────────────────────────────────────
def test_price_is_the_source_text_read_verbatim():
    """«560,000» → 560000. This is the assertion that fails when to_int_numeric is used (mutation a)."""
    row, _ = _row(D_A5, P10)
    assert row["price_total"] == 560000, (
        f"RAZ 10 A5: stored {row['price_total']!r} for the source's own '560,000'. "
        "normalize.to_int_numeric() returns None on a comma — the TEXT helper to_int() is required.")
    assert row["price_evidence"]["raw"] == "560,000"     # the source's string, kept as published
    assert row["price_evidence"]["field"] == "Depart.price"
    assert row["price_evidence"]["origin"] == "api"
    assert row["price_evidence"]["authoritative_absent"] is False


def test_the_numeric_price_sibling_is_never_preferred_over_the_text():
    """60 of 418 com units publish only `price1`; preferring `price` blanks every one of them.
    And where both exist the text still wins — provably harmless, since they never disagree."""
    text_only, _ = _row(U_TEXT_ONLY, C1_WITH_CITY := {**C1, "address": {"city": "Jeddah"}}, "com")
    assert text_only["price_total"] == 840000, (
        f"stored {text_only['price_total']!r} for '840,000' while the row's own "
        f"source_price_numeric_raw is "
        f"{text_only['additional_info'].get('source_price_numeric_raw')!r}")
    both, _ = _row(U_BOTH, {**C5, "status": "بدأ البيع"}, "com")
    assert both["price_total"] == 855600
    assert both["price_evidence"]["field"] == "Import726.price1"
    assert both["price_evidence"]["raw"] == "855,600"
    # The numeric mirror is preserved so a future divergence is auditable from the row alone.
    assert both["additional_info"]["source_price_numeric_raw"] == 855600.0


def test_a_blank_price_is_an_authoritative_null():
    """RAZ 15's B1 card prints «ريال ​ السعر:» with nothing in it. Nothing may be manufactured — and
    the NULL must be authoritative, or a price the developer deletes freezes forever."""
    row, _ = _row(D_B1, P15)
    assert row["price_total"] is db.AUTHORITATIVE_NULL, (
        f"RAZ 15 B1 stored {row['price_total']!r} — the source prints an EMPTY «السعر:». "
        "No figure may be derived from the area, the model, or a sibling unit.")
    ev = row["price_evidence"]
    assert (ev["stored"], ev["found"], ev["authoritative_absent"]) == (None, False, True)
    assert "area_m2" not in row or row["area_m2"] is None   # the card's «المساحة» is empty too


def test_nothing_multiplies_or_divides_the_published_figure():
    """Every stored price equals the digits of the source's own string. No ×12, no per-metre × area,
    no rounding — the 4 available fixtures across both families, checked arithmetically."""
    for unit, parent, fam in ((D_A5, P10, "onepro"),
                              (U_TEXT_ONLY, {**C1, "address": {"city": "Jeddah"}}, "com"),
                              (U_BOTH, {**C5, "status": "بدأ البيع"}, "com")):
        row, _ = _row(unit, parent, fam)
        raw = row["additional_info"]["source_price_text_raw"]
        assert row["price_total"] == int(raw.replace(",", "")), f"{raw} → {row['price_total']}"
        assert row["price_evidence"]["unit"] == "total"
        assert row["price_evidence"]["kind"] == "total"


# ── 2. RENT PERIOD ───────────────────────────────────────────────────────────────────────────────
def test_a_period_word_in_the_record_never_creates_a_rent_period():
    """razre publishes no period field and no rent vocabulary. A period WORD appearing in a record
    must not turn a SALE price into an annualised rent: the keys stay absent (so db's
    unknown-must-not-overwrite-known drops them) and the figure is stored unconverted."""
    poisoned = {**D_A5, "depno": "A5 شهري", "flour": "الخامس"}
    row, _ = _row(poisoned, {**P10, "title": "RAZ 10 إيجار سنوي"})
    assert row["transaction_type"] == "Buy"
    assert "rent_period" not in row, "razre has no rents — a period must never be written"
    assert "price_annual" not in row, "a sale price must never be parked in price_annual"
    assert row["price_total"] == 560000, "the figure must be stored exactly as published, unconverted"


# ── 3. PDPL ──────────────────────────────────────────────────────────────────────────────────────
def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """An allowlist, not a blocklist: a contact field added to either collection tomorrow cannot
    arrive by default, and the free-text keys inside the allowlist are redacted."""
    bad_unit = {**D_A5,
                "depno": "A5 للتواصل 0555754441",
                "advertiserPhone": "0501234567",         # a key that does not exist today
                "agentWhatsapp": "https://wa.me/966555754441"}
    bad_parent = {**P10,
                  "title": "RAZ 10 — اتصل 0555754441",
                  "agentEmail": "broker@razre.sa",       # the field NAMED for an e-mail, poisoned
                  "propertieType": "مخطط الفهد واتساب wa.me/966501112223",
                  "_owner": "4961822d-f0e2-454f-a78a-93010252d3f6",
                  "brokerName": "أبو محمد"}
    row, _ = _row(bad_unit, bad_parent)
    blob = json.dumps({k: v for k, v in row.items() if k != "price_evidence"},
                      ensure_ascii=False, default=str)
    for leak in ("0555754441", "0501234567", "wa.me", "broker@razre.sa",
                 "advertiserPhone", "agentWhatsapp", "brokerName", "_owner",
                 "4961822d-f0e2-454f-a78a-93010252d3f6"):
        assert leak not in blob, f"{leak!r} reached a stored payload — PDPL"
    # …and the test is not passing because the payloads went empty.
    assert row["source_capture"]["unit"]["status"] == "متاح"
    assert row["source_capture"]["project"]["status"] == "بدأ البيع"
    assert row["additional_info"]["project_status"] == "بدأ البيع"


def test_the_district_field_named_agentemail_is_still_read_as_a_district():
    """`Properties.agentEmail` is displayName «الحي». Its real values must place the listing, and the
    compound label «المنار-الياسمين مول» must resolve to the catalog's own «حي المنار»."""
    row, _ = _row(D_A5, P10)
    assert row["district_ar"] == "حي المنار"
    assert row["neighborhood"] == "المنار-الياسمين مول"   # the source's raw label, kept
    assert row["city_ar"] == "جدة" and row["city_id"] == _JEDDAH and row["region_id"] == _REGION


# ── 4. THE SOURCE'S OWN READY / SOLD MARKERS ─────────────────────────────────────────────────────
@pytest.mark.parametrize("unit,parent,fam,reason", [
    (U_TEXT_ONLY, C5, "com", "off_plan_project"),          # «قريباً» — the site's own badge
    (D_A5, P_SOLD_OUT, "onepro", "project_sold_out"),       # «تم البيع بالكامل»
    (D_SOLD, P10, "onepro", "unit_sold"),                   # «مباع»
    (D_RESERVED, P15, "onepro", "unit_reserved"),            # «محجوز»
])
def test_the_sources_own_status_words_skip_with_their_own_counted_reason(unit, parent, fam, reason):
    assert _skip(unit, parent, fam) == reason


def test_an_unseen_status_is_skipped_and_named_never_read_as_ready():
    """A fourth project status or unit status must not default to available — the reason carries the
    word so onboarding sees it, and an «مزاد» (auction) type has no mapping and cannot slip through."""
    assert _skip(D_A5, {**P10, "status": "تحت الإنشاء"}) == "project_status_unknown_تحت الإنشاء"
    assert _skip({**D_A5, "status": "قيد التعاقد"}, P10) == "unit_status_unknown_قيد التعاقد"
    assert _skip({**D_A5, "type": "مزاد"}, P10) == "type_unmapped_مزاد"
    assert _skip({**D_A5, "status": None}, P10) == "unit_status_unknown_blank"


def test_a_unit_with_no_parent_is_skipped_not_placed():
    """19 Depart rows carry `title` null — no building, so no city, no URL, no listing."""
    assert _skip(D_A5, None) == "unit_orphaned"


# ── 5. IDENTITY ──────────────────────────────────────────────────────────────────────────────────
def test_the_repeating_unit_model_does_not_collapse_seven_listings_into_one():
    """RAZ 34's seven «A» units differ only by floor and area. Keying on «رقم الوحدة» would store
    one. The CMS `_id` is the only identity that is unique by construction."""
    rows = [_row({**D_A5, **dup, "depno": "A", "status": "متاح", "title": "34"}, P34)[0]
            for dup in D_DUP_A]
    assert len({r["ad_number"] for r in rows}) == 7, "seven units collapsed into fewer ad_numbers"
    assert all(r["ad_number"] == "RAZ" + d["_id"] for r, d in zip(rows, D_DUP_A))
    # All seven share the project page, and each row still carries its own unit identity.
    assert {r["listing_url"] for r in rows} == {"https://www.razre.sa/onepro-1/34"}
    assert len({(r["additional_info"]["unit_model"], r["additional_info"]["floor_ar"])
                for r in rows}) == 7
    assert len({r["title"] for r in rows}) == 7


def test_the_listing_url_is_the_parents_own_pagelink_never_constructed():
    row, _ = _row(D_A5, P10)
    assert row["listing_url"] == "https://www.razre.sa/onepro-1/10"
    com, _ = _row(U_TEXT_ONLY, {**C1, "address": {"city": "Jeddah"}}, "com")
    assert com["listing_url"] == "https://www.razre.sa/com/1"
    assert _skip(D_A5, {**P10, "link-copy-of-onepro-1-title": None}) == "no_project_page_link"


# ── the field names that lie ──────────────────────────────────────────────────────────────────────
def test_rooms_is_total_rooms_and_never_becomes_bedrooms():
    """The card prints «الغرف», not «غرف نوم» — and `Properties.bedrooms` is «عدد الشقق», the
    BUILDING's flat count (12 for RAZ 10). Neither may reach the bedrooms column."""
    row, _ = _row(D_A5, P10)
    assert "bedrooms" not in row, "razre states no bedroom count; the column must stay untouched"
    assert row["additional_info"]["total_rooms"] == 3          # «الغرف» 3, the card's own number
    assert row["additional_info"]["project_flats_total"] == 12  # «عدد الشقق», a building attribute
    assert row["bathrooms"] == 2                               # «دورات المياه», the unit's own


def test_the_facing_word_never_becomes_a_compass_direction():
    """«الجهة» values are أمامية / داخلية / لاند سكيب / شارع / شارعين — none is a bearing."""
    for face in ("أمامية", "داخلية", "لاند سكيب", "شارع", "شارعين", "شارع ولاند سكيب"):
        row, _ = _row({**D_A5, "direction": face}, P10)
        assert "direction" not in row, f"«{face}» is not a compass direction"
        assert row["additional_info"]["facing_ar"] == face


def test_floor_ordinals_map_and_the_ground_floor_is_zero_not_missing():
    for ar, n in (("الأرضي", 0), ("الأول", 1), ("الخامس", 5), ("العاشر", 10)):
        row, _ = _row({**D_A5, "flour": ar}, P10)
        assert row["floor_number"] == n, f"«{ar}» → {row['floor_number']}, expected {n}"
    assert _row({**D_A5, "flour": "الحادي عشر"}, P10)[0]["floor_number"] is None


# ── type mapping ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("type_ar,expected", [("شقة", "Apartment"), ("ملحق", "Floor")])
def test_type_mapping_is_the_fleets_own(type_ar, expected):
    """«شقة» through the shared TYPE_MAP_AR; «ملحق» → Floor is the mapping eaqartabuk,
    fahadalshahri and bossbih already ship. Both are residential."""
    row, cat = _row({**D_A5, "type": type_ar}, P10)
    assert row["property_type"] == expected
    assert cat == "residential"
    assert row["additional_info"]["type_ar"] == type_ar


# ── city ─────────────────────────────────────────────────────────────────────────────────────────
def test_the_city_is_read_from_both_address_shapes_and_from_formatted_when_city_is_missing():
    """Three shapes, all real: the address object with `city`, the object with only `formatted`, and
    a bare STRING address (Import872/6). Reading `address.city` alone dropped RAZ 15's unit."""
    assert R.city_from_address(P10["address"]) == ("جدة", "Makkah Province", "Jeddah")
    assert R.city_from_address(P15["address"]) == ("جدة", None, "Jeddah")
    assert R.city_from_address("J46C+P6 An Nahdah, Jeddah") == ("جدة", None, "Jeddah")
    assert R.city_from_address({"formatted": "… الروضة، 2837، جدة 23435"})[0] == "جدة"
    row, _ = _row(D_B1, P15)          # the unit that the narrow read used to lose
    assert (row["city_ar"], row["city_id"], row["district_ar"]) == ("جدة", _JEDDAH, "حي النسيم")


def test_a_project_that_names_no_city_is_skipped_and_never_placed_from_its_district():
    """HAVEN 1 is a SELLING compound with 22 available units and no address at all. Its النهضة
    district exists in several Saudi cities, so nothing may be inferred from it."""
    assert _skip(U_TEXT_ONLY, C1, "com") == "city_unstated"
    assert _skip(D_A5, {**P10, "address": {"formatted": "21°36'31.7\"N 39°08'51.3\"E"}}) \
        == "city_unstated"
    # A city the map does not know is named in the reason, not silently placed.
    assert _skip(D_A5, {**P10, "address": {"city": "Dubai"}}) == "city_unmapped_Dubai"
    # …and a plus-code or a street that merely looks Saudi cannot place anything.
    assert R.city_from_address({"formatted": "H6XJ+JM6, Al-Manar 23462"}) == (None, None, None)


# ── photos ───────────────────────────────────────────────────────────────────────────────────────
def test_photos_come_from_the_project_gallery_and_never_from_a_status_badge():
    row, _ = _row({**D_A5, "status_image": "wix:image://v1/496182_badge~mv2.png/مباع.png"}, P10)
    assert row["photo_urls"] == [
        "https://static.wixstatic.com/media/496182_455821f929554962bea824f6f5131658~mv2.jpg"]
    assert "badge" not in json.dumps(row, default=str)
    assert row["images_evidence"]["source_field"] == "gallery"
    # RAZ 16 publishes no gallery — the grid card artwork is the documented fallback, and a project
    # with neither leaves the column absent rather than inventing a URL.
    no_gallery, _ = _row(D_A5, {**P10, "gallery": []})
    assert no_gallery["photo_urls"] == [
        "https://static.wixstatic.com/media/496182_53472ff0499e4dffa9d48bf934c60810~mv2.jpg"]
    assert no_gallery["images_evidence"]["source_field"] == "image"
    bare, _ = _row(D_A5, {k: v for k, v in P10.items() if k not in ("gallery", "image", "image2")})
    assert bare["photo_urls"] is None and bare["images_evidence"]["count"] == 0


# ── removal oracle ───────────────────────────────────────────────────────────────────────────────
_PAGE = ('<html><head></head><body><script type="application/json" id="wix-warmup-data">'
         '{"appsWarmupData":{"dataBinding":{"dataStore":{"recordsByCollectionId":{"Depart":'
         '{"dcf0be5f-95cb-4dea-a15f-bede94815233":{"depno":"A5","status":"%s"}}}}}}}'
         '</script></body></html>')
_UID = D_A5["_id"]


def test_units_on_page_reads_the_pages_own_data_and_tolerates_a_page_without_it():
    assert set(R.units_on_page(_PAGE % "متاح")) == {_UID}
    assert R.units_on_page("<html>no warmup here</html>") == {}
    assert R.units_on_page("") == {}


@pytest.mark.parametrize("status,verdict", [("متاح", "live"), ("مباع", "gone"), ("محجوز", "gone")])
def test_the_pages_own_unit_status_decides(status, verdict):
    assert R._signal(_UID, True)(200, _PAGE % status, False) == verdict


def test_absence_is_death_on_the_family_whose_pages_list_every_unit_and_unknown_on_the_other():
    """MEASURED: all 29 /onepro-1/ pages carried exactly the collection's unit count, and every
    /com/ page capped at 20 of 68–98 behind a «تحميل المزيد» control. So absence is absence on one
    family and paging on the other, and only the first may kill."""
    other = _PAGE.replace(_UID, "11111111-1111-1111-1111-111111111111") % "متاح"
    assert R._signal(_UID, True)(200, other, False) == "gone"
    assert R._signal(_UID, False)(200, other, False) is None, (
        "a com page shows only 20 of up to 98 units — absence there is paging, not removal")
    assert R._lists_every_unit("https://www.razre.sa/onepro-1/55") is True
    assert R._lists_every_unit("https://www.razre.sa/com/1") is False
    assert R._lists_every_unit(None) is False


def test_the_shared_law_still_refuses_a_death_the_read_cannot_bear():
    """404 is the measured hard delete (4/4 fabricated ids). Everything that is about US, and a page
    we could not read, stays UNKNOWN — the law in http_liveness, not this platform's opinion."""
    sig = R._signal(_UID, True)
    assert sig(404, "", False) == "gone"
    assert sig(410, "", False) == "gone"
    for status in (403, 429, 500, 503):
        probe = R.LivenessProbe(platform="razre", signal=sig, session=lambda: None,
                                url_for=lambda _ad: "https://www.razre.sa/onepro-1/10",
                                attempts=1, backoff=0)
        probe.fetch = lambda _url, s=status: (s, "<html>blocked</html>", False)
        verdict, _why = probe.verify_gone("RAZ" + _UID)
        assert verdict == "unknown", f"HTTP {status} must never read as a removal"
    # A project page that is served but carries no unit data at all is no opinion either.
    assert sig(200, "<html>shell</html>", False) is None


def test_an_unprobeable_row_is_unknown_never_a_kill():
    probe = R.LivenessProbe(platform="razre", signal=R._signal(_UID, True), session=lambda: None,
                            url_for=lambda _ad: None, attempts=1, backoff=0)
    assert probe.verify_gone("RAZ" + _UID)[0] == "unknown"


# ── shape ────────────────────────────────────────────────────────────────────────────────────────
def test_the_row_carries_the_fields_a_card_needs():
    row, _ = _row(D_A5, P10)
    assert row["source"] == "راز العقارية"
    assert row["ad_number"] == "RAZ" + D_A5["_id"]
    assert row["active"] is True
    assert row["project_name"] == "RAZ 10"
    assert row["title"] == "ملحق A5 - الدور الخامس - RAZ 10"
    assert row["area_m2"] == 144            # from 144.0; the exact float is kept in additional_info
    assert row["additional_info"]["source_area_raw"] == 144.0
    assert row["additional_info"]["family"] == "onepro"
    assert len(row) >= 20, f"only {len(row)} keys — the mapper stopped producing a real row"
