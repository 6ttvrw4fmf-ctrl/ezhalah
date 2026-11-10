"""Four card-parity alarms (2026-11-07..09) where the page said what we store and the comparator could not read it.
Every snippet is the real page's own markup (read with Playwright, 2026-11-09); every test also proves the other
direction: a stored value the page really contradicts still scores MISMATCH."""
from scrapers.common import card_parity as cp
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing, page_lacks_its_ad
from scrapers.common.source_reread import page_evidence


def score(stored: dict, html: str) -> dict:
    ev = page_evidence(html)
    ev = {**ev, "evidence_lines": cp.paired_lines(ev.get("text_head", "")) + list(ev.get("evidence_lines") or [])}
    return compare_listing(stored, ev)


# ── ibaax: the /ar/ page prints its spec table with English labels ───────────────────────────────────────────────
IBAAX_348 = (
    '<html><body><h1>iBaax - 930٬000 SAR</h1>'
    '<p>المساحات تبدأ من 153 م وحتى 329 م2</p>'
    '<p>حي الرمال بمدينة الرياض مساحة الوحدة من الأرض 105.7 متر وتختص من المنافع والأجزاء المشتركة بمساحة 63.43 متر</p>'
    '<ul><li class="grid grid-cols-2"><div class="font-[600]">Street Width</div>'
    '<div class="font-[500] text-end" style="overflow-wrap: break-word;">0</div></li>'
    '<li class="grid grid-cols-2"><div class="font-[600]">Property Area</div>'
    '<div class="font-[500] text-end" style="overflow-wrap: break-word;">146.07</div></li>'
    '<li class="grid grid-cols-2"><div class="font-[600]">Property Facing</div>'
    '<div class="font-[500] text-end">North</div></li></ul></body></html>')


def test_ibaax_english_property_area_label_is_the_area():
    # ibaax 348 (alert 13854): «Property Area» / «146.07», we store 146; the Arabic prose's 105.7 / 153 scored it wrong.
    assert score({"area_m2": 146}, IBAAX_348)["area"] == MATCH


def test_ibaax_a_different_stored_area_still_scores_wrong():
    assert score({"area_m2": 150}, IBAAX_348)["area"] == MISMATCH
    assert score({"area_m2": 145}, IBAAX_348)["area"] == MISMATCH


# ── almajdiah: the unit rows are drawn by script after the first paint ───────────────────────────────────────────
MAJ_URL = "https://almajdiah.com/rentals/161?platform=web"
MAJ_SHELL = (
    '<html><body><div id="app" data-page="{&quot;rental_license&quot;:&quot;6201065960&quot;}">'
    '<p>في حي البساتين، حيث الاستقلال في العيش والخدمات المتنوعة. 12 مبنَى متجاورة.. كالبستان</p>'
    '<footer><ul><li>الرياض - حي القيروان - شمال طريق الملك سلمان</li></ul></footer></div></body></html>')
MAJ_DRAWN = MAJ_SHELL.replace(
    '<footer>',
    '<span class="text-base">المبنى : J</span><span class="text-base">الوحدة : 2</span><hr class="my-4">'
    '<p class="mb-2"><span>ترخيص الاعلان:</span><span class="text-gray-600 ms-1">6201065960</span></p>'
    '<div class="flex flex-col"><div class="flex justify-between"><span class="text-[14px] lg:text-[19px]">العارض</span>'
    '</div></div><footer>')


def test_almajdiah_page_without_its_unit_rows_says_nothing():
    # 161 / 183 / 160 (alert 13543): read before the rows were drawn, only the blurb and the head-office footer
    # carry a «حي», and the stored «حي العارض» scored MISMATCH. The licence sitting in the app payload is not a row.
    assert score({"district_ar": "حي العارض"}, MAJ_SHELL)["district"] == MISMATCH      # what the night scored
    assert page_lacks_its_ad(MAJ_URL, MAJ_SHELL) is True                              # so the page is not compared


def test_almajdiah_drawn_page_is_read_and_can_still_contradict_us():
    assert page_lacks_its_ad(MAJ_URL, MAJ_DRAWN) is False
    assert score({"district_ar": "حي العارض"}, MAJ_DRAWN)["district"] == MATCH
    assert score({"district_ar": "حي النرجس"}, MAJ_DRAWN)["district"] == MISMATCH


def test_the_unit_row_rule_is_almajdiah_rentals_only():
    assert page_lacks_its_ad("https://example.com/rentals/161", MAJ_SHELL) is False
    assert page_lacks_its_ad("https://almajdiah.com/projects/9", MAJ_SHELL) is False


# ── fursaghyr (Houzez): the ad's own place fields carry no keyword ───────────────────────────────────────────────
FURS_1199451 = (
    '<html><body><ul>'
    '<li><strong>السعر:</strong> <span> 684 SAR</span></li>'
    '<li class="streetWidth"><strong>عرض الشارع:</strong> <span>32.5</span></li>'
    '<li class="propertyArea"><strong>مساحة العقار:</strong> <span>2194.62</span></li>'
    '<li class="propertyPrice"><strong>سعر الوحدة / سعر المتر للأرض:</strong> <span>684</span></li>'
    '<li><strong>وصف موقع العقار حسب الصك :</strong> <span>حي حلة الاحوس فى مدينة الجموم</span></li></ul>'
    # the real page has ~9,000 characters of description and tables here, so the place fields fall outside text_head
    + '<p>' + 'الضمانات ومدتها لا يوجد ' * 120 + '</p>' +
    '<ul><li class="detail-address"><strong>العنوان</strong> '
    '<span>المملكة العربية السعودية, منطقة مكة المكرمة, الجموم - اللبه, اللبه</span></li>'
    '<li class="detail-city"><strong>المدينة</strong> <span>الجموم</span></li>'
    '<li class="detail-area"><strong>تسمية المنطقة</strong> <span>اللبه</span></li></ul></body></html>')
FURS = {"district_ar": "حي اللبه", "price_total": 1501120, "price_per_meter": 684, "area_m2": 2194}


def test_fursaghyr_district_is_the_pages_own_area_field():
    # 1199451 / 4367079 / 3237532 (alert 13974): stored district = «تسمية المنطقة»; only the deed line was read.
    assert score(FURS, FURS_1199451)["district"] == MATCH


def test_fursaghyr_a_district_the_page_does_not_name_still_scores_wrong():
    assert score({**FURS, "district_ar": "حي الشفا"}, FURS_1199451)["district"] == MISMATCH


def test_fursaghyr_total_is_the_pages_rate_times_the_pages_exact_area():
    # 684 × 2194.62 = 1,501,120.08: the site's total, never printed; the page prints the rate and the exact size.
    assert score(FURS, FURS_1199451)["price"] == MATCH


def test_fursaghyr_another_total_or_another_rate_still_scores_wrong():
    assert score({**FURS, "price_total": 1510000}, FURS_1199451)["price"] == MISMATCH
    assert score({**FURS, "price_total": 1500736}, FURS_1199451)["price"] == MISMATCH      # 684 × the integer 2194
    assert score({**FURS, "price_per_meter": 700, "price_total": 1536234}, FURS_1199451)["price"] == MISMATCH
