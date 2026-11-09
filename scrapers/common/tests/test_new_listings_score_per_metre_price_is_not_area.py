"""alshawaf: «سعر المتر 1,800» is a price per metre, and «المساحة» / «587م» is the area (🆕 2026-11-09).

The 05:35 score capped alshawaf at 85 %: 25868220 / 25868063 / 25868148 scored area MISMATCH with page=['متر 1,800'] although
we store exactly the node table's «المساحة» (587 / 275 / 362). Markup below is copied (trimmed) from alshawaf.com.sa/22429,
re-read run 42578333590 («around 587»). Two misreads: the area keyword «متر» took the per-metre price line as a stated
area, and the th/td value «587م» (glued «م», on its own line under the label) was never accepted as the figure.
"""
import pytest

from scrapers.common import new_listings_score as S

URL = "https://alshawaf.com.sa/22429"
NODE = ('<div id="block-edux-views-block-duplicate-of-node-block-1"><table>'
        '<tr>\n<th>العقار</th>\n<td>\nأرض\nسكنية\nللبيع\n</td>\n</tr>\n'
        '<tr>\n<th>الحي</th>\n<td>\nالمباركية 1\nرقم\n350\n\n</td>\n</tr>\n'
        '<tr>\n<th>المساحة</th>\n<td>\n587م\n</td>\n</tr>\n\n'
        '<tr>\n<th>شارع عرض</th>\n<td>\n15م\n</td>\n</tr>\n'
        '<tr>\n<th>الواجهة والإتجاه</th>\n<td>\nشرق \n</td>\n</tr>\n'
        '<tr>\n<th>سعر المتر</th>\n<td>\n1,800\n\n</td>\n</tr>\n</table></div>')
RELATED = ('<div class="views-element-container block" id="block-edux-views-block-duplicate-of-frontpage-block-1"><table>'
           '<tr><td>المساحة\n422.22م<br>المتر 1,500</td></tr></table></div>')


def _area(stored, body=NODE + RELATED):
    page = S.page_evidence(S.scope_to_its_ad(URL, body))
    return S.compare_listing({"area_m2": stored}, page)["area"]


def test_the_node_area_matches():
    assert _area(587) == S.MATCH


def test_another_area_is_a_mismatch():
    assert _area(600) == S.MISMATCH


def test_the_index_per_metre_line_is_not_an_area_either():
    # the /table index prints «المتر 1,800» (no «سعر»): still a price, never a stated area
    assert _area(587, '<div>المتر 1,800</div>') == S.PAGE_SILENT


def test_a_price_line_alone_states_no_area():
    body = '<table><tr><th>سعر المتر</th><td>1,800</td></tr></table>'
    assert _area(587, body) == S.PAGE_SILENT


def test_a_glued_value_away_from_the_label_still_means_nothing():
    # the related table's «422.22م» is never this ad's area, cut or not
    body = '<table><tr><td>للبيع</td></tr><tr><td>422م</td></tr></table>'
    assert _area(422, body) != S.MATCH


def test_a_spaced_area_with_metre_word_still_matches():
    body = '<div>المساحة 587 متر</div>'
    assert _area(587, body) == S.MATCH


@pytest.mark.parametrize("price_line", [
    "سعر المتر 587", "سعر متر 587", "المتر: 587",
    "المتر：٥٨٧", "المتر ٥٨٧",
])
@pytest.mark.parametrize("stored", [None, 600, 587])
def test_per_metre_price_never_claims_area_even_when_the_number_matches(price_line, stored):
    assert _area(stored, f"<div>{price_line}</div>") == S.PAGE_SILENT


@pytest.mark.parametrize("label", [
    "المساحة", "مساحة", "مساحة الأرض", "المساحة العقار", "المساحة الارض",
])
def test_glued_value_under_a_bare_area_label_states_area_even_if_we_miss_it(label):
    body = f"<table><tr><th>{label}</th><td>587م</td></tr></table>"
    assert _area(587, body) == S.MATCH
    assert _area(600, body) == S.MISMATCH
    assert _area(None, body) == S.WE_MISS


@pytest.mark.parametrize("value, stored", [
    ("٥٨٧م", 587), ("1,250م", 1250), ("587.5م", 587.5), ("  587 م  ", 587),
])
def test_labelled_area_supports_digits_separators_and_spacing(value, stored):
    body = f"<div>المساحة<br>{value}</div>"
    assert _area(stored, body) == S.MATCH
    assert _area(None, body) == S.WE_MISS


@pytest.mark.parametrize("stored", [58, 87, 1587, 5870])
def test_glued_area_requires_the_whole_number(stored):
    assert _area(stored, "<div>المساحة<br>587م</div>") == S.MISMATCH


@pytest.mark.parametrize("lines", [
    ["587م", "المساحة"],
    ["المساحة", "شارع عرض", "587م"],
    ["المساحة التقريبية", "587م"],
    ["المساحة", "587م شارع"],
    ["المساحة"],
])
def test_glued_value_requires_a_bare_label_and_its_immediate_value_line(lines):
    # Isolate the scorer's line rules from the reader's separate label/value synthesis.
    page = {"evidence_lines": lines}
    assert S.compare_listing({"area_m2": 587}, page)["area"] == S.PAGE_SILENT
    assert S.compare_listing({"area_m2": None}, page)["area"] == S.PAGE_SILENT


@pytest.mark.parametrize("area_line", ["المساحة 587 متر", "587 م²", "587 م2"])
def test_area_evidence_on_a_line_with_per_metre_price_is_preserved(area_line):
    body = f"<div>{area_line}، سعر المتر 1800</div>"
    assert _area(587, body) == S.MATCH
    assert _area(None, body) == S.WE_MISS


def test_per_metre_price_does_not_hide_a_conflicting_labelled_area():
    body = "<div>المساحة<br>600م<br>المتر 587</div>"
    assert _area(587, body) == S.MISMATCH
    assert _area(600, body) == S.MATCH


def test_missing_stored_area_is_detected_in_the_real_node_markup():
    assert _area(None) == S.WE_MISS


def test_related_glued_area_cannot_supply_a_missing_node_area():
    body = NODE.replace("587م", "غير محددة") + RELATED
    assert _area(None, body) == S.PAGE_SILENT
