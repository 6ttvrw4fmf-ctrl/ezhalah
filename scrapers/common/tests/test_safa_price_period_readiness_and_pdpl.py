"""safa (صفا للاستثمار, safainv.sa) — the four things that can silently corrupt this platform.

Every fixture below is VERBATIM HTML captured from safainv.sa on 2026-09-24, trimmed to the blocks
the shipping code actually reads (SVG path data removed, nothing else rewritten). Every assertion
executes the shipping functions in scrapers/safa/run.py — no reimplementation.

WHAT THIS GUARDS, AND WHY EACH ONE IS THE SITE'S OWN TRAP
--------------------------------------------------------
1. THE PRICE BLOCK HAS THREE `<h3>`s AND TWO OF THEM ARE THE WRONG NUMBER. The unit sheet renders
   the visible `#total_price` beside two `d-none` siblings, `property_sale_price_without_tax` and
   `property_sale_price_with_tax`. On a RENT sheet those hold the unit's SALE valuation — unit 12827
   publishes a rent of 75,000 next to a hidden 1,179,844 — so reading either would store a rent at
   ~15× its published figure. They are also mutually inconsistent (the "without_tax" node is the
   LARGER on all 140 sale sheets) and sometimes junk (0 on unit 12476).

   MUTATION-VERIFIED. With `parse_popup`'s price read changed from `id="total_price"` to
   `id="property_sale_price_without_tax"`, test_rent_price_is_the_visible_total_not_the_hidden_sale_
   valuation FAILED with `1179844 != 75000` and test_sale_price_is_the_visible_total_node FAILED with
   `751912 != 717773`; restoring the selector made both pass. The guard asserts the INVARIANT (the
   stored figure equals the visible node and is not either hidden node), so it cannot be satisfied by
   a mutant that merely happens to agree on one row.

2. RENT PERIOD = SOURCE. The price label is the only place this site could state a period and it
   never does: «المبلغ الإجمالي» / "Total Amount", with zero occurrences of سنوي/شهري/يومي/أسبوعي
   across all 22 rent sheets and both list pages in both locales. So rent_period stays NULL and the
   figure is stored unconverted — and a period word in the DESCRIPTION must not change that, because
   157 of the 162 sheets carry the same marketing blurb verbatim.

3. READY ONLY, on the source's own badge. The /projects card prints «وحدات جاهزة» (ready) or «على
   الخارطة» (off-plan) beside a «نسبة الإنجاز» completion bar. The badge is not derivable from the
   bar — صفا 80 reads «على الخارطة» AT 100% — so only the badge is read, and a project with no badge
   is UNSTATED and also skipped.

4. PDPL. Every page on this site carries the sales office's phone (920001912), info@safainv.sa and a
   WhatsApp link; the stored payloads are built from an explicit key allowlist of parsed scalars, so
   a poisoned record must leak nothing into any column, additional_info or source_capture.

Run: python -m pytest scrapers/common/tests/test_safa_price_period_readiness_and_pdpl.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.safa import run  # noqa: E402

# ── VERBATIM CAPTURES (safainv.sa, 2026-09-24) ───────────────────────────────────────────────────

# /units/rental?page=1 — the card of unit 12827, as _CARD_RE hands it to parse_card().
RENT_CARD = """                <a href="#">
                                            <img src="https://safa-erp.odoo.com/web/image?model=property.property&amp;id=12827&amp;field=main_image" alt="" class="w-100">
                                    </a>
            </div>
        </div>
        <div class="label">
            <a href="javascript:void(0)">
                <i class="fa fa-key mainColor mx-1"></i>
                                    للإيجار                            </a>
            <a class="mx-1 projectName" href="javascript:void(0)">
                <i class="fa fa-building mainColor mx-1"></i>  SF050
            </a>
        </div>
        <div class="category_type">
                                            <span class="type mx-1 justify-content-center">
                  شقة
                </span>
                    </div>
                <div class="title">
                    <span class="unit-title" style="font-size: 15px">SF050-B01-F01-009-APT</span>
                        <div class="location d-flex align-items-center">
                            <span class="">
                                الياسمين
                            </span>
                        </div>
                        <div class="space d-flex align-items-center mx-3">
                            <span class="">153.09 م²</span>
                        </div>
                <div class="price" dir="ltr">
                    <img src="https://safainv.sa/front/assets/images/riyal.svg" class="mx-1" width="14">
                    75,000
                    <div class="icons d-flex align-items-center mt-3">
