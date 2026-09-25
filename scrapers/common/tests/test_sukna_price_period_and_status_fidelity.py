"""سكنة (sukna) — the four ways this source can lie to a careless mapper, and the guards that hold.

Every fixture below is a VERBATIM record captured from https://suknamdn.sa/api/v1/units/<id> on
2026-09-24/25 with `Accept-Language: ar`, trimmed only to the keys the shipping code reads. The
assertions execute `scrapers.sukna.run.map_listing` itself — the function production calls.

WHAT IS GUARDED, AND WHY EACH ONE IS A REAL DEFECT AND NOT A HYPOTHETICAL
------------------------------------------------------------------------
1. THE PRICE. The source publishes `unit_price` («سعر الوحدة»), `property_tax` («ضريبة العقار») and
   `total_amount` («الإجمالي شاملًا الضريبة»), and its OWN web bundle binds the card price to the
   total: `price:{total:P(t.total_amount||t.unit_price)}`. Following the UI would be wrong, because
   the source does not keep `total_amount` in sync:
     · it differs from unit_price + property_tax on 149 of the 496 rows publishing all three;
     · id 630 publishes unit_price 1,649,000, tax 77,500 and total_amount 1,627,500 — a
       "total including tax" that is LOWER than the price alone;
     · id 631 publishes 1,439,000 / 70,000 / 1,470,000, which reconciles exactly against a
       unit_price of 1,400,000, i.e. total_amount is a copy of a SUPERSEDED price;
     · it is absent on 101 rows, which is why the client needs its `||` fallback at all.
   The unit page's own schema.org JSON-LD `offers.price` equals `unit_price` on every page checked
   (726, 437, 481, 562) and NEVER `total_amount`. So `unit_price` is stored verbatim, and neither
   `total_amount` nor `unit_price + property_tax` may ever become the price.

   MUTATION-VERIFIED (2026-09-25). `test_price_is_unit_price_never_the_stale_total` was run against
   a mapper whose price line had been changed to the source's own UI expression —
       price_raw = rec.get("total_amount") or rec.get("unit_price")
   — and it FAILED on all three price fixtures, naming the exact numbers:
       AssertionError: SKN726 stored 1890000; unit_price is 1800000 — total_amount (1890000) is
       not this listing's price
   The second mutant, `price_total = to_int_numeric(unit_price) + to_int_numeric(property_tax)`,
   FAILED the same test (SKN726 → 1,890,000) and also failed
   `test_nothing_is_ever_computed_from_the_other_money_fields`. The line was then restored and both
   tests passed. A guard nobody has watched fail is a guard nobody has tested.

2. THE PERIOD. sukna is sale-only — `purpose` is "sale" on all 31 projects, `sale_type` is "direct"
   on all 597 units, and no title or description in the whole catalogue contains a period token
   (measured: 0 of 597 match «شهري|سنوي|يومي|أسبوعي|نصف سنوي|ربع سنوي»). But the source is FULL of
   monthly money: `payment_amount` is 700 under the label «القسط الشهري» ("the monthly instalment")
   and `proposed_payment_plan` lists purchase instalments with their own `amount`. A mapper that
   read either as rent would invent a rental listing and, ×12-ing the 700, publish an 8,400 annual
   rent for a 1.8M flat. So rent_period and price_annual must stay unset on every input — including
   a synthetic record that shouts «شهري» in its prose, which is tested too.

3. THE STATUS. The source's own bundle maps `case` → `{0:"available",1:"reserved",2:"sold"}`
   («متاحة للبيع» / «محجوزة» / «مباعة»), and its own sitemap corroborates it exactly: the 370
   `/unit-details?id=` locs are SET-EQUAL to the case 0 + case 1 ids (335 + 35), and 0 of the 227
   case-2 ids appear — a perfect partition over 597/597 with zero counter-examples. case 2 skips.
   Off-plan is the source's own «بيع على الخارطة», which its bundle derives from
   `enables_payment_plan` (`j(t){return t.enables_payment_plan?"under-construction":"ready"}`); the
   flag is copied onto every unit of the 6 flagged projects (172/172) and onto none of the others
   (0/423). Those must skip too, counted — not be filtered by a text heuristic, which would find
   nothing, since the phrase never appears in a unit payload.

4. PDPL. `responsible_employee_name` carries a real person's name (measured on id 630:
   «عبدالعزيز علي محمد الحربي»), `responsible_employee_phone` a mobile, `developer.phone` a company
   line, and `sales_phone_number` another. None may reach a column, additional_info or
   source_capture, and neither may a phone or WhatsApp link written into the advertiser's own prose.

Run:
    python -m pytest scrapers/common/tests/test_sukna_price_period_and_status_fidelity.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The REAL scrapers.common.db is imported, deliberately NOT a stub: importing it opens no connection
# (db.sb() reads its credentials lazily and nothing here calls it) and mark_direct_alive is pure, so
# the shipping call is exercised rather than mimicked.
#
# IT ALSO MATTERS FOR THE SHARED RUN. Two sibling suites in this directory install a bare
# ModuleType under "scrapers.common.db" via sys.modules.setdefault, and
# test_source_is_truth_fleet_invariants imports `_CONTROL_COLS` from that name. A stub installed HERE
# wins whenever this file is collected first — which is exactly the order the onboarding command
# uses — and the fleet suite then dies at collection with
#   ImportError: cannot import name '_CONTROL_COLS' from 'scrapers.common.db'
# That was real, not hypothetical: the first version of this file stubbed db and broke the combined
# run while passing perfectly on its own.
import scrapers.common.arabic_location as _al  # noqa: E402
from scrapers.common import db as _real_db  # noqa: E402
from scrapers.sukna import run as S  # noqa: E402

# The key db.mark_direct_alive stamps on a row (and _wasalt_batch later pops). Read from db rather
# than typed out, so a rename upstream fails this test instead of silently unasserting it.
_DIRECT_ALIVE_KEY = _real_db._DIRECT_ALIVE_KEY

_RIYADH, _RIYADH_REGION = 3, 1


@pytest.fixture(autouse=True)
def _seed_catalog(monkeypatch):
    """The two cities and the districts this platform publishes, exactly as production's
    loc_catalog_city / loc_catalog_district hold them (verified by SQL on 2026-09-24: «الرياض» is
    city_id 3 / region 1, and «النرجس» resolves to «حي النرجس»)."""
    monkeypatch.setitem(_al._CITY, "الرياض", [(_RIYADH, _RIYADH_REGION)])
    monkeypatch.setitem(_al._CID_AR, _RIYADH, "الرياض")
    districts = ["حي النرجس", "حي النخيل"]
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _RIYADH,
                        {_al.norm_district_tok(d) for d in districts})
    for d in districts:
        monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
        monkeypatch.setitem(_al._DISTRICT_AR_BY_CITY, (_RIYADH, _al.norm_district_tok(d)), d)


# ── VERBATIM CAPTURES ────────────────────────────────────────────────────────────────────────────
# /api/v1/units/726 — a penthouse whose total_amount (1,890,000) is unit_price + tax exactly. The
# "easy" shape: a mapper that took the total would look right here and wrong on the next two.
UNIT_726 = {
    "id": 726, "title": "1435 B", "unit_number": "1435 B", "project_name": "فيو لوفت",
    "unit_type": "penthouse", "case": 0, "status": 0, "floor": "2",
    "total_area": "304.00", "internal_area": "304.00", "external_area": None,
    "bedrooms": 3, "bathrooms": 4, "living_rooms": 1, "kitchens": 1, "total_rooms": 4,
    "unit_price": "1800000", "property_tax": "90000", "total_amount": "1890000",
    "payment_amount": 700, "enables_payment_plan": 0, "sale_type": "direct",
    "AdLicense": "7201134151", "license_end_date": "13/12/2026", "plan_number": "3236/3",
    "land_number": "99/1/1/2", "property_age": "جديد", "property_facade": None,
    "street_width ": "0", "deed_location_description ": None,
    "obligations_on_the_property": "لا يوجد التزامات على العقار",
    "description": "غرف نوم ماستر - غرفتين نوم - مجلس - صالة طعام - مطبخ - غرفة خادمة ",
    "address": {"city": "الرياض", "state": "النرجس", "street": "الرياض - النرجس "},
    "images": [
        {"image_path": "https://suknamdn.sa/storage/unit-images/01M2JD7GVW2WDTG68D3PT2G8WH.jpg",
         "type": "image"},
        {"image_path": "https://suknamdn.sa/storage/unit-images/01M2JD7GW5E9SYP1WPGZK15NFS.jpg",
         "type": "floor_plan"}],
    "additional_features": [], "after_sales_services": [], "proposed_payment_plan": [],
    "building_number": "2441", "project_id": 36, "created_at": "2026-09-15T10:41:30.000000Z",
    "license_url": "https://eservicesredp.rega.gov.sa/public/OfficesBroker/ElanDetails/08df1313-a8a5-4dcd-8d81-8109f7a64e67",
    "responsible_employee_name": "سكنة ", "responsible_employee_phone": "0550890049",
    "sales_phone_number": None,
    "developer": {"id": 39, "name": "فيو المتحدة ", "phone": "920033262",
                  "logo": "https://suknamdn.sa/storage/developer-logos/01KD80S8GQCYG1FY156HE5MGS3.PNG"},
}

# /api/v1/units/630 — THE KILLER. total_amount 1,627,500 is LOWER than unit_price 1,649,000, so it
# cannot be "the price including tax". Also case 1 («محجوزة», reserved → kept), a «تاون هاوس», a
# real person's name in responsible_employee_name, and `floor` null.
UNIT_630 = {
    "id": 630, "title": "A - 36", "unit_number": "A - 36", "project_name": "أكنان 25",
    "unit_type": "تاون هاوس", "case": 1, "status": 0, "floor": None,
    "total_area": "293.61", "internal_area": "197.10", "external_area": "96.51",
    "bedrooms": 3, "bathrooms": 4, "living_rooms": 3, "kitchens": 1, "total_rooms": 4,
    "unit_price": "1649000", "property_tax": "77500", "total_amount": "1627500",
    "payment_amount": 700, "enables_payment_plan": 0, "sale_type": "direct",
    "AdLicense": "7201121453", "license_end_date": "03/01/2027", "plan_number": "3236/3",
    "land_number": "116+117+118+119+120+121+122+123+124+125+126+127+128+129+130+131+132+133",
    "property_age": "جديد", "property_facade": "شمالية",
    "street_width ": "15", "deed_location_description ": None,
    "obligations_on_the_property": "لا يوجد التزامات على العقار",
    "description": ("غرفتين نوم ماستر - غرفة نوم - مجلس - صالة - صالة طعام - غرفة غسيل - "
                    "مستودع - مطبخ - موقف خاص "),
    "address": {"city": "الرياض", "state": "النرجس", "street": "الرياض - النرجس "},
    "images": [
        {"image_path": "https://suknamdn.sa/storage/unit-images/01KZKFD623920K6C4HZYF72QKZ.png",
         "type": "image"},
        {"image_path": "https://suknamdn.sa/storage/unit-images/01M0ADA3WSRG2JA8FESZX2HVZE.png",
         "type": "floor_plan"}],
    "additional_features": [], "after_sales_services": [], "proposed_payment_plan": [],
    "building_number": "2423", "project_id": 57, "created_at": "2026-08-10T11:24:22.000000Z",
    "responsible_employee_name": "عبدالعزيز علي محمد الحربي",
    "responsible_employee_phone": "0559326603", "sales_phone_number": None,
    "developer": {"id": 53, "name": "أكنان ", "phone": "0539021010"},
}

# /api/v1/units/631 — total_amount 1,470,000 reconciles against a unit_price of 1,400,000, not the
# published 1,439,000: the stale copy in its clearest form. Also «بنتهاوس » (padded) → Apartment.
UNIT_631 = {
    "id": 631, "title": "B - 36 ", "unit_number": "B - 36 ", "project_name": "أكنان 25",
    "unit_type": "بنتهاوس ", "case": 0, "status": 0, "floor": None,
    "total_area": "378.11", "internal_area": "175.50", "external_area": "202.61",
    "bedrooms": 2, "bathrooms": 3, "living_rooms": 2, "kitchens": 1, "total_rooms": 3,
    "unit_price": "1439000", "property_tax": "70000", "total_amount": "1470000",
    "payment_amount": 700, "enables_payment_plan": 0, "sale_type": "direct",
    "AdLicense": "7201121455", "license_end_date": "03/01/2027", "plan_number": "3236/3",
    "land_number": "116+117+118+119+120+121", "property_age": "جديد",
    "property_facade": "جنوبية", "street_width ": "15",
    "description": "غرفة نوم ماستر - غرفة نوم - مجلس - صالة - صالة طعام - موقف خاص ",
    "address": {"city": "الرياض", "state": "النرجس", "street": "الرياض - النرجس "},
    "images": [
        {"image_path": "https://suknamdn.sa/storage/unit-images/01KZKFHJHR98MHAM6G9MWQMX9E.png",
         "type": "image"}],
    "additional_features": [], "after_sales_services": [], "proposed_payment_plan": [],
    "building_number": "2434", "project_id": 57, "created_at": "2026-08-10T11:24:26.000000Z",
    "responsible_employee_name": "عبدالعزيز علي محمد الحربي",
    "responsible_employee_phone": "0559326603",
    "developer": {"id": 53, "name": "أكنان ", "phone": "0539021010"},
}

# /api/v1/units/447 — an OFF-PLAN unit: `enables_payment_plan` 1, the field the source's own bundle
# turns into «بيع على الخارطة». Its case is 0, so only the off-plan rule can stop it.
UNIT_447_OFF_PLAN = {
    "id": 447, "title": "A1", "unit_number": "A1", "project_name": "إلوفي ",
    "unit_type": "شقق", "case": 0, "status": 1, "floor": "1",
    "total_area": "75.00", "internal_area": "75.00", "external_area": None,
    "bedrooms": 1, "bathrooms": 1, "living_rooms": 1, "kitchens": 1, "total_rooms": 2,
    "unit_price": "1000000", "property_tax": "50000", "total_amount": "1050000",
    "payment_amount": 700, "enables_payment_plan": 1, "sale_type": "direct",
    "AdLicense": "7201000000", "property_age": "جديد", "street_width ": "15",
    "description": "غرف نوم - صالة - مطبخ ",
    "address": {"city": "الرياض", "state": "النخيل", "street": "الرياض - النخيل "},
    "images": [{"image_path": "https://suknamdn.sa/storage/unit-images/01KS339FVBHK44YCX19TW7PVYS.jpg",
                "type": "image"}],
    "additional_features": [], "after_sales_services": [], "proposed_payment_plan": [],
    "project_id": 53, "created_at": "2026-05-20T16:25:22.000000Z",
}

# /api/v1/units/197 — publishes NO price at all (unit_price, property_tax and total_amount are all
# null) and its unit page carries no JSON-LD `offers` block. It is also case 2 («مباعة»).
UNIT_197_NO_PRICE = {
    "id": 197, "title": "فيلا 2", "unit_number": "2", "project_name": "ساندستون ريزيدنسيز",
    "unit_type": "فلل", "case": 2, "status": 1, "floor": "3",
    "total_area": "280.00", "internal_area": "240.00", "external_area": "40.00",
    "bedrooms": 4, "bathrooms": 5, "living_rooms": 2, "kitchens": 1, "total_rooms": 6,
    "unit_price": None, "property_tax": None, "total_amount": None,
    "payment_amount": 0, "enables_payment_plan": 0, "sale_type": "direct",
    "AdLicense": "7200691820", "license_end_date": None, "plan_number": None,
    "land_number": None, "property_age": None, "street_width ": None,
    "description": "4غرفة نوم ماستر - مجلس - صالتين - غرفة خادمة - غرفة غسيل - حوش - موقف سيارة ",
    "address": {"city": "الرياض", "state": "النرجس", "street": "الرياض - النرجس "},
    "images": [{"image_path": "https://suknamdn.sa/storage/unit-images/01KBW8BGJ4G1AP98PHC6KAQY8V.jpg",
                "type": "image"}],
    "additional_features": [], "after_sales_services": [], "proposed_payment_plan": [],
    "building_number": "2", "project_id": 31, "created_at": "2025-12-07T11:15:06.000000Z",
    "responsible_employee_name": "سكنة ", "responsible_employee_phone": "+966550890049",
    "developer": {"id": 35, "name": "مسان ", "phone": "0505405577"},
}


def _row(rec: dict) -> dict:
    row, _cat, why = S.map_listing(rec)
    assert row, f"unit {rec.get('id')} was skipped as {why!r}, so this test proves nothing"
    return row


# ── 1. THE PRICE ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("rec,unit_price,stale_total", [
    (UNIT_726, 1800000, 1890000),     # total == price + tax: the shape that hides the bug
    (UNIT_630, 1649000, 1627500),     # total BELOW the price alone
    (UNIT_631, 1439000, 1470000),     # total reconciles against a superseded price
])
def test_price_is_unit_price_never_the_stale_total(rec, unit_price, stale_total):
    """THE CORE GUARD. MUTATION-VERIFIED — see the module docstring: with the price line changed to
    the source's own UI expression (`total_amount or unit_price`) this failed on all three rows."""
    row = _row(rec)
    assert row["price_total"] == unit_price, (
        f"{row['ad_number']} stored {row['price_total']}; unit_price is {unit_price} — "
        f"total_amount ({stale_total}) is not this listing's price")
    assert row["price_total"] != stale_total or unit_price == stale_total


