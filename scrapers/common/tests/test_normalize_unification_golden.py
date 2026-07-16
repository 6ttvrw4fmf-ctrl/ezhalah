"""Normalize-unification GOLDEN no-regression proof (2026-07-16, fix/normalize-unification).

Four LIVE scrapers (wasalt — #2 platform by volume — aldarim, eastabha, mustqr) maintained private
TYPE_MAP/CITY_MAP dicts and private numeric parsing instead of routing through
scrapers/common/normalize.py, so shared fixes (e.g. the 2026-07-13 to_int() price-fidelity fix)
never propagated to them. The unification routes them through the shared helpers WITHOUT changing
any stored value for a currently-mapped input.

This file is the no-regression proof, in three tiers:

  GOLDEN  — replays each scraper's OLD lookup logic over the frozen pre-unification snapshots
            (_normalize_unification_snapshots.py, AST-extracted verbatim at origin/main 1c977a3)
            for EVERY private-map key + representative unmapped/edge inputs, and asserts the NEW
            unified path is byte-identical.
  DELTA   — pins the DOCUMENTED, intentional coverage GAINS (inputs that previously returned
            None/were skipped and now resolve via the shared layer). These are listed in the
            unification report; a delta test failing means the gain silently regressed OR grew —
            both need review.
  CONTRACT— pins the shared-map additions (values promoted verbatim), the overrides mechanism
            (exact-only, wins over shared), the Batch 2 type-truth behaviour for unmapped types
            (raw preserved, never a guessed default), and that pre-existing shared-map behaviour
            is UNCHANGED by the appended keys.

Hermetic: no network, no DB (the one DB-touching helper an end-to-end path calls,
aldarim's to_catalog, is monkeypatched).

Run: python3 -m pytest scrapers/common/tests/test_normalize_unification_golden.py -q
"""
from __future__ import annotations

import re

import pytest

from scrapers.common import normalize as N
from scrapers.common.tests._normalize_unification_snapshots import (
    OLD_ALDARIM_CITY_MAP,
    OLD_ALDARIM_TYPE_MAP,
    OLD_EASTABHA_CITY_MAP_AR,
    OLD_EASTABHA_DEAL_WORDS,
    OLD_EASTABHA_TYPE_MAP_AR,
    OLD_MUSTQR_TYPE_MAP,
    OLD_WASALT_CITY_MAP,
    OLD_WASALT_TYPE_MAP,
)


# ═══ OLD logic replicas (byte-for-byte ports of the pre-unification lookups) ═══════════════════

def old_wasalt_type(sub: str):
    return OLD_WASALT_TYPE_MAP.get(sub, sub or None)


def old_wasalt_city(raw_city: str):
    return OLD_WASALT_CITY_MAP.get(raw_city)


def old_aldarim_type(t: str):
    return OLD_ALDARIM_TYPE_MAP.get(t, t.title() if t else None)


def old_aldarim_city(raw):
    if not raw:
        return None
    return OLD_ALDARIM_CITY_MAP.get(raw, raw)


def old_mustqr_type(ar_type: str):
    return OLD_MUSTQR_TYPE_MAP.get(ar_type)


def old_eastabha_city(city_ar: str):
    return OLD_EASTABHA_CITY_MAP_AR.get(city_ar)


def old_eastabha_derive_type(cat_names: list[str]):
    """Verbatim port of the pre-unification eastabha _derive_type (private dict + deal-word strip)."""
    M, DW = OLD_EASTABHA_TYPE_MAP_AR, OLD_EASTABHA_DEAL_WORDS
    for raw in cat_names:
        if M.get(raw):
            return M[raw]
    for raw in cat_names:
        residual = raw
        for w in DW:
            residual = residual.replace(w, " ")
        residual = re.sub(r"\s+", " ", residual).strip()
        for tok in (residual, residual.replace("ة", "ه"), residual.replace("ه", "ة")):
            if M.get(tok):
                return M[tok]
        if "تجار" in raw or "محل" in raw or "مكتب" in raw or "مستودع" in raw:
            return "Commercial Land" if "ارض" in raw or "أرض" in raw else "Shop"
    return None