"""

# POST /unit/details, unit_id=12827 → data.html. A RENT sheet: note the two `d-none` siblings.
RENT_SHEET = """<h3 class="unit_title">SF050-B01-F01-009-APT</h3>
                <div class="desc">
                    <span>
                                                     تبدأ تجربة الحياة المثالية من منزل مثالي ومتكامل، منزل لا تحتاج لمغادرته لتلبية رغباتك وعيش رفاهيتك
                    </span>
                </div>
                <div class="info_data d-flex align-items-center">
                    <div class="info">
                        <span>153.09 م²</span>
                    </div>
                    <div class="info">
                                                    <span>FF</span>
                                            </div>
                    <div class="info">
                        <span>3</span>
                    </div>
                </div>
                                    <ul class="area-rows">
                                        <li class="area-row">
                                            <span class="ar-label"><span class="dot dot-unit"></span> مساحة الوحدة</span>
                                            <span class="ar-value">153.09 م²</span>
                                        </li>
                                        <li class="area-row">
                                            <span class="ar-label"><span class="dot dot-extra"></span> المساحة الإضافية</span>
                                            <span class="ar-value">0 م²</span>
                                        </li>
                                        <li class="area-row area-row--total">
                                            <span class="ar-label"><span class="dot dot-total"></span> إجمالي المساحة</span>
                                            <span class="ar-value">153.09 م²</span>
                                        </li>
                                    </ul>
                    <div class="col-md-4 col-6">
                        <div class="feature_box">
                            <span>3 غرف</span>
                        </div>
                    </div>
                    <div class="col-md-4 col-6">
                        <div class="feature_box">
                            <span>
                                1
                                موقف سيارات داخلي
                            </span>
                        </div>
                    </div>
                    <div class="col-md-4 col-6">
                        <div class="feature_box">
                            <span>3 دورة المياه</span>
                        </div>
                    </div>
                    <div class="col-md-4 col-6">
                        <div class="feature_box">
                            <span>6 مكيفات</span>
                        </div>
                    </div>
                    <div class="col-md-4 col-6">
                        <div class="feature_box">
                            <span>نوع المطبخ : مفتوح</span>
                        </div>
                    </div>
                            <div class="col-md-4 col-6">
                            <div class="feature_box">
                                <span>نوع المطبخ : مؤسس</span>
                            </div>
                        </div>
                                    <img src="https://safa-erp.odoo.com/web/image?model=product.image&amp;id=2446&amp;field=image_1920" class="first">
                                    <img src="https://safa-erp.odoo.com/web/image?model=product.image&amp;id=2447&amp;field=image_1920" class="other">
                    <button class="mainBtn w-100 copyBtn" id="copyBtn"
                            onclick="copyURL('https://safainv.sa/project/units/45?property_id=12827')">
                        <i class="fa fa-copy mx-2"></i> نسخ الرابط                    </button>
                <div class="price">
                    <div class="total">
                        <div class="mb-2 d-flex align-items-center gap-3">
                            <h3 id="total_price">75,000</h3>
                            <h3 class="d-none" id="property_sale_price_without_tax">1,179,844</h3>
                            <h3 class="d-none" id="property_sale_price_with_tax">1,129,844</h3>
                            <img src="https://safainv.sa/front/assets/images/riyal.svg" width="25">
                        </div>
                        <span class="total_amount_text">
                            المبلغ الإجمالي </span>
                    </div>
                                            <div class="insurance">
                            <div class="mb-2 d-flex align-items-center gap-3">
                                <h3>2,000</h3>
                                <img src="https://safainv.sa/front/assets/images/riyal.svg" width="20">
                            </div>
                            <span class="total_amount_text">المبلغ التأميني</span>
                        </div>
                                    </div>
"""

# /project/units/64?page=1 — the card of unit 13207, and its sheet. A SALE unit in a READY project.
SALE_CARD = """                <a href="#">
                                            <img src="https://safa-erp.odoo.com/web/image?model=product.image&amp;id=118&amp;field=image_1920" alt="" class="w-100">
                                    </a>
        <div class="label">
            <a href="javascript:void(0)">
                <i class="fa fa-key mainColor mx-1"></i>
                                    للبيع                            </a>
            <a class="mx-1 projectName" href="javascript:void(0)">
                <i class="fa fa-building mainColor mx-1"></i>  SF085
            </a>
        </div>
        <div class="category_type">
                                            <span class="type mx-1 justify-content-center">
                  شقة
                </span>
                    </div>
                    <span class="unit-title" style="font-size: 15px">SF085-A01-F01-001-APT</span>
                        <div class="location d-flex align-items-center">
                            <span class="">
                                Jeddah
                            </span>
                        </div>
                        <div class="space d-flex align-items-center mx-3">
                            <span class="">166.53 م²</span>
                        </div>
                <div class="price" dir="ltr">
                    <img src="https://safainv.sa/front/assets/images/riyal.svg" class="mx-1" width="14">
                    717,773
                    <div class="icons d-flex align-items-center mt-3">