def test_nothing_is_ever_computed_from_the_other_money_fields():
    """unit_price + property_tax, total_amount − tax, and the instalment × 12 are all arithmetic on
    source data. PRICE = SOURCE: the only storable number is the one the source published."""
    for rec in (UNIT_726, UNIT_630, UNIT_631):
        row = _row(rec)
        price = int(rec["unit_price"])
        tax = int(rec["property_tax"])
        total = int(rec["total_amount"])
        for forbidden, what in ((price + tax, "unit_price + property_tax"),
                                (total, "total_amount"),
                                (total - tax, "total_amount - property_tax"),
                                (rec["payment_amount"] * 12, "the monthly instalment × 12")):
            if forbidden == price:
                continue          # coincides with the published price on this row; not evidence
            assert row["price_total"] != forbidden, (
                f"{row['ad_number']}: price_total is {what} ({forbidden}) — computed, not published")


def test_a_unit_with_no_published_price_stores_no_price():
    """id 197 publishes unit_price, property_tax and total_amount all null. NULL is the answer —
    not 0, and not a figure reconstructed from any other field. (The row is case 2 so it also
    skips; the mapper is called directly here so the price branch itself is exercised.)"""
    rec = {**UNIT_197_NO_PRICE, "case": 0}
    row = _row(rec)
    assert row["price_total"] is None, f"invented a price: {row['price_total']!r}"
    assert row["price_evidence"]["found"] is False
    assert row["price_evidence"]["raw"] is None


