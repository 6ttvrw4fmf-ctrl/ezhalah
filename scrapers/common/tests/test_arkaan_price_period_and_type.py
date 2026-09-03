"""Arkaan (أركان العقار) — the four source-fidelity invariants that make this scraper honest.

Fixtures are REAL fragments captured from arkaanalaqar.com on 2026-09-02 (index card + detail page
price card / ad body), fed to the REAL `scrapers.arkaan.run.map_listing` — not a re-implementation.

What each case pins, and why it exists:
  1. «السوم N ريال / سوم المتر M ريال» — the site publishes a total AND a per-square-metre rate for
     the same listing. They go in SEPARATE columns; the rate is never folded into the total, and the
     total is never re-derived from rate x area (2,000 x 1,020 happens to equal 2,040,000 — a
     scraper that multiplied would look right here and be wrong everywhere else). This shape also
     emits `"offers": null` in JSON-LD, so a JSON-LD-only price read loses the price entirely.
  2. «السعر على السوم» — the source STATES there is no price. That must be db.AUTHORITATIVE_NULL
     (which forces the NULL through the no-clobber guard), never 0 and never a plain None that gets
     dropped and leaves a withdrawn price standing.
  3. PERIOD = SOURCE, in both directions: «سنوياً» in the listing's own ad body → 'annual'; a rent
     ad that states no period at all → rent_period NULL, with the published amount kept as-is.
  4. «دبلكس» maps to the EXISTING canonical type Duplex through the per-platform exact-match
     override (63 live listings), and «أرض تجارية» vs «أرض سكنية» splits Commercial/Residential Land
     off the rendered type text — the only place that distinction exists on this source.
Plus: bathrooms / property_age / rega_location_verified are never written, because this source
publishes none of them and an absent key is the difference between "unknown" and "no".
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv so importing scrapers.common.db is hermetic (same as the aqar tests) ──
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.arkaan.run as arkaan_run  # noqa: E402
from scrapers.arkaan.run import map_listing  # noqa: E402
from scrapers.common import db  # noqa: E402

# The Arabic location catalog is loaded from the live DB and is shared infrastructure with its own
# tests; stubbing the lookup keeps THESE cases hermetic and about price/period/type only. The values
# are the real catalog ids the live scraper resolves for الأحساء, so the wiring is still pinned.
arkaan_run.to_catalog = lambda city_ar, region_hint=None: ((3677, 5) if city_ar else (None, None))


def _item(pid, *, ptype, deal, hood, title, specs, price_text, landno=""):
    return {"id": pid, "landno": landno, "hood": hood, "ptype": ptype, "deal": deal,
            "status": "active", "specs": specs, "price_text": price_text, "title_text": title,
            "last_updated": "قبل 5 ساعات", "index_image": None}


def _detail(*, type_text, price_card, ad_text, offers, lat=None, lng=None):
    return {"http_status": 200, "type_text": type_text, "lat": lat, "lng": lng,
            "ad_text": ad_text, "price_card": price_card,
            "ld": {"@type": "RealEstateListing", "name": type_text, "offers": offers,
                   "datePosted": "2026-09-02", "image": [],
                   "contentLocation": {"address": {"addressLocality": "الأحساء",
                                                   "addressRegion": "المنطقة الشرقية"}}}}


# ── 1. السوم total + per-metre rate, JSON-LD offers null (live id 1067) ──────────────────────────
def test_sawm_total_and_per_meter_are_separate_columns_and_never_multiplied():
    row, cat = map_listing(
        _item("1067", ptype="أرض", deal="للبيع", hood="محاسن", title="أرض تجارية للبيع",
              specs={"الحي": "محاسن", "رقم": "270", "المساحة": "1,020 م²",
                     "الشارع": "15 × مرفق × مرفق يليه شارع 60 م"},
              price_text="2,040,000"),
        _detail(type_text="أرض تجارية للبيع",
                price_card="السعر السوم 2,040,000 ريال سوم المتر 2,000 ريال "
                           "السعر غير شامل الضريبة والسعي واتساب اتصال",
                ad_text="للبيع ارض تجارية في حي محاسن رقم 270 المساحة 1,020 م²",
                offers=None, lat=25.417207, lng=49.546789))
    assert cat == "commercial"
    assert row["property_type"] == "Commercial Land"
    assert row["price_total"] == 2040000        # the published total, read from the card
    assert row["price_per_meter"] == 2000       # its own column — NOT folded into the total
    assert row["price_annual"] is None
    assert row["area_m2"] == 1020
    # A "60 × 20"-style frontage is not a single street width: the numeric column stays NULL and
    # the source's own string survives in additional_info.
    assert row["street_width_m"] is None
    assert row["additional_info"]["street_width_raw"] == "15 × مرفق × مرفق يليه شارع 60 م"
    assert row["additional_info"]["price_label"] == "السوم"
    assert row["price_evidence"]["json_ld_offers_price"] is None   # JSON-LD alone would lose this
<<<<<<< HEAD
    # Coordinates live in additional_info, NOT as a top-level key: no *_listings table in the
    # fleet has a latitude/longitude column, so writing one there made every real insert fail
    # with PGRST204 (caught on the first production run of this scraper). Asserting the fold
    # keeps the source value captured while pinning it out of the row shape.
    assert "latitude" not in row
    assert row["additional_info"]["latitude"] == 25.417207
=======
    assert row["latitude"] == 25.417207
>>>>>>> 2cdf686 (Add 5 audited Saudi platforms: therc, aouj, abralosol, arkaan, rawasidark)


# ── 2. «السعر على السوم» — the source states there is no price (live id 1059) ────────────────────
def test_price_on_request_is_authoritative_null_not_zero():
    row, _ = map_listing(
        _item("1059", ptype="أرض", deal="للبيع", hood="الزهراء 1", title="أرض تجارية للبيع",
              specs={"المساحة": "696 م²", "الشارع": "50 م", "رقم": "26"},
              price_text="على السوم"),
        _detail(type_text="أرض تجارية للبيع",
                price_card="السعر على السوم السعر غير شامل الضريبة والسعي واتساب اتصال",
                ad_text="للبيع ارض تجارية في حي الزهراء 1 المساحة 696 م² على السوم",
                offers=None))
    assert row["price_total"] is db.AUTHORITATIVE_NULL   # forces the NULL; 0/None would not
    assert row["price_total"] != 0
    assert row["price_per_meter"] is None
    assert row["price_evidence"]["authoritative_absent"] is True
    assert row["price_evidence"]["found"] is False    # the source showed nothing, ≠ we failed to read
    assert "على السوم" in row["price_evidence"]["price_card_text"]
    assert row["additional_info"]["price_on_request"] is True
    assert row["street_width_m"] == 50


# ── 3. PERIOD = SOURCE, both directions (live ids 96 and 1087) ───────────────────────────────────
def test_rent_period_read_from_the_ads_own_words():
    row, _ = map_listing(
        _item("96", ptype="مزرعة", deal="للإيجار", hood="طريق العقير", title="مزرعة للإيجار",
              specs={"المساحة": "1,000 م²"}, price_text="30,000"),
        _detail(type_text="مزرعة للإيجار", price_card="السعر 30,000 ريال واتساب اتصال",
                ad_text="للايجار مشتل صك على طريق العقير المساحة 1,000 م² السعر 30 ألف ريال سنوياً",
                offers={"price": 30000, "priceCurrency": "SAR"}))
    assert row["rent_period"] == "annual"
    assert row["price_annual"] == 30000
    assert row["price_total"] is None


def test_rent_with_no_stated_period_keeps_the_price_and_leaves_period_null():
    row, _ = map_listing(
        _item("1087", ptype="شقة", deal="للإيجار", hood="الصحافة (شرق المحدود)",
              title="شقة عائلية للإيجار",
              specs={"الدور": "الدور الأول", "غرف النوم": "3", "المجلس": "1"},
              price_text="16,000"),
        _detail(type_text="شقة عائلية للإيجار", price_card="السعر 16,000 ريال واتساب اتصال",
                ad_text="للايجار شقة عائلية في حي الصحافة الدور الأول تتكون من ثلاث غرف نوم + مجلس "
                        "السعر 16 ألف ريال",
                offers={"price": 16000, "priceCurrency": "SAR"}))
    assert row["rent_period"] is None          # the source never said annual — so we never do
    assert row["price_annual"] == 16000        # but a published price is never hidden
    assert row["bedrooms"] == 3
    assert row["reception_rooms_majlis"] == 1


# ── 4. Type mapping: the override, and the land residential/commercial split ─────────────────────
def test_dabalks_maps_to_the_existing_canonical_duplex_type():
    row, _ = map_listing(
        _item("1070", ptype="دبلكس", deal="للبيع", hood="الرابية بالعيون", title="دبلكس للبيع",
              specs={"الحالة": "جاهز"}, price_text="770,000"),
        _detail(type_text="دبلكس جاهز للبيع",
                price_card="السعر 770,000 ريال السعر غير شامل الضريبة والسعي "
                           "يقبل الشراء بواسطة البنك واتساب اتصال",
                ad_text="للبيع دبلكس في حي الرابية بالعيون",
                offers={"price": 770000, "priceCurrency": "SAR"}))
    assert row["property_type"] == "Duplex"
    assert row["additional_info"]["bank_purchase_accepted"] is True
    assert row["additional_info"]["price_includes_tax_and_commission"] is False


def test_residential_and_commercial_land_split_comes_from_the_rendered_type_text():
    specs = {"المساحة": "500 م²", "الشارع": "15 م"}
    res, res_cat = map_listing(
        _item("1088", ptype="أرض", deal="للبيع", hood="التعاون بضاحية هجر", title="أرض للبيع",
              specs=specs, price_text="300,000"),
        _detail(type_text="أرض سكنية للبيع", price_card="السعر 300,000 ريال سعر المتر 600 ريال",
                ad_text="للبيع ارض سكنية", offers={"price": 300000}))
    com, com_cat = map_listing(
        _item("1077", ptype="أرض", deal="للبيع", hood="محاسن", title="أرض تجارية للبيع",
              specs=specs, price_text="400,000"),
        _detail(type_text="أرض تجارية للبيع", price_card="السعر 400,000 ريال سعر المتر 1,000 ريال",
                ad_text="للبيع ارض تجارية", offers={"price": 400000}))
    assert (res["property_type"], res_cat) == ("Residential Land", "residential")
    assert (com["property_type"], com_cat) == ("Commercial Land", "commercial")
    assert res["price_per_meter"] == 600 and res["price_total"] == 300000


# ── 5. Silent source ⇒ the key is never written ──────────────────────────────────────────────────
def test_fields_this_source_never_publishes_are_absent_not_defaulted():
    row, _ = map_listing(
        _item("1088", ptype="أرض", deal="للبيع", hood="التعاون بضاحية هجر", title="أرض للبيع",
              specs={"المساحة": "500 م²"}, price_text="300,000"),
        _detail(type_text="أرض سكنية للبيع", price_card="السعر 300,000 ريال",
                ad_text="للبيع ارض سكنية", offers={"price": 300000}))
    for col in ("bathrooms", "property_age", "rega_location_verified", "halls"):
        assert col not in row, f"{col} must not be written — Arkaan never publishes it"
    assert row["city"] == "Hofuf" and row["region"] == "Eastern Province"
    assert row["ad_number"] == "AK1088"
    # Nothing absent may arrive as a concrete false/0 either — the `or 0` / `or False` class.
    concrete = {k: v for k, v in row.items()
                if v is False or (v == 0 and not isinstance(v, bool))}
    assert concrete == {}, f"absent source values written as false/0: {concrete}"


# ── 6. An unmapped type is QUARANTINED — no invented Arabic label, no invented English type ──────
# Compliance audit 2026-09-02: this path used to fall back to `type_text or ptype or "unknown"`,
# writing the source's Arabic phrase into the canonical ENGLISH property_type column — and filing
# the row wrong on top of it, because category_for_type() answers "Commercial" for anything outside
# its residential set. Same rule as therc/rawasidark/aouj: drop the row, never label it.
def test_an_unmapped_type_is_quarantined_never_labelled():
    assert map_listing(
        _item("999", ptype="زقورة", deal="للبيع", hood="التعاون", title="زقورة للبيع",
              specs={"المساحة": "500 م²"}, price_text="300,000"),
        _detail(type_text="زقورة للبيع", price_card="السعر 300,000 ريال",
                ad_text="للبيع زقورة", offers={"price": 300000})) is None


# ── 7. PRICE = SOURCE: JSON-LD may not supply a TOTAL over a card that printed only a RATE ───────
# The price card is the declared authority. When it publishes «سعر المتر» and no «السعر»/«السوم»
# line, offers.price is not provably a total on that page — and a per-square-metre rate written into
# price_total is exactly the wasalt/aqar ppm-as-total defect. No total then; the rate still lands,
# alone, in price_per_meter.
def test_json_ld_never_supplies_a_total_when_the_card_printed_only_a_rate():
    row, _ = map_listing(
        _item("998", ptype="أرض", deal="للبيع", hood="التعاون", title="أرض للبيع",
              specs={"المساحة": "400 م²"}, price_text="سعر المتر 930"),
        _detail(type_text="أرض سكنية للبيع", price_card="سعر المتر 930 ريال واتساب اتصال",
                ad_text="للبيع ارض سكنية", offers={"price": 930}))
    assert row["price_per_meter"] == 930
    assert row["price_total"] is None            # absent key ⇒ NULL, no stored value clobbered
    assert row["area_m2"] == 400                 # and never 930 × 400 = 372,000
    assert row["price_total"] != 930 * row["area_m2"]