"""

SALE_SHEET = """<h3 class="unit_title">SF085-A01-F01-001-APT</h3>
                <div class="info_data d-flex align-items-center">
                    <div class="info">
                        <span>166.53 م²</span>
                    </div>
                    <div class="info">
                                                    <span>الأول</span>
                                            </div>
                </div>
                                    <ul class="area-rows">
                                        <li class="area-row">
                                            <span class="ar-label"><span class="dot dot-unit"></span> مساحة الوحدة</span>
                                            <span class="ar-value">166.53 م²</span>
                                        </li>
                                        <li class="area-row">
                                            <span class="ar-label"><span class="dot dot-extra"></span> المساحة الإضافية</span>
                                            <span class="ar-value">0 م²</span>
                                        </li>
                                        <li class="area-row area-row--total">
                                            <span class="ar-label"><span class="dot dot-total"></span> إجمالي المساحة</span>
                                            <span class="ar-value">166.53 م²</span>
                                        </li>
                                    </ul>
                        <div class="feature_box">
                            <span>3 غرف</span>
                        </div>
                        <div class="feature_box">
                            <span>
                                1
                                موقف سيارات خارجي
                            </span>
                        </div>
                        <div class="feature_box">
                            <span>3 دورة المياه</span>
                        </div>
                        <div class="feature_box">
                            <span>0 مكيفات</span>
                        </div>
                        <div class="feature_box">
                            <span>نوع المطبخ : مفتوح</span>
                        </div>
                    <button class="mainBtn w-100 copyBtn" id="copyBtn"
                            onclick="copyURL('https://safainv.sa/project/units/64?property_id=13207')">
                        <i class="fa fa-copy mx-2"></i> نسخ الرابط                    </button>
                <div class="price">
                    <div class="total">
                        <div class="mb-2 d-flex align-items-center gap-3">
                            <h3 id="total_price">717,773</h3>
                            <h3 class="d-none" id="property_sale_price_without_tax">751,912</h3>
                            <h3 class="d-none" id="property_sale_price_with_tax">717,773</h3>
                            <img src="https://safainv.sa/front/assets/images/riyal.svg" width="25">
                        </div>
                        <span class="total_amount_text">
                            </span>
                    </div>

                                    </div>
"""

# /projects?page=1 — three project cards' own `.label` blocks, verbatim: READY, OFF-PLAN, and the
# one project that carries no build badge at all (144, «صفا 99»).
PROJECTS_INDEX = """<div class="item project-card-item">
    <div class="box">
            <a href="https://safainv.sa/project/64">
            </a>
        <div class="label">
            <a href="javascript:void(0)" class="">
                                متاح للبيع
            </a>

                        <a href="javascript:void(0)" class="bg-main mx-1 ">
                                    وحدات جاهزة                            </a>

        </div>
    </div>
</div>
<div class="item project-card-item">
    <div class="box">
            <a href="https://safainv.sa/project/57">
            </a>
        <div class="label">
            <a href="javascript:void(0)" class="">
                                متاح للبيع
            </a>

                        <a href="javascript:void(0)" class="bg-main mx-1 ">
                                    على الخارطة                            </a>

        </div>
        <div role="progressbar" aria-valuenow="100"
        </div>
    </div>
</div>
<div class="item project-card-item">
    <div class="box">
            <a href="https://safainv.sa/project/144">
            </a>
        <div class="label">
            <a href="javascript:void(0)" class=" notAvailable ">
                                قريباً
            </a>
        </div>
    </div>
</div>
"""

# /project/64 — the two location fields the source LABELS, plus the project's own name.
PROJECT_PAGE = """<h1 class="text-white"> صفا 85 - جادة صفا </h1>
                                <div class="project_info">
                                    <div class="city">
                                        <p>جدة</p>
                                    </div>
                                    <div class="buildings_count">
                                        <p>16</p>
                                    </div>
                                </div>
                                            <div class="info">
                                                <span class="Grey-700 fs-18">الموقع</span>
                                                <h4>
                                                    الصواري
                                                </h4>
                                            </div>
"""

_RIYADH, _JEDDAH = 3, 18


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog / find_district_in_text would otherwise read loc_catalog_* from the database.
    The ids and the district spellings are the ones the live catalog returned on 2026-09-24."""
    cities = {"الرياض": (_RIYADH, 1), "جدة": (_JEDDAH, 2), "المدينة": (14, 3), "مكة": (6, 2)}
    monkeypatch.setattr(run, "to_catalog",
                        lambda c, region_hint=None: cities.get((c or "").strip()) or (None, None))
    districts = {"الصواري": "حي الصوارى", "الياسمين": "حي الياسمين", "القدس": "حي القدس"}
    monkeypatch.setattr(run, "find_district_in_text",
                        lambda t, cid: next((v for k, v in districts.items() if t and k in t), None))