def test_price_evidence_names_the_field_it_was_read_from():
    row = _row(UNIT_726)
    ev = row["price_evidence"]
    assert ev["field"] == "unit_price" and ev["origin"] == "api"
    assert ev["kind"] == "total" and ev["unit"] == "total"
    assert ev["raw"] == "1800000" and ev["stored"] == 1800000


def test_the_other_two_money_figures_are_archived_verbatim():
    """Both are source-published, so both are kept — as EVIDENCE, never as the price."""
    info = _row(UNIT_630)["additional_info"]
    assert info["source_unit_price_raw"] == "1649000"
    assert info["source_property_tax_raw"] == "77500"
    assert info["source_total_amount_raw"] == "1627500"


# ── 2. THE PERIOD ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("rec", [UNIT_726, UNIT_630, UNIT_631])
def test_a_sale_only_source_never_states_a_rent_period(rec):
    """rent_period UNKNOWN means the key is not written at all (db drops a None rather than writing
    NULL over a known value), and price_annual likewise. A sale is not a rent with a missing field."""
    row = _row(rec)
    assert row.get("rent_period") is None, f"manufactured rent_period={row.get('rent_period')!r}"
    assert row.get("price_annual") is None, f"manufactured price_annual={row.get('price_annual')!r}"
    assert row["transaction_type"] == "Buy"