def old_int(v):
    """Verbatim port of the identical private _int() aldarim and mustqr both carried."""
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def old_mustqr_price_fields(n, is_rent: bool, is_monthly: bool):
    """Verbatim port of the pre-unification mustqr _price_fields tail (after _int + <1000 gate)."""
    if not n or n < 1000:
        return {}
    if is_rent:
        return {"price_annual": n * 12 if is_monthly else n,
                "rent_period": "monthly" if is_monthly else "annual"}
    return {"price_total": n}


# ═══ GOLDEN: wasalt ════════════════════════════════════════════════════════════════════════════

# NOTE: lowercase "apartment" is deliberately absent — it's an aldarim-origin key in the shared EN
# map, i.e. the documented EN-union delta (see test_delta_en_union_cross_coverage), not an unmapped probe.
WASALT_UNMAPPED_TYPE_PROBES = ["", "Mystery Hall", "Palace", "شقة", "  Villa  x"]
WASALT_UNMAPPED_CITY_PROBES = ["", "Atlantis", "riyadh", "الرياض"]


def test_golden_wasalt_type_every_key_and_unmapped():
    for sub, want in OLD_WASALT_TYPE_MAP.items():
        assert (N.map_type_en(sub) or (sub or None)) == want, sub
    for sub in WASALT_UNMAPPED_TYPE_PROBES:
        assert (N.map_type_en(sub) or (sub or None)) == old_wasalt_type(sub), sub


def test_golden_wasalt_city_every_key_and_unmapped():
    for raw, want in OLD_WASALT_CITY_MAP.items():
        assert N.map_city_en(raw) == want, raw
    for raw in WASALT_UNMAPPED_CITY_PROBES:
        # Old behaviour: unmapped → None (honest). Aldarim-origin EN keys are a documented delta,
        # tested separately — these probes are all outside both vocabularies.
        assert N.map_city_en(raw) == old_wasalt_city(raw), raw


def test_golden_wasalt_map_property_end_to_end():
    from scrapers.wasalt.run import map_property

    prop = {
        "id": 424242,
        "propertyInfo": {
            "slug": "office-space-424242", "propertySubType": "Office Space",
            "city": "Aldammam", "salePrice": 550000, "title": "مكتب", "zone": "الشاطئ",
        },
        "attributes": [{"key": "noOfBedrooms", "value": "3"},
                       {"key": "noOfBathrooms", "value": "2"},
                       {"key": "builtUpArea", "value": "180"}],
        "propertyFiles": {"images": []},
    }
    row = map_property(prop, "sale")
    assert row["ad_number"] == "WST424242"
    assert row["property_type"] == "Office"          # Wasalt "Office Space" → canonical Office
    assert row["city"] == "Dammam"                   # Wasalt "Aldammam" → canonical Dammam
    assert row["price_total"] == 550000 and row["price_annual"] is None
    assert row["area_m2"] == 180 and row["bedrooms"] == 3 and row["bathrooms"] == 2

    # Unmapped subtype → RAW preserved (Batch 2 type-truth contract), unmapped city → honest None.
    prop["propertyInfo"]["propertySubType"] = "Mystery Hall"
    prop["propertyInfo"]["city"] = "Atlantis"
    row = map_property(prop, "sale")
    assert row["property_type"] == "Mystery Hall"
    assert row["city"] is None


# ═══ GOLDEN: aldarim ═══════════════════════════════════════════════════════════════════════════

ALDARIM_UNMAPPED_TYPE_PROBES = ["", "weird_type", "chalet"]
# Old behaviour kept an unmapped raw name verbatim (incl. an Arabic name_ar fallback when the API
# row has no name_en) — the shared EN map is exact/case-sensitive so these all still pass through.
ALDARIM_UNMAPPED_CITY_PROBES = ["Atlantis", "الرياض", ""]