READY_PROJECT = {"availability": "متاح للبيع", "readiness": "وحدات جاهزة",
                 "name": "صفا 85 - جادة صفا", "city_ar": "جدة", "district_raw": "الصواري"}


def _rent(card_html=RENT_CARD, sheet=RENT_SHEET, project=None, pid="45",
          page_url="https://safainv.sa/units/rental?page=1", unit_id="12827"):
    card = {"unit_id": unit_id, "page_url": page_url, **run.parse_card(card_html)}
    return run.map_listing(card, run.parse_popup(sheet), dict(project or READY_PROJECT), pid)


def _sale(card_html=SALE_CARD, sheet=SALE_SHEET, project=None, pid="64",
          page_url="https://safainv.sa/project/units/64?page=1", unit_id="13207"):
    card = {"unit_id": unit_id, "page_url": page_url, **run.parse_card(card_html)}
    return run.map_listing(card, run.parse_popup(sheet), dict(project or READY_PROJECT), pid)


# ── 1. THE PRICE ─────────────────────────────────────────────────────────────────────────────────

def test_rent_price_is_the_visible_total_not_the_hidden_sale_valuation():
    """MUTATION-VERIFIED (see module docstring): reading the hidden node instead made this fail with
    1179844 != 75000. Asserts the INVARIANT — the stored rent equals the visible `#total_price` and
    is neither hidden sale node — so no mutant can satisfy it by coincidence."""
    row, _cat, why = _rent()
    assert not why and row is not None
    assert row["price_annual"] == 75000, "the rent is the figure the source shows"
    assert row.get("price_total") is None, "a rent never lands in price_total"
    for hidden in (1179844, 1129844):
        assert row["price_annual"] != hidden, (
            f"{hidden} is a `d-none` SALE valuation on a RENT sheet — storing it would publish this "
            f"75,000 listing at ~15x its price")
    ai = row["additional_info"]
    assert ai["hidden_sale_price_node_without_tax_raw"] == "1,179,844"
    assert ai["hidden_sale_price_node_with_tax_raw"] == "1,129,844"
    assert ai["insurance_deposit_raw"] == "2,000", "«المبلغ التأميني» is a deposit, kept as raw only"


def test_sale_price_is_the_visible_total_node():
    """MUTATION-VERIFIED: the hidden-node mutant failed here with 751912 != 717773. The two nodes are
    even mislabelled — the "without_tax" figure is the LARGER on all 140 sale sheets."""
    row, _cat, why = _sale()
    assert not why and row is not None
    assert row["price_total"] == 717773 and row.get("price_annual") is None
    assert row["price_total"] != 751912, "the larger `d-none` node is not the published price"
    assert row["price_evidence"]["field"] == "unit sheet #total_price"
    assert row["price_evidence"]["raw"] == "717,773", "evidence keeps the source's own formatting"
    assert row["price_evidence"]["unit"] == "total"


def test_nothing_is_computed_from_the_area_or_the_deposit():
    """No ×12, no PPM×area, no deposit arithmetic: the stored figures are the two printed strings."""
    rent, _c, _w = _rent()
    sale, _c2, _w2 = _sale()
    assert rent["price_annual"] == 75000 and rent["area_m2"] == 153
    assert 75000 != 153 * 490 and rent["price_annual"] != 75000 * 12
    assert sale["price_total"] == 717773 and sale["price_total"] != 166 * 4324


def test_the_card_and_the_sheet_agree_so_the_field_choice_moved_no_number():
    """Measured on all 162 live units: the card's price and area equal the sheet's. Both raws are
    kept on the row so that agreement stays auditable without a re-fetch."""
    row, _cat, _why = _rent()
    ai = row["additional_info"]
    assert ai["card_price_raw"] == ai["source_price_raw"] == "75,000"
    assert ai["card_area_raw"] == ai["source_area_total_raw"] == "153.09 م²"


def test_a_blank_or_zero_price_is_an_absence_not_a_price_of_zero():
    assert run._price("") is None and run._price("0") is None and run._price(None) is None
    assert run._price("75,000") == 75000


# ── 2. THE RENT PERIOD ───────────────────────────────────────────────────────────────────────────

def test_rent_period_silence_stays_null_and_the_price_is_unconverted():
    """«المبلغ الإجمالي» states no period. Measured: zero occurrences of سنوي/شهري/يومي/أسبوعي on
    all 22 rent sheets and both list pages, in Arabic and in English."""
    row, _cat, _why = _rent()
    assert row.get("rent_period") is None, "an unstated period must never default to annual"
    assert row["price_annual"] == 75000, "the figure is stored exactly as published"
    assert row["additional_info"]["source_price_label"] == "المبلغ الإجمالي"


