"""RENT PERIOD = SOURCE, fleet-wide (2026-08-11 audit).

The audit swept every platform that stores سنوي rent rows and found 11 scrapers MANUFACTURING the
period: `"rent_period": "annual" if is_rent else None` — a hardcoded constant gated only on the
deal word, applied to ~187 rent rows whose source states NO period anywhere (raghdan 127, alkhaas
24, sadin 8, mizlaj 7, hajer 5, ramzalqasim 3, aldarim 3, abeea 2, jurash 1, alhoshan 1, souq24 1
semi-annual mislabel). The owner's standing rule: a scraper must NEVER write a rental period the
source does not establish — missing → None (unknown), never a default.

This file pins the fix for every platform changed in that repair:
  · absence of a source period signal → rent_period None
  · a REAL source token (سنوي/شهري/…) → the correct period (monthly → ×12 storage conversion,
    identical to the fleet contract: price_annual/12 is what the card renders)
  · يومي/أسبوعي/نصف سنوي/ربع سنوي → no annual bucket exists: period None AND price_annual None
  · each platform's specific live regression case from the audit verdicts.

Offline and hermetic — inline fixtures, no network, no DB.

Run: python -m pytest scrapers/common/tests/test_rent_period_source_truth_2026_08_11.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import normalize  # noqa: E402


# ── the shared token reader (alkhaas / sadin / hajer route through it) ────────────────────────────

def test_helper_absence_is_unknown_price_kept():
    assert normalize.rent_period_and_annual(18000, "شقة في عنيزة حي المحمدية") == (None, 18000)
    assert normalize.rent_period_and_annual(None, "") == (None, None)


def test_helper_annual_token_is_annual_verbatim():
    assert normalize.rent_period_and_annual(20000, "الإيجار السنوي: 20,000") == ("annual", 20000)
    assert normalize.rent_period_and_annual(20000, "20,000 سنوياً") == ("annual", 20000)


def test_helper_monthly_token_annualizes_x12():
    # price_annual is divided by 12 for display, so ×12 round-trips to the source's own figure.
    assert normalize.rent_period_and_annual(2500, "الإيجار شهرياً 2500") == ("monthly", 30000)


def test_helper_daily_class_has_no_annual_bucket():
    assert normalize.rent_period_and_annual(500, "إيجار يومي") == (None, None)
    assert normalize.rent_period_and_annual(3000, "إيجار أسبوعي") == (None, None)


def test_helper_semi_annual_never_substring_matches_annual():
    # «نصف سنوي» contains «سنوي» — longest-first alternation must win (the souq24 defect class).
    assert normalize.rent_period_and_annual(33000, "33,000 نصف سنوي") == (None, None)
    assert normalize.rent_period_and_annual(10000, "ربع سنوي") == (None, None)


# ── raghdan: 127 manufactured سنوي rows — the largest single platform in the audit ────────────────

def _raghdan_body(name: str, price: int) -> str:
    ld = {"@type": "RealEstateListing", "name": name,
          "description": "المساحة 137.09 م²، عدد الغرف 3",
          "offers": {"price": str(price), "businessFunction": "http://purl.org/goodrelations/v1/LeaseOut"},
          "floorSize": {"value": "137"}}
    return f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'


def test_raghdan_rent_row_carries_no_period():
    from scrapers.raghdan.run import map_listing
    row, _cat = map_listing(_raghdan_body("شقة للإيجار النرجس", 95000),
                            "https://raghdan.sa/ar/property/tTkwg1uoAEzdvVZbuttZ")
    assert row is not None
    # raghdan publishes NO period anywhere (listing 598102: page prints a bare «٩٥ ألف») —
    # the old hardcode stored سنوي on all 127 rent rows.
    assert row["rent_period"] is None
    assert row["price_annual"] == 95000  # the published figure itself is untouched


# ── alkhaas: 24 rows, spec table publishes a bare price ───────────────────────────────────────────

def _alkhaas_body(title: str, price: str) -> str:
    return ("تفاصيل العقار<table>"
            f"<tr><th>عنوان الاعلان</th><td>{title}</td></tr>"
            "<tr><th>نوع العقار</th><td>ايجار</td></tr>"
            "<tr><th>قسم العقار</th><td>شقق</td></tr>"
            f"<tr><th>السعر</th><td>{price}</td></tr>"
            "</table>")


def test_alkhaas_no_token_is_unknown():
    from scrapers.alkhaas.run import map_listing
    row, _cat = map_listing(995, _alkhaas_body("شقة في عنيزة", "18000"))
    assert row is not None
    assert row["rent_period"] is None      # AKH995 live: «السعر: 18000», no period stated
    assert row["price_annual"] == 18000


def test_alkhaas_reads_a_real_token_when_the_source_prints_one():
    from scrapers.alkhaas.run import map_listing
    row, _cat = map_listing(996, _alkhaas_body("شقة للإيجار", "18000 سنوياً"))
    assert row is not None
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 18000


# ── sadin: 8 rows, الغرض=للإيجار but no period field (and no parseable price) ─────────────────────

def _sadin_html(title: str) -> str:
    return f'<meta property="og:title" content="{title} | سدين" />'


def test_sadin_no_token_is_unknown():
    from scrapers.sadin.run import map_listing
    row, _cat = map_listing("8L1F7", _sadin_html("شقة للإيجار طويل المدى"), {}, True)
    assert row is not None
    assert row["rent_period"] is None  # SD8L1F7 live: no period stated, price login-gated


def test_sadin_reads_a_real_token():
    from scrapers.sadin.run import map_listing
    row, _cat = map_listing("6NL89", _sadin_html("شقة للإيجار السنوي"), {}, True)
    assert row is not None
    assert row["rent_period"] == "annual"


# ── hajer: 5 rows, REM table has no period field ──────────────────────────────────────────────────

def _hajer_html(price_cell: str) -> str:
    def fld(label: str, val: str) -> str:
        return (f'<strong class="rem-single-field-title">{label}</strong>'
                f'<div class="rem-single-field-value">{val}</div>')
    return (fld("رقم الإعلان", "4023") + fld("نوع العقار", "شقة")
            + fld("غرض العقار", "إيجار") + fld("المدينة", "الهفوف")
            + fld("السعر", price_cell) + "</section>")


HAJER_P = {"id": 4023, "link": "https://hajerhouses.com/x", "title": {"rendered": "شقة"}}


def _stub_catalog(monkeypatch, module) -> None:
    # Hermetic: no DB catalog lookup (same pattern as test_catalog_fallback_…_2026_08_04.py).
    monkeypatch.setattr(module, "to_catalog", lambda city_ar, region_hint=None: (None, None))


def test_hajer_no_token_is_unknown(monkeypatch):
    import scrapers.hajer.run as hajer_run
    _stub_catalog(monkeypatch, hajer_run)
    row, _cat, _gone = hajer_run.map_listing(HAJER_P, _hajer_html("20,000 شامل الماي.ر.س"))
    assert row is not None
    assert row["rent_period"] is None  # HJ4023 live: «السعر : 20,000 شامل الماي.ر.س», no period
    assert row["price_annual"] == 20000


def test_hajer_reads_a_real_token_from_the_rem_table(monkeypatch):
    import scrapers.hajer.run as hajer_run
    _stub_catalog(monkeypatch, hajer_run)
    row, _cat, _gone = hajer_run.map_listing(HAJER_P, _hajer_html("20,000 سنوي ر.س"))
    assert row is not None
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 20000


# ── ramzalqasim / jurash / mizlaj / fursaghyr: source publishes no period → always unknown ───────

RQ_MARKER = {"id": 153, "price": "50000.00", "area": 315, "status": "rent", "type": "villa",
             "city": "عنيزة", "district": "المصيف", "bedrooms": 3, "bathroom": 2,
             "avalible": "available"}


def test_ramzalqasim_rent_row_carries_no_period():
    from scrapers.ramzalqasim.run import map_marker
    row, _cat, _gone = map_marker(RQ_MARKER)
    assert row is not None
    assert row["rent_period"] is None  # RQ153 live: «السعر: 50,000 ر.س», no period anywhere
    assert row["price_annual"] == 50000


def test_jurash_rent_row_carries_no_period():
    from scrapers.jurash.run import map_listing
    body = ("[pt_id] => 80\n[type] => شقة\n[status] => للإيجار\n[pt_price] => 24000\n"
            "[tr_title] => شقة للإيجار\n[city] => جرش\n")
    row, _cat, _gone = map_listing(body, "https://jurash.sa/property/80/x")
    assert row is not None
    assert row["rent_period"] is None  # JR80 live: zero period words on the whole page
    assert row["price_annual"] == 24000


def test_mizlaj_rent_row_carries_no_period():
    from scrapers.mizlaj.run import map_listing
    md = {"id": 73, "slug": "aakar-1200m2-llaygar-alryad", "name": "عقار للإيجار الرياض",
          "total_price": "60000", "advertisement_type": "rent"}
    row, _cat = map_listing(md, None)
    assert row is not None
    assert row["rent_period"] is None  # mizlaj publishes NO period (REGA landTotalAnnualRent null)
    assert row["price_annual"] == 60000


def test_fursaghyr_rent_row_carries_no_period():
    from scrapers.fursaghyr.run import map_listing
    item = {"id": 26842, "title": "شقة للإيجار", "permalink": "https://fursaghyr.com/x",
            "rea": {"property_type": "شقة", "purpose": "إيجار", "total_price": "55000",
                    "city": "الرياض"}}
    row, _cat = map_listing(item)
    assert row is not None
    assert row["rent_period"] is None  # rea payload has no period field — FG26842's سنوي was page-only
    assert row["price_annual"] == 55000


# ── aqaratikom: subtype IS a source period field — but its absence must not default to annual ────

def test_aqaratikom_subtype_mappings_kept():
    from scrapers.aqaratikom.run import _rent_period
    assert _rent_period("سنوي") == "annual"
    assert _rent_period("شهري") == "monthly"
    assert _rent_period("يومي") == "daily"


def test_aqaratikom_missing_subtype_is_unknown_not_annual():
    # e.g. a failed /ad/<id> detail fetch leaves subtype empty — the old else-branch stamped annual.
    from scrapers.aqaratikom.run import _rent_period
    assert _rent_period(None) is None
    assert _rent_period("") is None
    assert _rent_period("  ") is None


def test_aqaratikom_semi_annual_subtype_is_not_annual():
    from scrapers.aqaratikom.run import _rent_period
    assert _rent_period("نصف سنوي") is None
    assert _rent_period("ربع سنوي") is None


# ── erapulse: the API's own structured rentPeriod must be read, never hardcoded ───────────────────

def _erapulse_p(**kw) -> dict:
    p = {"refNumber": "REF-MKE6A0PT", "status": "ACTIVE", "subType": "APARTMENT",
         "isForRent": True, "rentPrice": 35000, "area": 100, "slug": "x", "user": {}}
    p.update(kw)
    return p


def test_erapulse_annual_field_read():
    from scrapers.erapulse.run import map_listing
    row, _cat = map_listing(_erapulse_p(rentPeriod="ANNUAL"))
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("annual", 35000)


def test_erapulse_monthly_field_annualizes_x12():
    from scrapers.erapulse.run import map_listing
    row, _cat = map_listing(_erapulse_p(rentPeriod="MONTHLY", rentPrice=1850))
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 22200)


def test_erapulse_missing_field_is_unknown_price_kept():
    from scrapers.erapulse.run import map_listing
    row, _cat = map_listing(_erapulse_p())
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == (None, 35000)


def test_erapulse_daily_class_has_no_annual_bucket():
    from scrapers.erapulse.run import map_listing
    row, _cat = map_listing(_erapulse_p(rentPeriod="DAILY", rentPrice=500))
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == (None, None)


# ── abeea: 'annual' only from an actual /Yearly suffix; dual pages' bare figure is not the rent ──

def _abeea_body(status: str, price_text: str) -> str:
    ld = {"@type": "House", "name": "Villa For Rent In Al Saif District",
          "address": {"addressLocality": "Al Khobar"}}
    items = (f"<strong>Property Status</strong> <span>{status}</span>"
             f"<strong>Price</strong> <span>{price_text}</span>"
             "<strong>Property Type</strong> <span>Villa</span>")
    return (f'<script type="application/ld+json">{json.dumps(ld)}</script>'
            f'<div class="detail-wrap"><ul>{items}</ul></div>')


def test_abeea_yearly_suffix_is_annual():
    from scrapers.abeea.run import map_listing
    row, _cat, _gone = map_listing(_abeea_body("For Rent", "SAR 150,000/Yearly"),
                                   "https://abeea.com.sa/en/property/villa-for-rent-in-al-saif-district/")
    assert row is not None
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 150000


def test_abeea_dual_status_bare_figure_is_neither_period_nor_rent_price():
    # ABRE195 (listing 645883) live: «For Rent, For Sale», Price «SAR 1,850,000» — no /Yearly,
    # no period wording anywhere; the old else-branch stored annual + the undesignated figure.
    from scrapers.abeea.run import map_listing
    row, _cat, _gone = map_listing(_abeea_body("For Rent, For Sale", "SAR 1,850,000"),
                                   "https://abeea.com.sa/en/property/villa-for-rent-in-al-saif-district/")
    assert row is not None
    assert row["rent_period"] is None
    assert row["price_annual"] is None


def test_abeea_monthly_branch_unchanged():
    from scrapers.abeea.run import map_listing
    row, _cat, _gone = map_listing(_abeea_body("For Rent", "SAR 4,000/Monthly"),
                                   "https://abeea.com.sa/en/property/villa-for-rent-in-al-saif-district/")
    assert row is not None
    assert row["rent_period"] == "monthly"


# ── souq24: «نصف سنوي» must never substring-match as «سنوي» ──────────────────────────────────────

def _souq24_price_div(label: str) -> str:
    return ('<div style="font-size:25px;color:#333">33,000'
            f'<span class="icon-Saudi_Riyal_Symbol-2"></span> {label} </div>')


def test_souq24_semi_annual_is_not_annual():
    # SQ24-1006 (listing 648161) live: «33,000 نصف سنوي» — stored annual 33,000, a 2x understatement.
    from scrapers.souq24.run import PRICE_RE, _rent_period_from_price_div
    body = _souq24_price_div("نصف سنوي")
    period = _rent_period_from_price_div(body, PRICE_RE.search(body))
    assert period == "semiannual"                      # NOT 'annual'
    assert period not in ("annual", "monthly")         # → rent_period NULL + price_annual NULL


def test_souq24_plain_tokens_still_read():
    from scrapers.souq24.run import PRICE_RE, _rent_period_from_price_div
    for label, want in (("سنوي", "annual"), ("شهري", "monthly"),
                        ("يومي", "daily"), ("ربع سنوي", "quarterly")):
        body = _souq24_price_div(label)
        assert _rent_period_from_price_div(body, PRICE_RE.search(body)) == want


def test_souq24_unstated_period_stays_unknown():
    from scrapers.souq24.run import PRICE_RE, _rent_period_from_price_div
    body = _souq24_price_div("")
    assert _rent_period_from_price_div(body, PRICE_RE.search(body)) is None


# ── aldarim: 'annual' only when the source's rent_price_annually field is non-null ───────────────

def _aldarim_L(**kw) -> dict:
    L = {"id": 25714, "category": "residential", "purpose": "rent", "type": "villa",
         "name_en": "Villa", "city": {"name": "Riyadh"}, "district": {"name": "X"}}
    L.update(kw)
    return L


def test_aldarim_annual_field_backs_annual(monkeypatch):
    import scrapers.aldarim.run as aldarim_run
    _stub_catalog(monkeypatch, aldarim_run)
    row, _cat = aldarim_run.map_listing(_aldarim_L(rent_price_annually=3700000))
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("annual", 3700000)


def test_aldarim_monthly_only_field_annualizes_x12(monkeypatch):
    import scrapers.aldarim.run as aldarim_run
    _stub_catalog(monkeypatch, aldarim_run)
    row, _cat = aldarim_run.map_listing(_aldarim_L(rent_price_monthly=10000))
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 120000)


def test_aldarim_no_rent_field_is_unknown_not_annual(monkeypatch):
    # ALD25714 live: every rent-price field null, page shows no price and no period — yet the old
    # else-branch stored rent_period='annual' (سنوي) on a priceless row.
    import scrapers.aldarim.run as aldarim_run
    _stub_catalog(monkeypatch, aldarim_run)
    row, _cat = aldarim_run.map_listing(_aldarim_L())
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == (None, None)


# ── alhoshan: annual only for a PRICED rentLong (the site's own 12-month-instalment semantics) ───

def _alhoshan_p(**kw) -> dict:
    p = {"publicId": 1001, "specs": {"propertyType": "apartment", "city": "الرياض",
                                     "area": 120, "district": "حي"},
         "purpose": "rentLong", "currentPrice": 50000, "title": "شقة"}
    p.update(kw)
    return p


def test_alhoshan_priced_rentlong_is_annual(monkeypatch):
    import scrapers.alhoshan.run as alhoshan_run
    _stub_catalog(monkeypatch, alhoshan_run)
    row, _cat = alhoshan_run.map_listing(_alhoshan_p())
    assert row is not None
    assert row["rent_period"] == "annual"  # AH1001: site renders price÷12 «/ شهرياً» over 12 months


def test_alhoshan_zero_price_rentlong_is_unknown(monkeypatch):
    # AH1024 live: currentPrice=0, page shows «٠» with no period label — the old hardcode stored
    # سنوي with a NULL price.
    import scrapers.alhoshan.run as alhoshan_run
    _stub_catalog(monkeypatch, alhoshan_run)
    row, _cat = alhoshan_run.map_listing(_alhoshan_p(currentPrice=0))
    assert row is not None
    assert row["rent_period"] is None


def test_alhoshan_rentshort_is_never_annual(monkeypatch):
    import scrapers.alhoshan.run as alhoshan_run
    _stub_catalog(monkeypatch, alhoshan_run)
    row, _cat = alhoshan_run.map_listing(_alhoshan_p(purpose="rentShort", currentPrice=350))
    assert row is not None
    assert row["rent_period"] is None


# ── eastabha: period from the page's own price label / statement — never a taxonomy default ──────

EA_TAXD = {"property_action_category": {1: "إيجار"}, "property_category": {},
           "property_city": {}, "property_area": {}, "property_county_state": {},
           "property_features": {}, "property_status": {}}


def _ea_p(title: str = "شقة للإيجار", content: str = "") -> dict:
    return {"id": 33902, "title": {"rendered": title}, "content": {"rendered": content},
            "property_action_category": [1], "link": "https://eastabha.sa/properties/x/"}


def test_eastabha_price_label_monthly_wins_and_annualizes():
    # EA33902 live: price label «2500 شهري قابل للتفاوض» — was stored rent_period=annual,
    # price_annual=2500 (the monthly figure in the annual column).
    from scrapers.eastabha.run import map_listing, parse_detail
    detail = parse_detail('<div class="price_area">2500 شهري قابل للتفاوض</div>')
    assert detail.get("price_period") == "monthly"
    row, _cat, _gone = map_listing(_ea_p(), EA_TAXD, detail, None)
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 30000)


def test_eastabha_price_label_annual_is_source_backed():
    from scrapers.eastabha.run import map_listing, parse_detail
    detail = parse_detail('<div class="price_area">سنويا 35,000 ريال</div>')
    assert detail.get("price_period") == "annual"
    row, _cat, _gone = map_listing(_ea_p(), EA_TAXD, detail, None)
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("annual", 35000)


def test_eastabha_description_statement_honored():
    # EA36013 live: «الإيجار الشهري: 1500 ريال فقط» — was stored annual with price_annual=1500.
    from scrapers.eastabha.run import map_listing
    row, _cat, _gone = map_listing(_ea_p(content="الإيجار الشهري: 1500 ريال فقط"), EA_TAXD,
                                   {"price": 1500}, None)
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 18000)


def test_eastabha_no_signal_is_unknown_price_kept():
    from scrapers.eastabha.run import map_listing
    row, _cat, _gone = map_listing(_ea_p(), EA_TAXD, {"price": 5000}, None)
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == (None, 5000)


def test_eastabha_title_fallback_kept():
    # No taxonomy at all + شهري in the title → rent, monthly, ×12 (pre-existing contract).
    from scrapers.eastabha.run import map_listing
    p = {"id": 595411, "title": {"rendered": "✨ شقق مؤثثة للإيجار – سنة دراسية أو شهري ✨"},
         "content": {"rendered": ""}, "link": "https://eastabha.sa/properties/x/"}
    row, _cat, _gone = map_listing(p, EA_TAXD, {"price": 3000}, None)
    assert row is not None
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 36000)


# ── aqarcity: sale/handover ads must not be keyword-classified monthly rent ──────────────────────

def test_aqarcity_sale_handover_title_kills_keyword_fallback():
    # Listing 593563 / aqarcity 29362: a car-parts SHOP handover (title «للبيع محل قطع غيار
    # سيارات», body mentions تقبيل + the shop's own rent «35 ألف سنوياً» + شهري prose). The
    # keyword fallback classified it monthly rent and ×12'd the 2,000,000 sale figure into a
    # manufactured 24,000,000/yr. Multi-number body → numeric disambiguation falls through.
    from scrapers.aqarcity.run import is_monthly_rental
    body = ("محل قطع غيار سيارات للبيع تقبيل، إيجار المحل والمستودع وسكن العمال 35000 ريال سنوياً "
            "الدخل الشهري 15000 وايجار شهري 3000 مدة العقد المتبقية 13 سنة")
    assert is_monthly_rental(body, "", 2000000, "للبيع محل قطع غيار سيارات") is False
    assert is_monthly_rental(body, "", 2000000, "تقبيل محل قطع غيار") is False


def test_aqarcity_keyword_fallback_unchanged_for_real_rentals():
    from scrapers.aqarcity.run import is_monthly_rental
    # Ambiguous multi-number rent ad, rent title → keyword fallback still fires as before.
    body = "للايجار 3 شقق عزاب الايجار الشهري : 1100 ريال وايجار شهري 900"
    assert is_monthly_rental(body, "YEAR", 14400, "شقق للإيجار") is True
    # And the numeric paths are untouched by the title gate.
    assert is_monthly_rental("السعر: 1700 ريال شهري شامل", "YEAR", 1700, "شقة للإيجار") is True
    assert is_monthly_rental("الايجار الشهري :3000ريال", "YEAR", 36000, "دور للإيجار") is False


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