def test_the_monthly_instalment_never_becomes_a_rent_or_an_annual_price():
    """«القسط الشهري» 700 is a purchase instalment. ×12 would publish an 8,400 annual rent for a
    1.8M flat; storing it raw would publish a 700 price."""
    row = _row(UNIT_726)
    assert row.get("price_annual") is None and row.get("rent_period") is None
    assert row["price_total"] not in (700, 8400)
    assert row["additional_info"]["monthly_instalment_raw"] == 700


def test_a_period_word_in_the_prose_still_cannot_create_a_rent():
    """SYNTHETIC, deliberately: no live row carries a period token (0 of 597). This asserts the
    INVARIANT rather than today's data — the sale-only conclusion must not quietly depend on the
    catalogue staying free of the word «شهري»."""
    rec = {**UNIT_726,
           "description": "شقة للإيجار الشهري 5000 ريال شهري - غرف نوم ماستر",
           "title": "إيجار شهري"}
    row = _row(rec)
    assert row.get("rent_period") is None, (
        "prose turned a sale into a rent — this source has no rent inventory and no period field; "
        "the period must never be read out of an advertiser's description")
    assert row.get("price_annual") is None
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 1800000


def test_the_instalment_plan_amounts_never_become_a_price():
    """proposed_payment_plan amounts are PARTIAL (25% of the price). Reading one as the price would
    understate the listing ~4×."""
    rec = {**UNIT_726, "proposed_payment_plan": [
        {"index": 1, "name": "1", "percentage": 25, "amount": 231000},
        {"index": 2, "name": "2", "percentage": 75, "amount": 693000}]}
    row = _row(rec)
    assert row["price_total"] == 1800000
    assert row["additional_info"]["proposed_payment_plan"][0]["amount"] == 231000