def test_golden_aldarim_type_every_key_and_unmapped():
    for t, want in OLD_ALDARIM_TYPE_MAP.items():
        assert (N.map_type_en(t) or (t.title() if t else None)) == want, t
    for t in ALDARIM_UNMAPPED_TYPE_PROBES:
        assert (N.map_type_en(t) or (t.title() if t else None)) == old_aldarim_type(t), t


def test_golden_aldarim_city_every_key_and_unmapped():
    for raw, want in OLD_ALDARIM_CITY_MAP.items():
        assert (N.map_city_en(raw) or raw) == want, raw
    for raw in ALDARIM_UNMAPPED_CITY_PROBES:
        got = (N.map_city_en(raw) or raw) if raw else None
        assert got == old_aldarim_city(raw), raw


def test_golden_aldarim_map_listing_end_to_end(monkeypatch):
    import scrapers.aldarim.run as A

    monkeypatch.setattr(A, "to_catalog", lambda *a, **k: (None, None))  # DB-free
    L = {
        "id": 77, "category": "residential", "purpose": "sell", "type": "tower_apartment",
        "availability_status": "available",
        "city": {"name_en": "Aldammam", "name_ar": "الدمام"},
        "district": {"name_en": "Corniche Dist.", "name_ar": "الكورنيش"},
        "selling_price": "750000", "area": 120, "bedrooms": 3, "bathrooms": 2,
    }
    row, cat = A.map_listing(L)
    assert cat == "residential"
    assert row["property_type"] == "Apartment"       # aldarim "tower_apartment" → Apartment
    assert row["city"] == "Dammam"                   # aldarim "Aldammam" → Dammam
    assert row["price_total"] == 750000 and row["area_m2"] == 120

    # Unmapped type → RAW preserved title-cased (old TYPE_MAP.get(t, t.title()) behaviour).
    L["type"] = "weird_type"
    row, _ = A.map_listing(L)
    assert row["property_type"] == "Weird_Type"

    # land + commercial category → Commercial Land (call-site rule untouched).
    L["type"] = "land"
    L["category"] = "commercial"
    row, cat = A.map_listing(L)
    assert cat == "commercial" and row["property_type"] == "Commercial Land"


# ═══ GOLDEN: eastabha ══════════════════════════════════════════════════════════════════════════

# Every old private key as a single-name category list, plus phrase/multi-name/ordering cases that
# exercise both scan phases (deal-word stripping, ة/ه swaps, commercial hints, name precedence).
EASTABHA_DERIVE_CASES = (
    [[k] for k in OLD_EASTABHA_TYPE_MAP_AR]
    + [
        ["شقه للبيع"], ["فيلا للايجار"], ["روف للبيع"], ["أرض سكنية للبيع"], ["ارض للبيع"],
        ["عمارة للبيع"], ["استراحة للبيع", "استراحة"], ["دور أرضي", "شقة"], ["إيجار", "محل"],
        ["مستودع تجاري"], ["ارض تجارية"], ["كافيه - لاونج"], ["عرض جديد"], ["مزاد"],
        [], [""],
    ]
)


def test_golden_eastabha_derive_type_all_keys_and_phrases():
    from scrapers.eastabha.run import _derive_type

    for names in EASTABHA_DERIVE_CASES:
        assert _derive_type(names) == old_eastabha_derive_type(names), names


def test_golden_eastabha_city_every_key():
    from scrapers.eastabha.run import CITY_OVERRIDES_AR

    for city_ar, want in OLD_EASTABHA_CITY_MAP_AR.items():
        assert N.map_city(city_ar, overrides=CITY_OVERRIDES_AR) == want, city_ar


