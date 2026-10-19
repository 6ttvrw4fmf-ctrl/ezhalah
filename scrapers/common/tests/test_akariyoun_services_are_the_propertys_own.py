"""عقاريون: a listing's services come from ITS OWN «خدمات العقار» cell, never the neighbourhood's list.

Every akariyoun.sa page prints «الخدمات المتوفرة في الحي» — شبكة الكهرباء / شبكة المياه / نظام الصرف
الصحي for the DISTRICT, the same template on every listing. The scraper tested for those words
anywhere in the page, so all 280 live rows carried electricity/water/sewage = True (measured
2026-09-21) while the property's own cell said e.g. «كهرباء, مياه». Fixtures are real markup from
akariyoun.sa pages fetched that day.

Run: python -m pytest scrapers/common/tests/test_akariyoun_services_are_the_propertys_own.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.akariyoun.run as AK  # noqa: E402
from scrapers.akariyoun.run import map_listing, parse_services  # noqa: E402
from scrapers.common.db import AUTHORITATIVE_NULL, _unknown_must_not_overwrite_known  # noqa: E402

# HERMETIC — same stubs as test_akariyoun_price_is_never_invented.py: the catalog is not under test.
AK.to_catalog = lambda city_ar, region_hint=None: (1, 1)
AK.find_district_in_text = lambda text, city_id: text

# The district's list — on EVERY page (ard-llbyaa-fy-hy-alghnamy-34, verbatim, trimmed to 3 items).
NEIGHBOURHOOD = """<h6 style="font-size: 13px; font-weight: normal; color: rgb(31, 107, 196)">الخدمات المتوفرة في الحي</h6>
<div class="avl-features third color d-block">
<li class="d-block w-100 mw-100"><i class="icon fas fa-check "></i><span>شبكة الكهرباء</span></li>
<li class="d-block w-100 mw-100"><i class="icon fas fa-check "></i><span>شبكة المياه</span></li>
<li class="d-block w-100 mw-100"><i class="icon fas fa-check "></i><span>نظام الصرف الصحي</span></li>
</div>"""


def cell(value: str) -> str:
    return ('<td class="p-2" style="width:25%" >\n<div class="small" style="color: rgb(33, 107, 194)">'
            f'خدمات العقار</div>\n<div>{value}</div>\n</td>')


def page(*parts: str) -> str:
    return ("<html><head><title>ارض للبيع في حي الغنامية - Akariyoun</title></head><body>"
            "<span>الرياض - الغنامية</span> <p>المساحة: 640 m²</p>"
            "<p>رقم الاعلان : 967</p><p>نوع العقار: ارض</p><p>للبيع</p>"
            + "".join(parts) + "</body></html>")


COLS = ("electricity", "water_supply", "sanitation", "optical_fibers")


# ── the incident: the neighbourhood's sewage became the property's ────────────────────────────────
def test_the_neighbourhood_list_is_not_the_propertys_services():
    """ard-llbyaa-fy-hy-alghnamy-34: «خدمات العقار: كهرباء, مياه». Sewage is the DISTRICT's."""
    row, _cat, _raw = map_listing("ard-x", page(cell("كهرباء, مياه"), NEIGHBOURHOOD))
    assert row["electricity"] is True and row["water_supply"] is True
    assert row["sanitation"] is AUTHORITATIVE_NULL, "the district's «نظام الصرف الصحي» is not this property's"
    assert row["optical_fibers"] is AUTHORITATIVE_NULL


def test_the_neighbourhood_list_alone_claims_nothing():
    assert all(v is not True for v in parse_services(page(cell("-"), NEIGHBOURHOOD)).values())


def test_a_read_failure_leaves_the_stored_values_alone():
    """No «خدمات العقار» cell found = we could not read it: no keys, so the upsert keeps what it had."""
    row, _cat, _raw = map_listing("ard-x", page(NEIGHBOURHOOD))
    assert not set(COLS) & set(row)


def test_a_cell_that_was_read_clears_a_stale_true():
    """The fix must REPAIR the 280 rows, not just stop adding more: the None-dropping upsert guard
    would otherwise keep every stored True forever. AUTHORITATIVE_NULL survives it as a real NULL."""
    row = dict(parse_services(cell("كهرباء, مياه")))
    _unknown_must_not_overwrite_known(row)
    assert "sanitation" in row and row["sanitation"] is None


# ── the label is matched as a label, not as text ─────────────────────────────────────────────────
def test_a_seller_named_for_services_does_not_shift_the_read():
    """fyla-llbyaa-fy-aark: the advertiser «… للخدمات العقارية» CONTAINS «خدمات العقار»."""
    advertiser = ('<div class="small" style="color: rgb(33, 107, 194)">اسم المعلن</div>\n'
                  '<div>شركة غيوم نجد للخدمات العقارية شركة شخص واحد</div>')
    got = parse_services(page(advertiser, cell("كهرباء, مياه, صرف صحي"), NEIGHBOURHOOD))
    assert (got["electricity"], got["water_supply"], got["sanitation"]) == (True, True, True)


def test_every_real_token_maps_and_order_does_not_matter():
    got = parse_services(cell("ألياف ضوئية, هاتف, صرف صحي, مياه, كهرباء"))
    assert all(got[c] is True for c in COLS), "هاتف has no column and must not disturb the rest"


# ── the four outcomes (owner rule): named -> True, negated -> False, silent -> NULL ──────────────
def test_no_services_is_a_statement_not_a_silence():
    """5 live pages say exactly «لايوجد خدمات» — the source says NO, so False, never NULL."""
    assert parse_services(cell("لايوجد خدمات")) == {c: False for c in COLS}


def test_a_cell_that_contradicts_itself_is_unknown():
    """ard-llaygar-fy-hy-almhdy lists services AND «لايوجد خدمات». Neither side is a safe claim."""
    got = parse_services(cell("كهرباء, مياه, لايوجد خدمات, تصريف الفيضانات , صرف صحي"))
    assert all(got[c] is AUTHORITATIVE_NULL for c in COLS)


def test_a_single_service_names_only_itself():
    """19 live pages say just «كهرباء»."""
    got = parse_services(cell("كهرباء"))
    assert got["electricity"] is True
    assert all(got[c] is AUTHORITATIVE_NULL for c in ("water_supply", "sanitation", "optical_fibers"))
    assert all(v is not False for v in got.values()), "a service the cell does not name is NULL, never False"