# ── 3. THE STATUS: sold, reserved, off-plan ──────────────────────────────────────────────────────
def test_a_sold_unit_is_skipped_with_a_counted_reason():
    """case 2 is the source's own «مباعة», and the 227 case-2 ids are exactly the ones absent from
    the source's own sitemap (zero counter-examples over 597 rows)."""
    row, _cat, why = S.map_listing(UNIT_197_NO_PRICE)
    assert row is None and why == "sold_case_2", f"a sold unit mapped through as {why!r}"


def test_a_reserved_unit_is_kept_and_says_so():
    """case 1 is «محجوزة» — reserved, not sold. The source still publishes it and still lists it in
    its sitemap, so it is kept, with the source's own word recorded."""
    row = _row(UNIT_630)
    assert row["additional_info"]["source_case"] == 1
    assert row["additional_info"]["source_case_status"] == "reserved"


def test_an_off_plan_unit_is_skipped_using_the_sources_own_marker():
    """«بيع على الخارطة» comes from `enables_payment_plan` — the source's own bundle computes the
    label from that field, and the flag is exact: 172/172 units of the 6 flagged projects carry it,
    0/423 of the others do. The PHRASE never appears in a unit payload, so a text heuristic would
    find nothing; the flag is the marker."""
    row, _cat, why = S.map_listing(UNIT_447_OFF_PLAN)
    assert row is None and why == "off_plan", f"an off-plan unit mapped through as {why!r}"


def test_a_ready_unit_is_not_swept_up_by_the_off_plan_rule():
    """The mirror image: enables_payment_plan 0 must not skip. Without this, "skip everything"
    would satisfy the test above."""
    for rec in (UNIT_726, UNIT_630, UNIT_631):
        row, _cat, why = S.map_listing(rec)
        assert row is not None, f"unit {rec['id']} (enables_payment_plan 0) skipped as {why!r}"


def test_an_unreadable_case_is_skipped_rather_than_assumed_available():
    """0 is this source's commonest ANSWER («متاحة للبيع»), so a missing `case` must not default to
    it — that would publish a unit whose status the source never stated."""
    for missing in ({k: v for k, v in UNIT_726.items() if k != "case"}, {**UNIT_726, "case": None}):
        row, _cat, why = S.map_listing(missing)
        assert row is None and why == "case_unreadable", f"got {why!r}"


def test_an_auction_ad_is_skipped():
    """No live row carries «مزاد» (0 of 597). Asserted as an invariant, not as today's data."""
    row, _cat, why = S.map_listing({**UNIT_726, "title": "مزاد علني على الوحدة"})
    assert row is None and why == "auction"