def _eastabha_fixture(cat_term: str):
    """Minimal REST post + taxonomy dicts for an end-to-end eastabha map_listing() call."""
    taxd = {
        "property_category": {1: cat_term},
        "property_action_category": {2: "بيع"},
        "property_city": {3: "أبها"},
        "property_area": {},
        "property_county_state": {4: "عسير"},
        "property_features": {},
        "property_status": {},
    }
    p = {
        "id": 555, "link": "https://eastabha.sa/properties/x/",
        "property_category": [1], "property_action_category": [2], "property_city": [3],
        "property_area": [], "property_county_state": [4], "property_features": [],
        "property_status": [],
        "title": {"rendered": "عنوان"}, "content": {"rendered": ""},
        "date": "2026-01-01", "modified": "2026-01-02",
    }
    return p, taxd


def test_golden_eastabha_map_listing_mapped_type_unchanged():
    from scrapers.eastabha.run import map_listing

    p, taxd = _eastabha_fixture("شقه للبيع")
    row, cat, gone = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "Apartment" and cat == "residential" and gone is False
    assert row["city"] == "Abha" and row["region"] == "Asir"
    # Eastabha's أرض family keeps ITS historical stored value via the override (shared map says
    # "Residential Land" — conflict case (c), owner-review list).
    p, taxd = _eastabha_fixture("أرض سكنية")
    row, cat, _ = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "Land" and cat == "residential"


def test_eastabha_unmapped_type_raw_preserved_never_land_default():
    """Batch 2 type-truth contract (owner directive 2026-07-16): an unmapped category must be stored
    RAW — the old `or "Land"` guessed default must never be stored again — while the
    residential/commercial routing stays byte-identical via the never-stored routing-legacy value."""
    from scrapers.eastabha.run import map_listing

    p, taxd = _eastabha_fixture("نوع غامض تماما")
    row, cat, _ = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "نوع غامض تماما"   # raw preserved…
    assert cat == "residential"                        # …routing unchanged (legacy "Land" routing)

    # No category term at all → "unknown" sentinel (sanadak Batch-2 pattern), still residential.
    p, taxd = _eastabha_fixture("x")
    p["property_category"] = []
    row, cat, _ = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "unknown" and cat == "residential"


# ═══ GOLDEN: mustqr ════════════════════════════════════════════════════════════════════════════

def test_golden_mustqr_type_every_key():
    from scrapers.mustqr.run import MUSTQR_TYPE_OVERRIDES

    for ar, want in OLD_MUSTQR_TYPE_MAP.items():
        assert N.map_type_exact(ar, overrides=MUSTQR_TYPE_OVERRIDES) == want, ar


def test_golden_mustqr_map_listing_end_to_end():
    from scrapers.mustqr.run import map_listing

    p = {"id": 9, "type": "فيلا", "category": "إيجار", "price_type": "شهري", "price": 2500,
         "rooms": 4, "bathrooms": 3, "area_sqm": 300, "neighborhood": "النقرة"}
    row, bucket = map_listing(p, {"النقرة": "north"})
    assert bucket == "residential"
    assert row["property_type"] == "Villa"
    assert row["price_annual"] == 30000 and row["rent_period"] == "monthly"  # 2500×12 (2026-07-13 fix)
    assert row["city"] == "Hail" and row["bedrooms"] == 4

    # Unmapped type (neither overrides nor shared): row still SKIPPED — nothing stored, nothing
    # guessed (historical behaviour, stricter than raw-preservation; documented in the report).
    p["type"] = "نوع غامض تماما"
    row, _ = map_listing(p, {})
    assert row is None

    # Conflict override preserved: ارض زراعية stays Farm (shared substring would say Residential Land).
    p["type"] = "ارض زراعية"
    p["category"] = "بيع"
    row, bucket = map_listing(p, {})
    assert row["property_type"] == "Farm" and bucket == "residential"
    assert row["bedrooms"] is None  # Farm keeps the bedrooms-nulling rule


# ═══ GOLDEN: numeric parsing ═══════════════════════════════════════════════════════════════════