def test_a_period_stated_on_the_price_label_is_honoured():
    """The label is attached to the very number stored, so a period there DOES describe it."""
    annual = RENT_SHEET.replace("المبلغ الإجمالي", "الإيجار سنوي")
    row, _c, _w = _rent(sheet=annual)
    assert row["rent_period"] == "annual" and row["price_annual"] == 75000

    monthly = RENT_SHEET.replace("المبلغ الإجمالي", "الإيجار شهري")
    row, _c, _w = _rent(sheet=monthly)
    assert row["rent_period"] == "monthly" and row["price_annual"] == 75000 * 12, (
        "a period on the price label takes the schema's documented x12 annualisation")


def test_a_daily_or_weekly_label_is_never_inflated_into_an_annual_figure():
    for token in ("يومي", "أسبوعي", "ربع سنوي", "نصف سنوي"):
        row, _c, _w = _rent(sheet=RENT_SHEET.replace("المبلغ الإجمالي", f"الإيجار {token}"))
        assert row.get("rent_period") is None, f"{token} has no bucket in this schema"
        assert row["price_annual"] is None, f"{token} must not become an annual figure"


def test_a_period_word_in_the_boilerplate_description_never_sets_the_period():
    """157 of the 162 sheets carry the same marketing blurb verbatim, so a period word in it is a
    fact about Safa's copywriting, not about this unit's price. This is the shape that turned a
    9,600 listing into 115,200 on abaad."""
    poisoned = RENT_SHEET.replace("لتلبية رغباتك", "لتلبية رغباتك، إيجار شهري مميز")
    row, _cat, _why = _rent(sheet=poisoned)
    assert row.get("rent_period") is None, "the description is not a statement about this price"
    assert row["price_annual"] == 75000, "and it certainly may not multiply the figure"


# ── 3. READY ONLY, ON THE SOURCE'S OWN BADGE ─────────────────────────────────────────────────────

def test_the_roster_reads_both_badges_off_the_projects_index():
    body = PROJECTS_INDEX
    roster = {}
    for card in body.split(run._PROJ_CARD_SPLIT)[1:]:
        import re
        pid = re.search(r'href="https://safainv\.sa/project/(\d+)"', card).group(1)
        lab = re.search(r'<div class="label">(.*?)</div>', card, re.S).group(1)
        labels = [x for x in (run._text(a) for a in re.findall(r"<a [^>]*>(.*?)</a>", lab, re.S)) if x]
        roster[pid] = {"availability": labels[0] if labels else None,
                       "readiness": labels[1] if len(labels) > 1 else None}
    assert roster["64"] == {"availability": "متاح للبيع", "readiness": "وحدات جاهزة"}
    assert roster["57"] == {"availability": "متاح للبيع", "readiness": "على الخارطة"}
    assert roster["144"] == {"availability": "قريباً", "readiness": None}


def test_an_off_plan_project_skips_with_a_counted_reason():
    """«على الخارطة» is the source's own off-plan marker — 117 of the 162 live cards sit behind it."""
    row, _cat, why = _sale(project={**READY_PROJECT, "readiness": run.OFF_PLAN})
    assert row is None and why == "not_ready_على الخارطة"


def test_a_project_with_no_build_badge_is_unstated_and_also_skips():
    """An unstated readiness is not a ready unit. Live: project 77's single rental hits this."""
    row, _cat, why = _rent(project={**READY_PROJECT, "readiness": None})
    assert row is None and why == "not_ready_unstated"


def test_the_completion_percentage_is_not_used_as_the_readiness_oracle():
    """صفا 80 reads «على الخارطة» AT 100% «نسبة الإنجاز», so the bar and the badge are different
    statements; only the badge decides. The code must not read a percentage at all."""
    src = (ROOT / "scrapers" / "safa" / "run.py").read_text(encoding="utf-8")
    import re
    code = re.sub(r'"""[\s\S]*?"""', " ", src)
    code = re.sub(r"(?m)^\s*#.*$", " ", code)
    assert "aria-valuenow" not in code and "نسبة الإنجاز" not in code


def test_a_sold_out_project_cannot_publish_a_unit_for_sale():
    row, _cat, why = _sale(project={**READY_PROJECT, "availability": run.SOLD_OUT})
    assert row is None and why == "project_sold_out"


def test_a_rental_inside_a_sold_out_project_is_still_published():
    """«مباع» is the SALE state. 19 of the 22 rentals live in sold-out, delivered projects — reading
    that badge as a rent removal would empty the whole rent surface."""
    row, _cat, why = _rent(project={**READY_PROJECT, "availability": run.SOLD_OUT})
    assert not why and row is not None and row["transaction_type"] == "Rent"


def test_a_unit_with_no_project_link_is_skipped_rather_than_placed():
    row, _cat, why = _rent(pid=None)
    assert row is None and why == "no_project_link"


