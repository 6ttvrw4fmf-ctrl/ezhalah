"""alshawaf: «سعر المتر 1,800» is a price per metre, and «المساحة» / «587م» is the area (🆕 2026-11-09).

The 05:35 score capped alshawaf at 85 %: 25868220 / 25868063 / 25868148 scored area MISMATCH with page=['متر 1,800'] although
we store exactly the node table's «المساحة» (587 / 275 / 362). Markup below is copied (trimmed) from alshawaf.com.sa/22429,
re-read run 42578333590 («around 587»). Two misreads: the area keyword «متر» took the per-metre price line as a stated
area, and the th/td value «587م» (glued «م», on its own line under the label) was never accepted as the figure.
"""
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