NUMERIC_SHAPES = [None, "", 0, "0", 1, -3, 3.9, -3.9, "3", "3.5", "123.456", 123.456, 150588.72,
                  "1,200", "abc", True, False, "0.0", 0.0, "1e3", 10**15, "  7 ", "٥", [1]]


def test_golden_to_int_numeric_identical_to_old_private_int():
    from scrapers.aldarim.run import _int as aldarim_int
    from scrapers.mustqr.run import _int as mustqr_int

    assert aldarim_int is N.to_int_numeric and mustqr_int is N.to_int_numeric
    for v in NUMERIC_SHAPES:
        assert N.to_int_numeric(v) == old_int(v), repr(v)


def test_to_int_and_to_int_numeric_must_not_be_swapped():
    """Why wasalt keeps bare int()/int(float()) and why aldarim/mustqr use to_int_numeric, NOT
    to_int: on JSON-native floats with 3+ decimals to_int() reads the dots as European digit
    grouping and INFLATES — the mirror image of the 2026-07-13 price-fidelity bug."""
    assert N.to_int("123.456") == 123456        # display-text semantics (grouping)
    assert N.to_int_numeric("123.456") == 123   # JSON-numeric semantics (truncation)
    assert N.to_int_numeric(150588.725) == 150588
    assert N.to_int("69,000") == 69000          # display text with separators…
    assert N.to_int_numeric("69,000") is None   # …is NOT a JSON-numeric shape


def test_golden_mustqr_price_fields_identical():
    from scrapers.mustqr.run import _price_fields

    for raw in [None, 0, "0", 500, 999, 1000, 1700, 2700, "2700", 150588, 10**7]:
        for is_rent in (False, True):
            for is_monthly in (False, True):
                assert _price_fields({"price": raw}, is_rent, is_monthly) == \
                    old_mustqr_price_fields(old_int(raw), is_rent, is_monthly), (raw, is_rent, is_monthly)


# ═══ DELTA: documented, intentional coverage GAINS (previously None/skipped) ═══════════════════

def test_delta_mustqr_gains_shared_exact_types():
    """Rows whose Arabic type only the SHARED map knows were silently skipped before; they now map.
    Old behaviour proven None so this is expansion, not alteration."""
    from scrapers.mustqr.run import MUSTQR_TYPE_OVERRIDES

    gains = {"غرفة": "Room", "محل": "Shop", "معرض": "Showroom", "مستودع": "Warehouse",
             "مزرعة": "Farm", "منزل": "House", "قصر": "Villa"}
    for ar, want in gains.items():
        assert old_mustqr_type(ar) is None, ar
        assert N.map_type_exact(ar, overrides=MUSTQR_TYPE_OVERRIDES) == want, ar


def test_delta_eastabha_gains_shared_exact_types_and_city_normalization():
    from scrapers.eastabha.run import CITY_OVERRIDES_AR, _derive_type

    for ar, want in {"فندق": "Hotel", "غرفة": "Room", "مخيم": "Camp", "ورشة": "Workshop"}.items():
        assert old_eastabha_derive_type([ar]) is None, ar
        assert _derive_type([ar]) == want, ar
    # City: shared normalization (ة/ه, hamza) now tolerates spellings the strict .get() missed.
    assert old_eastabha_city("مكه") is None
    assert N.map_city("مكه", overrides=CITY_OVERRIDES_AR) == "Mecca"


def test_delta_en_union_cross_coverage():
    """Wasalt and Aldarim now read ONE shared EN map, so each gains the other's spellings for
    inputs that previously fell through (wasalt → None, aldarim → raw passthrough)."""
    assert old_wasalt_city("Al Madinah") is None          # aldarim-origin key
    assert N.map_city_en("Al Madinah") == "Medina"
    assert old_aldarim_city("Hayil") == "Hayil"           # wasalt-origin key: was raw passthrough
    assert N.map_city_en("Hayil") == "Hail"
    assert old_wasalt_type("apartment") == "apartment"    # aldarim-origin lowercase type key:
    assert N.map_type_en("apartment") == "Apartment"      # wasalt used to pass the raw through