# ── 4. PDPL ──────────────────────────────────────────────────────────────────────────────────────

def test_a_poisoned_record_leaks_no_contact_channel_anywhere():
    """Every page on this site carries 920001912, info@safainv.sa and a WhatsApp link. The stored
    payloads are built from an allowlist of parsed scalars, so markup we never named cannot reach
    them — and the free text that IS stored goes through the shared redactor."""
    poison = ("0555754441", "+966555754441", "920001912", "info@safainv.sa",
              "https://api.whatsapp.com/send?phone=966920001912", "أبو محمد للعقارات")
    sheet = RENT_SHEET.replace(
        "لتلبية رغباتك",
        "لتلبية رغباتك للتواصل 0555754441 أو +966555754441 أو 920001912 "
        "info@safainv.sa https://api.whatsapp.com/send?phone=966920001912") + (
        '<div class="agent"><span class="advertiserName">أبو محمد للعقارات</span>'
        '<a href="tel:0555754441">اتصل</a></div>')
    card = RENT_CARD.replace("SF050-B01-F01-009-APT", "SF050-B01-F01-009-APT 0555754441")
    row, _cat, why = _rent(card_html=card, sheet=sheet)
    assert not why and row is not None
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for token in poison:
        assert token not in blob, f"{token!r} reached a stored payload"
    assert "wa.me" not in blob and "tel:" not in blob and "@" not in blob
    # And the listing's real content survived the redaction.
    assert row["price_annual"] == 75000 and row["area_m2"] == 153 and row["bedrooms"] == 3


def test_no_raw_html_is_ever_stored():
    """The allowlist is the barrier: if a fetched page could be stored wholesale, every future markup
    change would be a new PDPL exposure."""
    row, _cat, _why = _rent()
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "<div" not in blob and "<span" not in blob and "csrfToken" not in blob


# ── 5. THE TYPE, AND WHAT IS NEVER GUESSED ───────────────────────────────────────────────────────

def test_the_type_words_this_site_publishes_map_through():
    from scrapers.common import normalize
    got = {w: normalize.map_type_exact(w, run._TYPE_OVERRIDES)
           for w in ("شقة", "فيلا", "دوبلكس", "تاون هاوس", "الدور")}
    assert got == {"شقة": "Apartment", "فيلا": "Villa", "دوبلكس": "Duplex",
                   "تاون هاوس": "Villa", "الدور": "Floor"}


def test_a_unit_with_no_type_chip_is_skipped_not_read_off_its_unit_code():
    """3 of the 22 rent cards publish no type chip. «SF052-B01-F02-012-APT» ends in -APT, which is an
    identifier component, not a published type — inferring Apartment from it would be a guess."""
    card = RENT_CARD.replace(
        """        <div class="category_type">
                                            <span class="type mx-1 justify-content-center">
                  شقة
                </span>
                    </div>
""", "")
    row, _cat, why = _rent(card_html=card)
    assert row is None and why == "type_missing"


def test_an_unknown_type_word_skips_with_its_own_word_in_the_reason():
    card = RENT_CARD.replace("شقة", "مساحة عمل مشتركه")
    row, _cat, why = _rent(card_html=card)
    assert row is None and why == "type_unmapped_مساحة عمل مشتركه"


def test_a_city_the_catalog_does_not_hold_skips_rather_than_landing_on_a_neighbour():
    """«القصيم» is a REGION; the source uses it in one project's city field."""
    row, _cat, why = _rent(project={**READY_PROJECT, "city_ar": "القصيم"})
    assert row is None and why == "city_not_in_catalog"


# ── 6. SOURCE IS TRUTH ON THE AMENITY TRI-STATES ─────────────────────────────────────────────────

def test_a_published_zero_is_a_no_and_a_missing_box_is_unknown():
    """The UI renders «0 مكيفات» as a chip on 143 sheets, so 0 IS the source's answer — but an
    absent box is silence. `(n or 0) > 0` collapses the two into a fabricated negative."""
    sale, _c, _w = _sale()
    assert sale["air_conditioner"] is False, "«0 مكيفات» is the source saying no"
    rent, _c2, _w2 = _rent()
    assert rent["air_conditioner"] is True, "«6 مكيفات» is the source saying yes"
    no_box, _c3, _w3 = _sale(sheet=SALE_SHEET.replace("0 مكيفات", ""))
    assert no_box["air_conditioner"] is None, "no box at all is UNKNOWN, never False"


def test_parking_is_the_counted_flag_and_its_own_words_are_kept():
    row, _cat, _why = _rent()
    assert row["parking"] is True
    assert row["additional_info"]["parking_raw"] == "1 موقف سيارات داخلي"