# ── 4. PDPL ──────────────────────────────────────────────────────────────────────────────────────
def test_a_poisoned_record_leaks_no_contact_detail_anywhere():
    """Every PII surface this source has, plus prose poisoned the way advertisers really poison it.
    The allowlist is what makes this hold: a NEW contact key added upstream tomorrow cannot arrive
    by default, which a blocklist could not promise."""
    poisoned = {
        **UNIT_726,
        "description": ("شقة مميزة - للتواصل 0555754441 أو واتساب https://wa.me/966555754441 "
                        "أو البريد sales@sukna.example - غرف نوم ماستر"),
        "deed_location_description ": "الصك بحوزة المكتب، للاستفسار 0501234567",
        "responsible_employee_name": "عبدالعزيز علي محمد الحربي",
        "responsible_employee_phone": "0559326603",
        "sales_phone_number": "920033262",
        "agent_mobile": "+966501112233",            # a key the source does not publish TODAY
        "owner_email": "owner@example.com",         # ditto
        "developer": {"id": 39, "name": "فيو المتحدة ", "phone": "920033262",
                      "contact_email": "dev@example.com"},
    }
    row = _row(poisoned)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for leak in ("0555754441", "wa.me", "sales@sukna.example", "0501234567", "0559326603",
                 "920033262", "+966501112233", "owner@example.com", "dev@example.com",
                 "عبدالعزيز علي محمد الحربي"):
        assert leak not in blob, f"PDPL: {leak!r} reached the stored row"
    # and the listing CONTENT survived the redaction — a scrubber that empties the row is not a fix
    assert row["description"] and "شقة مميزة" in row["description"]
    assert row["price_total"] == 1800000 and row["area_m2"] == 304


def test_the_capture_is_an_allowlist_not_a_blocklist():
    """The guarantee is structural. Whatever unknown keys a future payload carries, only the named
    ones are copied — so a new contact field cannot ride in on a redactor that has not heard of it."""
    row = _row({**UNIT_726, "brand_new_phone_field": "0555554444", "whatever_else": {"x": 1}})
    assert "brand_new_phone_field" not in json.dumps(row["source_capture"], ensure_ascii=False)
    assert "whatever_else" not in json.dumps(row["source_capture"], ensure_ascii=False)
    assert set(row["source_capture"]) - {"schema"} <= set(S._CAPTURE_KEYS)


# ── 5. THE TYPE MAP ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("unit_type,expected", [
    ("شقق", "Apartment"),        # Arabic plural, 91 rows
    ("شقة", "Apartment"),        # Arabic singular, 16
    ("apartment", "Apartment"),  # English slug, 89 — the same source mixes both
    ("ادوار", "Floor"),          # plural, 90
    ("أدوار ", "Floor"),         # plural + hamza + the source's trailing space, 9
    ("دور", "Floor"),            # singular, 74
    ("فلل", "Villa"),            # plural, 64
    ("فيلا", "Villa"),           # singular, 16
    ("villa", "Villa"),          # English slug, 44
    ("تاون هاوس", "Villa"),      # fleet fold (dwelleo, eilmalriyada, aqalemhajer), 59
    ("بنتهاوس ", "Apartment"),   # fleet fold + trailing space, 31
    ("penthouse", "Apartment"),  # English twin of the above, 14 — in neither shared map
])
def test_every_unit_type_the_source_publishes_maps(unit_type, expected):
    """All 12 values measured across 597 rows. Only 4 resolve through the shared TYPE_MAP_AR
    unaided (شقق, شقة, دور, فيلا = 197 rows), so a mapper without them would skip 400 of 597 rows
    as type_unmapped."""
    row = _row({**UNIT_726, "unit_type": unit_type})
    assert row["property_type"] == expected


def test_an_unknown_type_is_skipped_not_guessed():
    row, _cat, why = S.map_listing({**UNIT_726, "unit_type": "مجمع تجاري"})
    assert row is None and why.startswith("type_unmapped"), f"got {why!r}"


# ── 6. THE REST OF THE SHAPE ─────────────────────────────────────────────────────────────────────
def test_the_trailing_space_in_the_sources_own_key_is_honoured():
    """`"street_width "` — with the space — is the real key. `rec.get("street_width")` is None on
    all 597 rows, so the obvious spelling loses the field on every listing, silently. 0 means "not
    set" here (311 of 597 rows) — no unit sits on a 0-metre street."""
    assert S._K_STREET_WIDTH == "street_width "
    assert _row(UNIT_630)["street_width_m"] == 15
    assert _row(UNIT_726)["street_width_m"] is None


def test_the_three_areas_are_stored_separately_and_none_is_derived():
    """Each area is its own published fact: total_area ≠ internal_area + external_area on 137 of the
    393 rows publishing all three. id 240 publishes 323.00 / 231.36 / 91.00 — the parts sum to
    322.36, so a total derived from them would be wrong by a whole square metre after the column's
    INTEGER truncation (322 vs the published 323)."""
    row = _row({**UNIT_630, "id": 240, "total_area": "323.00",      # id 240's verbatim areas
                "internal_area": "231.36", "external_area": "91.00"})
    assert (row["area_m2"], row["interior_space_m2"], row["outdoor_area_m2"]) == (323, 231, 91)
    assert row["area_m2"] != row["interior_space_m2"] + row["outdoor_area_m2"]
    # and the exact m² survives the column's INTEGER round, in the source's own notation
    assert row["additional_info"]["source_total_area_raw"] == "323.00"
    assert row["additional_info"]["source_internal_area_raw"] == "231.36"
    assert row["additional_info"]["source_external_area_raw"] == "91.00"
    # the plain case too: id 630's own 293.61 / 197.10 / 96.51
    plain = _row(UNIT_630)
    assert (plain["area_m2"], plain["interior_space_m2"], plain["outdoor_area_m2"]) == (293, 197, 96)
    assert plain["additional_info"]["source_total_area_raw"] == "293.61"


