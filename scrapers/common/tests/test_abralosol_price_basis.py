"""abralosol's P0: the price cell's Arabic LABEL is the only place the basis is published.

28% of this source is priced PER SQUARE METRE. The machine-readable attribute on the detail page
(`<div content="1500">`) carries the number WITHOUT the basis, so an ingestion that trusts it books
nid 7779 — a 511 m² Al-Ahsa plot at «🟡 المتر 1,500 ريال» — as a 1,500 SAR plot. Three orders of
magnitude, on roughly a quarter of the catalog.

Every fragment below is REAL HTML copied from a live fetch on 2026-09-02, and every assertion runs
the SHIPPING functions (`run._price`, `run.map_listing`) — never a re-implementation.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.abralosol import run as R  # noqa: E402

# nid 4687 — «السعر» 4,000,000 total. The trailing "11" after the eye icon is a VIEW COUNTER.
CELL_TOTAL = """<strong>
                              السعر
4,000,000<br>

<i class="fa fa-eye" aria-hidden="true"></i>
11
<a href="https://wa.me/?text=%20https://abralosol.com/4687"></a>
                            </strong>"""

# nid 7779 — «المتر» 1,500 PER SQUARE METRE, 511 m² plot. The trap.
CELL_PER_SQM = """<strong>
                              المتر
1,500<br>

<i class="fa fa-eye" aria-hidden="true"></i>
1
<a href="https://wa.me/?text=%20https://abralosol.com/7779"></a>
                            </strong>"""

# nid 5335 — «على السوم»: open to offers, NO figure at all (~10% of the catalog).
CELL_NO_PRICE = """<strong>
                              على السوم<br>
<i class="fa fa-eye" aria-hidden="true"></i>
7
</strong>"""

# nid 7776 — a bare amount with NO label anywhere (16 of 2,761 measured; the detail page has no
# label block either). Basis is UNPUBLISHED.
CELL_UNLABELLED = """<strong>

22,000<br>