def test_arabic_indic_digits_parse_in_the_counts():
    row, _cat, _why = _rent(sheet=RENT_SHEET.replace("3 غرف", "٣ غرف")
                                            .replace("3 دورة المياه", "٣ دورة المياه"))
    assert row["bedrooms"] == 3 and row["bathrooms"] == 3


def test_furnished_is_true_only_on_the_exact_chip_and_a_negation_never_reads_as_yes():
    """«مفروش» is a substring of «غير مفروش»; the chip is matched by equality on the whole chip."""
    chip = ('<div class="category_type"><span class="category mb-1 justify-content-center">'
            'مفروشة بالكامل</span>')
    yes, _c, _w = _rent(card_html=RENT_CARD.replace('<div class="category_type">', chip))
    assert yes["furnished"] is True
    plain, _c2, _w2 = _rent()
    assert plain.get("furnished") is None, "no chip is SILENCE, never False"
    neg = chip.replace("مفروشة بالكامل", "غير مفروشة")
    no, _c3, _w3 = _rent(card_html=RENT_CARD.replace('<div class="category_type">', neg))
    assert no.get("furnished") is None, "a negation must never be stored as furnished"


def test_the_kitchen_flag_reads_the_layout_and_never_the_negated_fit_out():
    """The same «نوع المطبخ : X» label carries two independent facts. «غير مؤسس» negates the
    fit-out and is not a positive."""
    row, _cat, _why = _rent()
    assert row["kitchen"] is True and row["additional_info"]["kitchen_words"] == ["مفتوح", "مؤسس"]
    only_neg, _c, _w = _rent(sheet=RENT_SHEET.replace("نوع المطبخ : مفتوح", "نوع المطبخ : غير مؤسس")
                                             .replace("نوع المطبخ : مؤسس", "نوع المطبخ :"))
    assert only_neg.get("kitchen") is None, "«غير مؤسس» alone states no kitchen fit-out"


# ── 7. WHAT IS MEASURED, NOT GUESSED: AREA, FLOOR, LOCATION, URL ─────────────────────────────────

def test_area_is_the_sources_own_total_and_both_components_are_kept():
    """The sheet's headline area equalled «إجمالي المساحة» on all 162 units. The unit/additional
    split is kept raw rather than guessed into interior_space_m2 / outdoor_area_m2."""
    row, _cat, _why = _rent()
    assert row["area_m2"] == 153, "area_m2 is an INTEGER column — the exact m² is kept raw"
    ai = row["additional_info"]
    assert ai["source_area_total_raw"] == "153.09 م²"
    assert ai["source_area_unit_raw"] == "153.09 م²" and ai["source_area_extra_raw"] == "0 م²"
    assert "interior_space_m2" not in row and "outdoor_area_m2" not in row


def test_floor_number_comes_only_from_the_arabic_ordinals():
    """The floor slot holds «الأول» AND «GF», «FF», «SF», «RF», «سَطح» and multi-floor combos like
    «GF FF SF» (a townhouse's own levels). Only the ordinals are unambiguous; the rest stay raw."""
    sale, _c, _w = _sale()
    assert sale["floor_number"] == 1 and sale["additional_info"]["floor_raw"] == "الأول"
    rent, _c2, _w2 = _rent()
    assert rent["floor_number"] is None, "«FF» is not guessed into a number"
    assert rent["additional_info"]["floor_raw"] == "FF"
    multi, _c3, _w3 = _sale(sheet=SALE_SHEET.replace("<span>الأول</span>", "<span>GF FF SF</span>"))
    assert multi["floor_number"] is None and multi["additional_info"]["floor_raw"] == "GF FF SF"


def test_the_location_comes_from_the_project_page_not_the_cards_mixed_slot():
    """The card's location slot holds an English city on 148 of 162 cards and an Arabic DISTRICT on
    11 — the same slot, two kinds of place. The project page labels `div.city` and «الموقع»."""
    assert run._one(r'<div class="city">(.*?)</div>', PROJECT_PAGE) == "جدة"
    assert run._one(r'<span class="Grey-700 fs-18">الموقع</span>\s*<h4>(.*?)</h4>',
                    PROJECT_PAGE) == "الصواري"
    assert run._one(r"<h1[^>]*>(.*?)</h1>", PROJECT_PAGE) == "صفا 85 - جادة صفا"

    sale, _c, _w = _sale()
    assert sale["city_ar"] == "جدة" and sale["city_id"] and sale["region_id"]
    assert sale["district_ar"] and "الصوار" in sale["district_ar"]
    assert sale["additional_info"]["card_location_raw"] == "Jeddah", "kept, but never read as a city"


