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

MAPPING STANDARDIZATION 2026-07-16 (owner-approved): the unification's conflict table was
presented to the owner the same day and the FILTER-BLOCKING rows were approved for
standardization (owner directive: "fix any location, property-type, category, or deal mapping
conflict that prevents listings from matching the filters"). For exactly those keys the golden
byte-identity pins below were re-pinned from the OLD (pre-unification) value to the NEW approved
value via the *_APPROVED_CHANGES dicts — every other key stays byte-identical to the frozen
snapshots. The approved set: eastabha أرض family → Residential Land, أرض زراعية/ارض زراعية → Farm
fleet-wide, أرض تجارية → Commercial Land shared, دوبلكس → Duplex + استوديو → Studio fleet-wide
(wasalt/aldarim/mustqr folds removed), eastabha's 10 city labels → canonical fleet labels, and
wasalt's Sarat Ubaida/Baljurashi/Al-Aqiq city folds → the precise towns. Mustqr's صالة/محطة
overrides stay unchanged (item 8 of the table).

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


def old_eastabha_derive_type(cat_names: list[str], type_map=None):
    """Verbatim port of the pre-unification eastabha _derive_type (private dict + deal-word strip).
    `type_map` lets the golden test replay the SAME old algorithm over the snapshot map with the
    2026-07-16 owner-approved value changes applied (see EASTABHA_TYPE_APPROVED_CHANGES) — the
    algorithm is frozen; only the approved key→value pins moved."""
    M, DW = (type_map or OLD_EASTABHA_TYPE_MAP_AR), OLD_EASTABHA_DEAL_WORDS
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


# ═══ Owner-approved re-pins (2026-07-16 mapping standardization) ═══════════════════════════════
# For THESE keys (and only these) the byte-identity contract is superseded by the owner-approved
# standardization value; every other snapshot key must still match byte-for-byte.

WASALT_TYPE_APPROVED_CHANGES = {           # owner approval 2026-07-16
    "Duplex": "Duplex",                    # was folded to Villa
    "Studio": "Studio",                    # was folded to Apartment
    "Small apartment (studio)": "Studio",  # was folded to Apartment
}
WASALT_CITY_APPROVED_CHANGES = {           # owner approval 2026-07-16: keep the precise town
    "Sarat Ubaida": "Sarat Abidah",        # was folded to Khamis Mushait
    "Baljurashi": "Baljurashi",            # was folded to Al Baha
    "Al-Aqiq": "Al Aqiq",                  # was folded to Al Baha
}
ALDARIM_TYPE_APPROVED_CHANGES = {"duplex": "Duplex"}   # owner approval 2026-07-16: was Villa fold
MUSTQR_TYPE_APPROVED_CHANGES = {"دوبلكس": "Duplex"}    # owner approval 2026-07-16: was Villa fold
EASTABHA_TYPE_APPROVED_CHANGES = {         # owner approval 2026-07-16
    "أرض": "Residential Land", "ارض": "Residential Land",          # was routing-legacy "Land"
    "أرض سكنية": "Residential Land", "ارض سكنية": "Residential Land",
    "أرض زراعية": "Farm", "ارض زراعية": "Farm",                     # was "Land"; mustqr's value won
}
EASTABHA_CITY_APPROVED_CHANGES = {         # owner approval 2026-07-16: canonical fleet labels
    "تثليث": "Tathlith", "محايل": "Mahayel", "المجمعة": "Al Majmaah", "الزلفي": "Al Zulfi",
    "القويعية": "Al Quwayiyah", "تربة": "Turabah", "بقيق": "Abqaiq", "البكيرية": "Al Bukayriyah",
    "المذنب": "Al Mithnab", "بيش": "Baysh",
}


# ═══ GOLDEN: wasalt ════════════════════════════════════════════════════════════════════════════

# NOTE: lowercase "apartment" is deliberately absent — it's an aldarim-origin key in the shared EN
# map, i.e. the documented EN-union delta (see test_delta_en_union_cross_coverage), not an unmapped probe.
WASALT_UNMAPPED_TYPE_PROBES = ["", "Mystery Hall", "Palace", "شقة", "  Villa  x"]
WASALT_UNMAPPED_CITY_PROBES = ["", "Atlantis", "riyadh", "الرياض"]


def test_golden_wasalt_type_every_key_and_unmapped():
    for sub, old_want in OLD_WASALT_TYPE_MAP.items():
        want = WASALT_TYPE_APPROVED_CHANGES.get(sub, old_want)
        assert (N.map_type_en(sub) or (sub or None)) == want, sub
    for sub in WASALT_UNMAPPED_TYPE_PROBES:
        assert (N.map_type_en(sub) or (sub or None)) == old_wasalt_type(sub), sub


def test_golden_wasalt_city_every_key_and_unmapped():
    for raw, old_want in OLD_WASALT_CITY_MAP.items():
        want = WASALT_CITY_APPROVED_CHANGES.get(raw, old_want)
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
    for t, old_want in OLD_ALDARIM_TYPE_MAP.items():
        want = ALDARIM_TYPE_APPROVED_CHANGES.get(t, old_want)
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


def test_contract_aldarim_rent_annualization_both_shapes(monkeypatch):
    """Monthly-rent contract (fleet-wide 2026-07-13 BUG-2 fix, propagated to Aldarim 2026-07-16):
    price_annual is truly ANNUAL. The annual figure wins when present; a monthly-only listing
    stores ×12 via the shared annualize_rent with rent_period='monthly' (the old code stored the
    raw monthly figure as annual). PROSPECTIVE fix — live-checked before shipping: both active
    Aldarim Rent rows priced via the annual path, so no stored value changed."""
    import scrapers.aldarim.run as A

    monkeypatch.setattr(A, "to_catalog", lambda *a, **k: (None, None))  # DB-free
    base = {"id": 88, "category": "residential", "purpose": "rent", "type": "apartment",
            "availability_status": "available", "city": {"name_en": "Riyadh"}, "district": None}

    # annual-only shape → stored as-is, rent_period 'annual' (byte-identical to old behaviour).
    row, _ = A.map_listing({**base, "rent_price_annually": 50000})
    assert row["price_annual"] == 50000 and row["rent_period"] == "annual"
    assert row["price_total"] is None

    # monthly-only shape → annualized ×12, rent_period 'monthly'; the app's round(/12) card
    # round-trips to the real monthly rent. (Old behaviour — the discovered bug — was 3000/'annual'.)
    row, _ = A.map_listing({**base, "rent_price_monthly": 3000})
    assert row["price_annual"] == 36000 and row["rent_period"] == "monthly"
    assert round(row["price_annual"] / 12) == 3000

    # both present → annual wins (source-of-truth precedence unchanged).
    row, _ = A.map_listing({**base, "rent_price_annually": 45000, "rent_price_monthly": 3000})
    assert row["price_annual"] == 45000 and row["rent_period"] == "annual"

    # neither → honest None, historical 'annual' tag for rent rows preserved.
    row, _ = A.map_listing(dict(base))
    assert row["price_annual"] is None and row["rent_period"] == "annual"

    # Buy listing: rent fields stay None exactly as before.
    row, _ = A.map_listing({**base, "purpose": "sell", "selling_price": 900000,
                            "rent_price_monthly": 3000})
    assert row["price_total"] == 900000
    assert row["price_annual"] is None and row["rent_period"] is None


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
    """Replays the frozen OLD algorithm over the snapshot map WITH the 2026-07-16 owner-approved
    value changes applied — so the أرض family keys assert the NEW approved values (Residential
    Land / Farm / Commercial Land) and every other key/phrase stays byte-identical to before."""
    from scrapers.eastabha.run import _derive_type

    standardized = {**OLD_EASTABHA_TYPE_MAP_AR, **EASTABHA_TYPE_APPROVED_CHANGES}
    for names in EASTABHA_DERIVE_CASES:
        assert _derive_type(names) == old_eastabha_derive_type(names, type_map=standardized), names


def test_golden_eastabha_city_every_key():
    from scrapers.eastabha.run import CITY_OVERRIDES_AR

    for city_ar, old_want in OLD_EASTABHA_CITY_MAP_AR.items():
        # 2026-07-16 owner approval: 10 historical labels re-pinned to the canonical fleet labels
        # (all 10 verified present in production loc_city_map before adoption).
        want = EASTABHA_CITY_APPROVED_CHANGES.get(city_ar, old_want)
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
    # 2026-07-16 owner approval (mapping standardization): the أرض family now stores the shared
    # "Residential Land" — the filterable clean type — instead of the historical "Land" override
    # (which was dropped). Routing stays residential.
    p, taxd = _eastabha_fixture("أرض سكنية")
    row, cat, _ = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "Residential Land" and cat == "residential"
    # …and أرض زراعية is Farm fleet-wide (mustqr's value; the owner's مزرعة precedent).
    p, taxd = _eastabha_fixture("أرض زراعية")
    row, cat, _ = map_listing(p, taxd, {}, None)
    assert row["property_type"] == "Farm" and cat == "residential"


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

    for ar, old_want in OLD_MUSTQR_TYPE_MAP.items():
        # 2026-07-16 owner approval: دوبلكس re-pinned Villa → Duplex (fold retired fleet-wide).
        want = MUSTQR_TYPE_APPROVED_CHANGES.get(ar, old_want)
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

    # ارض زراعية stays Farm — the value was promoted VERBATIM from mustqr's override into the
    # shared TYPE_MAP_AR in the 2026-07-16 mapping standardization (owner-approved), so the stored
    # value is unchanged even though the override key is gone.
    p["type"] = "ارض زراعية"
    p["category"] = "بيع"
    row, bucket = map_listing(p, {})
    assert row["property_type"] == "Farm" and bucket == "residential"
    assert row["bedrooms"] is None  # Farm keeps the bedrooms-nulling rule

    # 2026-07-16 owner approval: دوبلكس now stores Duplex (residential routing, bedrooms kept).
    p["type"] = "دوبلكس"
    row, bucket = map_listing(p, {})
    assert row["property_type"] == "Duplex" and bucket == "residential"
    assert row["bedrooms"] == 4


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
    # Verbatim for every key EXCEPT the 2026-07-16 owner-approved standardization re-pins,
    # which are asserted at their approved values instead.
    en_type_approved = {**WASALT_TYPE_APPROVED_CHANGES, **ALDARIM_TYPE_APPROVED_CHANGES}
    for k, v in {**OLD_WASALT_TYPE_MAP, **OLD_ALDARIM_TYPE_MAP}.items():
        assert N.TYPE_MAP_EN[k] == en_type_approved.get(k, v), k
    for k, v in {**OLD_WASALT_CITY_MAP, **OLD_ALDARIM_CITY_MAP}.items():
        assert N.CITY_MAP_EN[k] == WASALT_CITY_APPROVED_CHANGES.get(k, v), k
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
    every pre-existing key, and each was verified unreachable before promotion) — EXCEPT the
    2026-07-16 owner-approved أرض specializations, which deliberately sit BEFORE the bare أرض so
    the specific term wins in phrases too."""
    assert N.map_type("أرض") == "Residential Land"
    # 2026-07-16 owner approval: أرض تجارية is now an exact shared key (eastabha's value became
    # the shared truth) — it no longer falls through to the bare-أرض substring match.
    assert N.map_type("أرض تجارية") == "Commercial Land"
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


# ═══ CONTRACT: 2026-07-16 mapping standardization (owner-approved) ═════════════════════════════

def test_contract_mapping_standardization_2026_07_16():
    """One authoritative pin for the owner-approved filter-blocking conflict fixes. If any of
    these regress, a listing class silently stops matching its filter again — treat a failure
    here exactly like a golden failure."""
    # Shared Arabic truths (exact keys; verified searchable via type_label_ar/known_type_ar live).
    for ar, want in {"أرض تجارية": "Commercial Land",
                     "أرض زراعية": "Farm", "ارض زراعية": "Farm",
                     "دوبلكس": "Duplex", "دوبليكس": "Duplex",
                     "استوديو": "Studio", "ستوديو": "Studio"}.items():
        assert N.TYPE_MAP_AR[ar] == want, ar
        assert N.map_type_exact(ar) == want, ar
    # The أرض specializations sit BEFORE the bare أرض key, so the substring (phrase) path agrees:
    assert N.map_type("أرض زراعية للبيع") == "Farm"
    assert N.map_type("ارض زراعية للايجار") == "Farm"
    assert N.map_type("أرض للبيع") == "Residential Land"     # generic أرض phrases unchanged
    # EN vocabularies (wasalt/aldarim folds removed):
    assert N.map_type_en("Duplex") == "Duplex" and N.map_type_en("duplex") == "Duplex"
    assert N.map_type_en("Studio") == "Studio"
    assert N.map_type_en("Small apartment (studio)") == "Studio"
    # Precise towns (wasalt city folds removed; all three verified in loc_catalog_city and
    # live-resolving via the native city_ar path before adoption):
    assert N.map_city_en("Sarat Ubaida") == "Sarat Abidah"
    assert N.map_city_en("Baljurashi") == "Baljurashi"
    assert N.map_city_en("Al-Aqiq") == "Al Aqiq"
    assert N.region_for_city("Sarat Abidah") == "Asir"
    assert N.region_for_city("Baljurashi") == "Al Bahah"
    assert N.region_for_city("Al Aqiq") == "Al Bahah"
    # The standardized keys no longer hide behind per-platform overrides…
    from scrapers.eastabha.run import CITY_OVERRIDES_AR, TYPE_OVERRIDES_AR
    from scrapers.mustqr.run import MUSTQR_TYPE_OVERRIDES

    for k in ("أرض", "ارض", "أرض سكنية", "ارض سكنية", "أرض زراعية", "ارض زراعية",
              "أرض تجارية", "دوبلكس", "دوبليكس", "استوديو", "ستوديو"):
        assert k not in TYPE_OVERRIDES_AR, k
    assert set(MUSTQR_TYPE_OVERRIDES) == {"صالة", "محطة"}  # item 8: kept unchanged, nothing else
    # …while eastabha's 3 precise-town overrides remain (deliberately NOT promoted to shared
    # CITY_MAP_AR: العقيق is also a common district name and would substring-match fleet-wide).
    assert CITY_OVERRIDES_AR == {"سراة عبيدة": "Sarat Abidah", "بلجرشي": "Baljurashi",
                                 "العقيق": "Al Aqiq"}
    # Eastabha city labels now canonical via the shared map (overrides dropped):
    for ar, want in EASTABHA_CITY_APPROVED_CHANGES.items():
        assert N.map_city(ar, overrides=CITY_OVERRIDES_AR) == want, ar


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