<i class="fa fa-eye" aria-hidden="true"></i>
2
</strong>"""


def _index(nid: str, price_cell: str, title_lines: str, district: str = "الراجحي",
           area: str = "المساحة\n511م\n<br>شارع\n40") -> dict:
    return R._parse_index({"nid": nid, "cells": {
        "view-field-als-r-table-column": price_cell,
        "view-nothing-1-table-column": f"<strong>{area}</strong>",
        "view-field-tags-table-column": f"<strong>{district}<br></strong>",
        "view-nothing-table-column":
            f'<strong><a href="/{nid}" hreflang="en">{title_lines}</a><br>'
            f'<a href="/{nid}"><img src="/sites/default/files/IMG-17-WA0004.png"></a><br>'
            f'02/09/2026</strong>',
    }})


def _row(nid, price_cell, title_lines, detail=None):
    mapped = R.map_listing(_index(nid, price_cell, title_lines), detail or {})
    return mapped[0] if mapped else None


# ── the P0 itself ───────────────────────────────────────────────────────────────────────────────
def test_per_sqm_never_lands_in_price_total():
    row = _row("7779", CELL_PER_SQM, "أرض\n\nللبيع")
    assert row["price_per_meter"] == 1500
    assert row["price_total"] is None


def test_per_sqm_is_never_multiplied_by_area_into_a_total():
    row = _row("7779", CELL_PER_SQM, "أرض\n\nللبيع")
    assert row["area_m2"] == 511
    assert row["price_total"] is None and row["price_annual"] is None   # 511 × 1,500 = 766,500


def test_total_lands_in_price_total_only():
    row = _row("4687", CELL_TOTAL, "عمارة\nتجاري سكني\n\nللبيع")
    assert (row["price_total"], row["price_per_meter"]) == (4000000, None)


# ── the view counter is not a price ─────────────────────────────────────────────────────────────
def test_view_counter_is_not_read_as_the_amount():
    assert R._price(CELL_TOTAL)["amount"] == 4000000
    assert R._price(CELL_PER_SQM)["amount"] == 1500


def test_no_figure_stays_null_and_the_view_counter_does_not_fill_it():
    p = R._price(CELL_NO_PRICE)
    assert p["label"] == "على السوم" and p["basis"] == "total"
    assert p["amount"] is None                      # NOT 7 (the eye-icon counter)
    row = _row("5335", CELL_NO_PRICE, "عمارة\nسكنية\nللايجار")
    assert row["price_total"] is None and row["price_annual"] is None


# ── longest-label-first ─────────────────────────────────────────────────────────────────────────
def test_sawm_almitr_is_per_sqm_not_a_total_sawm():
    assert R._price("<strong>سوم المتر\n1,200<br>x</strong>")["basis"] == "per_sqm"
    assert R._price("<strong>حد للمتر\n1,400<br>x</strong>")["basis"] == "per_sqm"
    assert R._price("<strong>الحد\n900,000<br>x</strong>")["basis"] == "total"


# ── unpublished basis → NULL in BOTH columns (never a guess from magnitude) ──────────────────────
def test_unlabelled_amount_is_not_placed_in_either_price_column():
    p = R._price(CELL_UNLABELLED)
    assert p["amount"] == 22000 and p["basis"] is None
    row = _row("7776", CELL_UNLABELLED, "شقة\nسكنية\nللايجار")
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["price_amount_raw"] == 22000   # kept, never lost


def test_detail_label_recovers_a_missing_index_label():
    row = _row("7766", CELL_UNLABELLED, "أرض\n\nللبيع", detail={"label": "المتر"})
    assert row["price_per_meter"] == 22000 and row["price_total"] is None


# ── a TOTAL label the body itself contradicts (real nid 7729) ───────────────────────────────────
# Index cell «السوم 1,600» (a total-basis label) on a 500 m² plot, body «وسعر المتر 1,600 ريال».
BLOCKS_7729 = [
    "🟡 رقم الأرض 213 + 215 + 217", "🟡 بلك 14", "🟨 المساحة 500 م", "🟡 شارع عرض15 متر",
    "🟡 السوم", "1,600 ريال",
    "للبيع 3 قطع أراضي سكنية في حي جوهرة الهادي (حي أحد)، بلك 14، أرقام 213 و215 و217، "
    "مساحة كل قطعة 500م، شارع 15م، وسعر المتر 1,600 ريال.",
]
CELL_SAWM_1600 = "<strong>السوم\n1,600<br>\n<i class='fa fa-eye'></i>\n4\n</strong>"


def test_body_per_metre_statement_beats_a_total_label_on_the_same_figure():
    row = _row("7729", CELL_SAWM_1600, "أرض\n\nللبيع", detail={"blocks": BLOCKS_7729})
    assert row["price_per_meter"] == 1600
    assert row["price_total"] is None                       # NOT 1,600 SAR for a 500 m² plot
    assert row["additional_info"]["price_basis_from"] == "body_states_per_metre"


def test_a_per_metre_line_naming_a_DIFFERENT_figure_never_overrides():
    blocks = ["🟡 السعر", "850,000 ريال", "أرض مجاورة سعر المتر 1,600 ريال"]
    row = _row("9999", "<strong>السعر\n850,000<br>x</strong>", "أرض\n\nللبيع",
               detail={"blocks": blocks})
    assert row["price_total"] == 850000 and row["price_per_meter"] is None


def test_arabic_indic_digits_in_the_body_still_match():
    blocks = ["سعر المتر ١,٦٠٠ ريال"]
    assert R._per_metre_in_body(1600, blocks) is True


# ── PERIOD = SOURCE ─────────────────────────────────────────────────────────────────────────────
def test_rent_without_a_source_period_stores_no_period_and_no_annual():
    row = _row("7766", "<strong>السعر\n14,000<br>x</strong>", "شقة\n\nللايجار")
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] is None and row["price_annual"] is None
    assert row["additional_info"]["price_amount_raw"] == 14000


# Real bodies, rent facet, 2026-09-02. The period IS published on 4 of the 25 rent ads — reading
# only the price label NULLed a period the source states outright (owner rule 2026-08-13).
def test_body_states_the_period_about_this_figure_so_it_is_read():
    blocks = ["شقة للإيجار في المبرز، وتتكون من غرفتين، ومجلس. الإيجار السنوي 12,000 ريال."]
    row = _row("7580", "<strong>السعر\n12,000<br>x</strong>", "شقة\nسكنية\nللايجار",
               detail={"blocks": blocks})
    assert row["rent_period"] == "annual" and row["price_annual"] == 12000


def test_a_period_naming_a_DIFFERENT_figure_never_sets_this_listings_period():
    # A sale ad's «عقود سنويه» about its tenants, or a neighbouring unit's terms: not this price.
    blocks = ["الشقق مؤجرة عقود سنويه بقيمة 90,000 ريال", "الإيجار 16,000 ريال"]
    row = _row("9998", "<strong>السعر\n16,000<br>x</strong>", "شقة\n\nللايجار",
               detail={"blocks": blocks})
    assert row["rent_period"] is None and row["price_annual"] is None


def test_period_is_recorded_even_when_the_basis_is_unpublished_but_no_annual_is_asserted():
    blocks = ["العقد سنوي، والإيجار 22,000 ريال سنويًا"]
    row = _row("7776", CELL_UNLABELLED, "شقة\nسكنية\nللايجار", detail={"blocks": blocks})
    assert row["rent_period"] == "annual"
    assert row["price_annual"] is None          # basis unpublished → not provably a total
    assert row["additional_info"]["price_amount_raw"] == 22000


def test_monthly_body_period_uses_the_shared_x12_storage_conversion():
    row = _row("9997", "<strong>السعر\n1,500<br>x</strong>", "شقة\n\nللايجار",
               detail={"blocks": ["الإيجار 1,500 ريال شهري"]})
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 18000)


def test_a_buy_row_never_gets_a_period_from_a_body_that_mentions_annual_contracts():
    blocks = ["العمارة مؤجرة بالكامل عقود سنويه", "🟡 السعر", "4,000,000 ريال"]
    row = _row("4687", CELL_TOTAL, "عمارة\nتجاري سكني\nللبيع", detail={"blocks": blocks})
    assert row["rent_period"] is None and row["price_annual"] is None
    assert row["price_total"] == 4000000


# ── PDPL: the office's own sign-off is a contact CTA ────────────────────────────────────────────
def test_contact_cta_is_cut_but_plot_numbers_survive():
    assert "أرقامنا" not in R._clean("مزرعة مميزة 📞 للمهتمين أرقامنا للتواصل 0555929231")
    assert R._clean("ارقام القطع 213 - 215 - 217") == "ارقام القطع 213 - 215 - 217"


# ── the source's OWN word for an agricultural plot is not residential land ──────────────────────
def test_agricultural_land_maps_to_the_existing_farm_type():
    assert _row("7700", CELL_TOTAL, "ارض زراعيه\n\nللبيع")["property_type"] == "Farm"
    assert _row("7701", CELL_TOTAL, "أرض\nارض زراعيه\nللبيع")["property_type"] == "Farm"


# ── an unfetched detail page never asserts "no photos" ──────────────────────────────────────────
def test_failed_detail_fetch_does_not_claim_the_listing_has_no_photos():
    assert _row("7779", CELL_PER_SQM, "أرض\n\nللبيع", detail={})["photo_urls"] is None


# ── deal / type: silence is never a default ─────────────────────────────────────────────────────
def test_a_listing_with_no_deal_word_is_not_defaulted_to_buy():
    assert R.map_listing(_index("7548", CELL_TOTAL, "أرض"), {}) is None


def test_commercial_land_comes_from_the_sources_own_tsnyf():
    assert _row("7702", CELL_TOTAL, "أرض\nتجارية\nللبيع")["property_type"] == "Commercial Land"
    assert _row("7703", CELL_TOTAL, "أرض\nسكنية\nللبيع")["property_type"] == "Residential Land"


def test_placeholder_image_is_not_a_photo():
    # detail page LOADED and carried only the shared placeholder → [] is a real source statement.
    row = _row("7779", CELL_PER_SQM, "أرض\n\nللبيع", detail={"blocks": [], "photo_urls": []})
    assert row["photo_urls"] == []


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"✓ {name}")
            except AssertionError as e:
                fails += 1
                print(f"✗ {name}: {e!r}")
    print("FAILED" if fails else "all green")
    sys.exit(1 if fails else 0)