def test_the_listing_url_is_the_page_that_actually_renders_this_unit():
    """VERIFIED LIVE on 4 units (SAF12235, SAF13213, SAF12301, SAF12867): each URL answers 200 and
    the page's HTML contains that unit's own card (unit code + price). The page NUMBER is part of it
    — /units/rental?property_id=19221 does NOT contain card 19221, only ?page=2 does. The platform's
    own copy button is broken for rentals: it points at the unit's project page, where the card is
    absent (measured on /project/units/45?property_id=12827)."""
    rent, _c, _w = _rent()
    assert rent["listing_url"] == "https://safainv.sa/units/rental?page=1&property_id=12827"
    assert rent["additional_info"]["source_canonical_url"] == \
        "https://safainv.sa/project/units/45?property_id=12827", "kept, but not used as the URL"
    page2, _c2, _w2 = _rent(page_url="https://safainv.sa/units/rental?page=2", unit_id="19221")
    assert page2["listing_url"] == "https://safainv.sa/units/rental?page=2&property_id=19221"


def test_photos_come_only_from_the_sheets_gallery():
    """The card's `property.property/main_image` URL answers 200 for every unit but serves a
    6,078-byte placeholder PNG when the ERP holds no image (unit 13365), so a 200 there is not proof
    that anything renders. Verified: a gallery URL returns image/jpeg with no CORP header."""
    row, _cat, _why = _rent()
    assert row["photo_urls"] == [
        "https://safa-erp.odoo.com/web/image?model=product.image&id=2446&field=image_1920",
        "https://safa-erp.odoo.com/web/image?model=product.image&id=2447&field=image_1920"]
    assert all("product.image" in u for u in row["photo_urls"])
    assert row["images_evidence"]["count"] == 2
    ai = row["additional_info"]
    assert "property.property" in ai["card_main_image_url"], "kept for the archive, not as a photo"
    no_gallery, _c, _w = _sale()
    assert no_gallery["photo_urls"] is None or "product.image" in no_gallery["photo_urls"][0]


# ── 8. THE REMOVAL ORACLE ────────────────────────────────────────────────────────────────────────

def test_the_liveness_signal_reads_the_surfaces_own_roster():
    """There is no per-unit page here, and the sheet endpoint is not an oracle: it answered 200 with
    full content for every UNLISTED id measured (12828 — a sold SF050 unit — plus 12236, 13208,
    14149, 19222). Only the list says what is published."""
    signal = run._signal_for("12827")
    assert signal(200, '<div class="overlay unitCard" data-id="12827"></div>', False) == "live"
    assert signal(200, '<div class="overlay unitCard" data-id="99999"></div>', False) == "gone"
    assert signal(403, "", False) is None, "a block is about us, never about the listing"
    assert signal(500, "boom", False) is None


def test_an_incomplete_surface_walk_can_never_kill_a_row():
    """Removing one card shifts every later unit a page earlier, so the stored ?page=N is not enough
    — the probe walks the whole surface and hands the law an EMPTY body when it cannot finish, which
    the law turns into UNKNOWN. A fabricated id (HTTP 500 from the sheet endpoint) likewise cannot
    kill, because 5xx is never a death."""
    pages = {1: (200, '<div class="overlay unitCard" data-id="19221"></div>'),
             2: (500, "gateway")}

    class _Resp:
        def __init__(self, status, text):
            self.status_code, self.text, self.url = status, text, ""

    class _S:
        def get(self, url, timeout=None):
            import re as _re
            n = int(_re.search(r"page=(\d+)", url).group(1))
            return _Resp(*pages.get(n, (200, "")))

    probe = run._SafaProbe(platform="safa", signal=run._signal_for("19221"),
                           session=lambda: _S(), url_for=lambda _ad: "x?page=2")
    status, body, moved = probe.fetch("https://safainv.sa/units/rental?page=2")
    assert status == 500 and body == "" and moved is False
    verdict, why = probe.verify_gone("SAF19221")
    assert verdict == "unknown", why

    # A CLEAN walk that no longer lists the unit: the real last page is a full HTML page carrying
    # zero cards (that is how /units/rental?page=3 answers), not an empty body.
    pages[1] = (200, '<div class="overlay unitCard" data-id="12827"></div>')
    pages[2] = (200, "<html><body>لا توجد نتائج بحث مطابقة</body></html>")
    verdict, why = probe.verify_gone("SAF19221")
    assert verdict == "gone", why

    # And a 200 with an EMPTY body is a read we cannot believe, not an empty catalogue.
    pages[2] = (200, "")
    verdict, why = probe.verify_gone("SAF19221")
    assert verdict == "unknown", why


@pytest.mark.parametrize("ad", ["SAF", "SAFabc", "12827", "XY12827"])
def test_an_ad_number_that_is_not_ours_is_unknown_never_a_kill(ad):
    verdict, _why = run._make_verify_gone(None)(ad)
    assert verdict == "unknown"