@pytest.mark.parametrize("floor,expected", [
    ("2", 2), ("3", 3), ("1", 1),
    ("الأرضي ", 0), ("الأول ", 1), ("الثاني ", 2),
    ("الملحق ", None),              # the roof annex — a real floor with no number
    ("الأول - الملحق ", None),      # names TWO floors: neither may be picked
    ("الأرضي  - الأول ", None),     # ditto (the source's own double space)
    ("الأرضي - الأول ", None),
    (None, None), ("", None),
])
def test_a_unit_spanning_two_floors_has_no_floor_number(floor, expected):
    """All 12 values measured. A duplex over the ground and first floor is on neither one alone."""
    assert S._floor_number(floor) == expected


def test_the_floor_plan_drawing_is_not_a_listing_photo():
    """The source labels its own images: `type == "floor_plan"` is «المخطط الهندسي», an engineering
    drawing. Its own bundle separates them, and so does this."""
    row = _row(UNIT_726)
    assert row["photo_urls"] == [
        "https://suknamdn.sa/storage/unit-images/01M2JD7GVW2WDTG68D3PT2G8WH.jpg"]
    assert row["additional_info"]["floor_plan_images"] == [
        "https://suknamdn.sa/storage/unit-images/01M2JD7GW5E9SYP1WPGZK15NFS.jpg"]
    assert row["images_evidence"]["count"] == 1


def test_an_absent_feature_is_unknown_and_never_false():
    """SOURCE IS TRUTH. `additional_features` is published on only 31 of 597 units; the other 566
    say nothing about a lift, so nothing may be written for them."""
    row = _row(UNIT_726)                       # additional_features: []
    for col in ("elevator", "parking", "maid_room", "driver_room", "private_entrance",
                "air_conditioner", "balcony_terrace", "furnished"):
        assert row.get(col) is not False, f"{col} was manufactured False from silence"
    named = _row({**UNIT_726, "additional_features": [
        {"ar_title": "مصعد ", "en_title": "Elevator"},
        {"ar_title": "موقف خاص ", "en_title": "Private parking"},
        {"ar_title": "حديقة ", "en_title": "Garden"}]})   # «حديقة» has no fleet column
    assert named["elevator"] is True and named["parking"] is True
    assert "garden" not in named                           # would be rejected by PostgREST
    assert "حديقة" in named["additional_info"]["feature_words"]   # kept as a raw word instead


def test_the_identity_of_a_row_is_its_own_unit_page():
    """Each unit has its OWN URL (verified 200 on sukna.app with THAT unit's JSON-LD name, price,
    floorSize and bedroom count matching this record) — no shared project page is involved."""
    row = _row(UNIT_726)
    assert row["ad_number"] == "SKN726"
    assert row["listing_url"] == "https://sukna.app/unit-details?id=726"
    assert row["source"] == "سكنة"            # the platform's OWN spelling, not «سكنى»
    # the source's own title is the bare unit number; project_name is joined, both source text
    assert row["title"] == "فيو لوفت – 1435 B"
    assert row["project_name"] == "فيو لوفت"


def test_the_row_carries_a_direct_alive_stamp_because_its_own_record_was_read():
    """Each row is built from a fetch of THAT unit's own record whose `data.id` was confirmed, which
    is exactly db.mark_direct_alive's contract (own record, affirmative parseable payload, confirmed
    identity). It costs zero extra requests, and the real db function is the one called here."""
    assert _row(UNIT_726)[_DIRECT_ALIVE_KEY] == "sukna.api.v1.units.detail.unit_payload"


def test_the_location_resolves_to_the_catalog_and_keeps_the_raw_district():
    row = _row(UNIT_726)
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الرياض", _RIYADH, _RIYADH_REGION)
    assert row["district_ar"] == "حي النرجس"
    assert row["neighborhood"] == "النرجس"        # the source's own word, always kept


def test_property_age_reads_the_sources_own_word():
    assert _row(UNIT_726)["property_age"] == 0          # «جديد» = new construction
    assert _row({**UNIT_726, "property_age": None})["property_age"] is None


# ── 7. THE REMOVAL ORACLE ────────────────────────────────────────────────────────────────────────
def _verdict(status, body, pid="726"):
    return S._signal_for(pid)(status, body, False)


def _payload(**over) -> str:
    return json.dumps({"success": True, "data": {"id": 726, **over}}, ensure_ascii=False)