# ═══ CONTRACT: shared-map additions, overrides mechanism, no-shared-regression ═════════════════

def test_contract_en_maps_are_verbatim_supersets_of_the_old_private_maps():
    for k, v in {**OLD_WASALT_TYPE_MAP, **OLD_ALDARIM_TYPE_MAP}.items():
        assert N.TYPE_MAP_EN[k] == v, k
    for k, v in {**OLD_WASALT_CITY_MAP, **OLD_ALDARIM_CITY_MAP}.items():
        assert N.CITY_MAP_EN[k] == v, k
    # …and nothing beyond the two source vocabularies was invented.
    assert set(N.TYPE_MAP_EN) == set(OLD_WASALT_TYPE_MAP) | set(OLD_ALDARIM_TYPE_MAP)
    assert set(N.CITY_MAP_EN) == set(OLD_WASALT_CITY_MAP) | set(OLD_ALDARIM_CITY_MAP)


def test_contract_shared_ar_additions_promoted_verbatim():
    # 8 type aliases (7 eastabha + 1 mustqr) + 4 eastabha cities, values preserved verbatim.
    for ar, want in {"شقق سكنية": "Apartment", "شقق": "Apartment", "قصر": "Villa",
                     "إستراحة": "Rest House", "محطة بنزين": "Gas Station", "كافيه": "Shop",
                     "كافيه - لاونج": "Shop", "حوش": "House"}.items():
        assert N.TYPE_MAP_AR[ar] == want, ar
    for ar, want in {"النماص": "Al Namas", "تنومة": "Tanomah",
                     "ظهران الجنوب": "Dhahran Al Janub", "البرك": "Al Birk"}.items():
        assert N.CITY_MAP_AR[ar] == want, ar
    # REGION_CITIES lockstep (values verbatim from eastabha's private CITY_TO_REGION).
    for city in ("Al Namas", "Tanomah", "Dhahran Al Janub", "Al Birk"):
        assert N.region_for_city(city) == "Asir", city


def test_contract_preexisting_shared_behaviour_unchanged_by_additions():
    """Appended keys must never change an input the shared map already resolved (they sit AFTER
    every pre-existing key, and each was verified unreachable before promotion)."""
    assert N.map_type("أرض") == "Residential Land"
    assert N.map_type("أرض تجارية") == "Residential Land"   # substring 'أرض' still wins (pre-fix parity)
    assert N.map_type("شقة للإيجار") == "Apartment"
    assert N.map_city("أحد رفيده") == "Ahad Rafidah"
    assert N.map_city("الظهران") == "Dhahran"                # not shadowed by ظهران الجنوب
    assert N.to_int("150588.72") == 150588                   # 2026-07-13 price-fidelity fix intact


def test_contract_overrides_are_exact_only_and_win_over_shared():
    ov = {"أرض": "Land"}
    assert N.map_type_exact("أرض", overrides=ov) == "Land"          # override wins
    assert N.map_type_exact("أرض", overrides=None) == "Residential Land"
    assert N.map_type("أرض سكنية", overrides=ov) == "Residential Land"  # NO substring on overrides
    assert N.map_type_exact("أرض سكنية", overrides=ov) is None          # exact helper: no fuzz at all
    cov = {"بيش": "Bish"}
    assert N.map_city("بيش", overrides=cov) == "Bish"
    assert N.map_city("بيش") == "Baysh"
    assert N.map_city("مدينة بيش قرب الساحل", overrides=cov) == "Baysh"  # substring uses SHARED only
    for f in (N.map_type, N.map_type_exact, N.map_city, N.map_type_en, N.map_city_en):
        assert f("", overrides={"x": "Y"}) is None
        assert f(None, overrides={"x": "Y"}) is None


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