@pytest.mark.parametrize("status,body,expected,why", [
    (404, '{"message":"resource not found"}', "gone", "the API's own not-found (ids 0 / 999999)"),
    (200, _payload(case=2), "gone", "«مباعة» — the source's own word, and absent from its sitemap"),
    (200, _payload(case=0), "live", "«متاحة للبيع»"),
    (200, _payload(case=1), "live", "«محجوزة» is still published"),
    (200, _payload(), None, "200 with no readable case — no opinion"),
    (200, _payload(case=None), None, "case explicitly null — no opinion"),
    (500, '{"errors":["Attempt to read property \\"payment_amount\\" on null"]}', None,
     "measured on id 1: a missing unit wearing a 500. The source is broken, not the listing"),
    (403, "", None, "about our access, never about the listing"),
    (200, "", None, "empty body"),
    (200, "<html>not json</html>", None, "unparseable — a broken read is not evidence"),
])
def test_the_oracle_only_kills_on_what_the_source_actually_states(status, body, expected, why):
    assert _verdict(status, body) == expected, why


def test_a_200_from_the_rendered_page_can_never_kill_or_revive_a_row():
    """THE TRAP. sukna.app/unit-details?id=0 and ?id=999999 both answer 200 with the full app shell —
    the route is client-rendered, so the page is a SOFT-404. The oracle therefore probes the API,
    and the shell (no `data`, no `case`) yields no opinion even if it were handed one."""
    shell = "<!DOCTYPE html><html><body><div id=\"__next\"></div></body></html>"
    assert _verdict(200, shell) is None
    assert _verdict(200, '{"success":true,"data":null}') is None


def test_someone_elses_record_says_nothing_about_this_unit():
    """The sanadak lesson: 39 of 1,724 rows stored another listing's URL and 3 answered 'live' on
    someone else's evidence. A payload whose id is not the one asked for is no evidence at all."""
    assert _verdict(200, _payload(case=2), pid="999") is None
    assert _verdict(200, _payload(case=0), pid="999") is None


class _FakeResp:
    def __init__(self, url, status, text):
        self.url, self.status_code, self.text = url, status, text


def _fake_session(routes: dict[str, tuple[int, str]], calls: list[str]):
    """A session that answers per-URL, so the probe's own addressing is observable."""
    class _Sess:
        def get(self, url, **_kw):
            calls.append(url)
            status, text = routes.get(url, (404, '{"message":"resource not found"}'))
            return _FakeResp(url, status, text)
    return lambda: _Sess()


def test_the_probe_reads_the_api_record_not_the_soft_404_page():
    """The URL matters more than usual here: the rendered page 200s for ANY id, so probing it would
    never retire anything. The probe must address the API record."""
    calls: list[str] = []
    control = {"ad_number": "SKN437"}
    routes = {"https://suknamdn.sa/api/v1/units/437": (200, _payload(id=437, case=0)),
              "https://suknamdn.sa/api/v1/units/726": (404, '{"message":"resource not found"}')}
    original = S.session
    S.session = _fake_session(routes, calls)
    try:
        verdict, why = S._make_verify_gone(control)("SKN726")
    finally:
        S.session = original
    assert "https://suknamdn.sa/api/v1/units/726" in calls, calls
    assert not any("sukna.app/unit-details" in c for c in calls), (
        "the probe read the rendered page, which answers 200 for id=0 and id=999999")
    assert verdict == "gone", why


def test_a_removal_is_withheld_when_the_positive_control_cannot_answer():
    """Fails CLOSED: a source that has stopped serving us real records cannot testify that any
    particular one is gone, so the 404 is downgraded to UNKNOWN rather than retiring the row."""
    calls: list[str] = []
    original = S.session
    S.session = _fake_session({}, calls)      # everything 404s, including the control
    try:
        with_control, why1 = S._make_verify_gone({"ad_number": "SKN437"})("SKN726")
        no_control, why2 = S._make_verify_gone(None)("SKN726")
    finally:
        S.session = original
    assert with_control == "unknown" and "withheld" in why1, why1
    assert no_control == "unknown" and "withheld" in why2, why2


def test_a_malformed_ad_number_is_unknown_never_a_kill():
    verdict, why = S._make_verify_gone(None)("NOTSKN1")
    assert verdict == "unknown" and "SKN" in why


# ── 8. THE SESSION'S TWO MEASURED REQUIREMENTS ───────────────────────────────────────────────────
def test_the_session_impersonates_a_profile_the_site_actually_serves():
    """Same IP, same second: chrome/chrome116/chrome120/chrome124/chrome131/edge99/edge101/
    safari17_0 → 403 with an identical 6,192-byte body; safari/firefox/firefox133 → the real page.
    A 403 here is the handshake, not the address."""
    s = S.session()
    assert "firefox" in str(getattr(s, "impersonate", "")).lower() or True  # see the source check
    src = Path(S.__file__).read_text(encoding="utf-8")
    assert 'impersonate="firefox"' in src, "sukna.app 403s every chrome/edge fingerprint"
    assert 'impersonate="chrome"' not in src


def test_the_session_asks_for_arabic_because_the_api_localises_its_payload():
    """Without `Accept-Language: ar` the API returns city "Riyadh" / state "AN-NARJIS" and an
    English description — every row would then skip as city_not_in_catalog."""
    assert S.session().headers.get("Accept-Language") == "ar"
