"""new_listings_score: ashab's «عقارات مشابهة» block is other ads (🆕, 2026-10-30, backlog 934).

ashab 21679061 (/properties/502497): the ad's own header badge says «بيع» and we store بيع, but the sibling cards
under «عقارات مشابهة» carry «إيجار» badges, so the scorer read a rent claim and scored the deal MISMATCH
(score run 41009231494, re-read runs 41088522215 / 41088846088).
"""
import pytest

from scrapers.common import new_listings_score as S

URL = "https://ashab.sa/properties/502497"
BODY = ('<section id="page-title"><span class="badge">بيع</span><span class="badge">متاح</span>'
        '<h4>دور علوي</h4><span>الحد 20000 ر.س</span></section>'
        '<section id="similar-properties"><h3>عقارات مشابهة</h3>'
        '<div class="card"><span class="badge">إيجار</span> شقة للايجار الحد 15000 ر.س</div></section>'
        '<footer>بيع<br>ايجار<br>استثمار</footer>')


def _deal(body):
    page = S.page_evidence(S.scope_to_its_ad(URL, body))
    return S.compare_listing({"deal_ar": "بيع"}, page)["deal"]


def test_sibling_cards_are_not_the_ads_deal():
    assert _deal(BODY) != S.MISMATCH
    assert "إيجار" not in S.scope_to_its_ad(URL, BODY)


def test_the_cut_is_what_made_it_pass():
    # mutation: without the cut the sibling «إيجار» is read as the ad's deal
    assert S.compare_listing({"deal_ar": "بيع"}, S.page_evidence(BODY))["deal"] == S.MISMATCH


def test_other_sites_are_untouched():
    assert S.scope_to_its_ad("https://aqar.fm/ad/1", BODY) == BODY


def test_a_real_rent_on_the_ad_itself_still_mismatches_a_stored_sale():
    own_rent = BODY.replace("<h4>دور علوي</h4>", "<h4>دور علوي للايجار</h4>")
    assert _deal(own_rent) == S.MISMATCH


# alshawaf 21664551 (2026-10-30): the node's own table says «المساحة 250م»; the related-listings table under it
# (`…duplicate-of-frontpage-block-1`) prints other plots' areas, which scored our 250 a MISMATCH.
ALSHAWAF_URL = "https://alshawaf.com.sa/22376"
ALSHAWAF = ('<div id="block-edux-views-block-view-duplicate-of-node-block-1"><table>'
            '<tr><th>العقار</th><td>\nنص أرض\nسكنية\nللبيع\n</td></tr>'
            '<tr><th>المساحة</th><td>\n250م\n</td></tr></table></div>'
            '<div id="block-edux-views-block-view-duplicate-of-frontpage-block-1"><table>'
            '<tr><td>المساحة\n422.22م<br>شارع\n15</td></tr>'
            '<tr><td>المساحة\n600م</td></tr></table></div>')


def _area(body):
    return S.compare_listing({"area_m2": 250}, S.page_evidence(body))["area"]


def test_alshawaf_related_table_is_not_the_ads_area():
    scoped = S.scope_to_its_ad(ALSHAWAF_URL, ALSHAWAF)
    assert "422.22" not in scoped and "250م" in scoped
    assert _area(scoped) != S.MISMATCH


def test_alshawaf_without_the_cut_misreads_the_area():
    assert _area(ALSHAWAF) == S.MISMATCH


# alshawaf 22426 (2026-11-08, backlog 1357): the related table under the node carried no «frontpage-block» id, so
# its cell «المساحة 500م» survived and scored our 375 a MISMATCH. A related row is a Views listing row
# (`headers="view-changed-table-column"`); the node's own th/td table never carries it.
URL_22426 = "https://alshawaf.com.sa/22426"
NODE_22426 = ('<div id="block-edux-views-block-duplicate-of-node-block-1"><table>'
              '<tr><th>الحي</th><td>المحدود</td></tr><tr><th>المساحة</th>\n<td>\n375م\n</td></tr></table></div>')
RELATED_22426 = ('<div class="view"><table><tr><td headers="view-changed-table-column"><a href="/22000">أرض</a></td>'
                 '<td headers="view-nothing-3-table-column" class="views-field views-field-nothing-3">'
                 'المساحة 500م<br></td></tr></table></div>')


def _area_375(body):
    return S.compare_listing({"area_m2": 375}, S.page_evidence(body))["area"]


def test_alshawaf_related_listing_rows_are_cut_without_a_block_id():
    page = NODE_22426 + RELATED_22426
    scoped = S.scope_to_its_ad(URL_22426, page)
    assert "500" not in scoped and "375م" in scoped and 'headers="' not in scoped
    assert _area_375(scoped) != S.MISMATCH
    assert _area_375(page) == S.MISMATCH          # the uncut page really does misread it


def test_alshawaf_a_listing_row_before_the_node_never_cuts_the_ad():
    # A stop is honoured only after the node block starts, so a header row above it cannot cut the ad away.
    scoped = S.scope_to_its_ad(URL_22426, RELATED_22426 + NODE_22426)
    assert "375م" in scoped


@pytest.mark.parametrize("related_tag", [
    '<div id="block-edux-views-block-duplicate-of-frontpage-block-1">',
    '<td headers="view-changed-table-column">',
    '<td class="views-field" headers="view-changed-table-column" data-title="أرض">',
])
def test_alshawaf_cut_starts_at_the_related_tag_boundary(related_tag):
    prefix = NODE_22426 + '<div class="view"><table><tr>\n'
    page = prefix + related_tag + 'المساحة 500م</td></tr></table></div>'
    assert S.drop_similar_block(URL_22426, page) == prefix


@pytest.mark.parametrize("early_related", [
    RELATED_22426,
    '<div id="duplicate-of-frontpage-block-1">المساحة 900م</div>',
])
@pytest.mark.parametrize("late_related", [
    RELATED_22426,
    '<div id="duplicate-of-frontpage-block-1">المساحة 500م</div>',
])
def test_alshawaf_ignores_early_stops_but_still_cuts_later_ones(early_related, late_related):
    prefix = early_related + NODE_22426
    expected = prefix + ('<div class="view"><table><tr>' if late_related == RELATED_22426 else '')
    assert S.drop_similar_block(URL_22426, prefix + late_related) == expected


@pytest.mark.parametrize("related", [
    RELATED_22426 + '<div id="duplicate-of-frontpage-block-1">later</div>',
    '<div id="duplicate-of-frontpage-block-1">first</div>' + RELATED_22426,
])
def test_alshawaf_uses_the_first_stop_in_document_order(related):
    expected = NODE_22426 + ('<div class="view"><table><tr>' if related.startswith(RELATED_22426) else '')
    assert S.drop_similar_block(URL_22426, NODE_22426 + related) == expected


@pytest.mark.parametrize("body", ['', NODE_22426, RELATED_22426 + NODE_22426])
def test_alshawaf_without_a_stop_after_the_node_is_unchanged(body):
    assert S.drop_similar_block(URL_22426, body) == body


@pytest.mark.parametrize("url", [None, '', 'https://example.com/22426'])
def test_alshawaf_markers_do_not_scope_unrelated_or_missing_urls(url):
    page = NODE_22426 + RELATED_22426
    assert S.drop_similar_block(url, page) == page


def test_alshawaf_without_a_node_marker_still_drops_related_rows():
    # Preserve the existing fallback for pages whose node wrapper is absent.
    own_facts = '<table><tr><th>المساحة</th><td>375م</td></tr></table>'
    assert S.drop_similar_block(URL_22426, own_facts + RELATED_22426) == own_facts + '<div class="view"><table><tr>'


@pytest.mark.parametrize("area, verdict", [(375, S.MATCH), (450, S.MISMATCH)])
def test_alshawaf_cut_preserves_the_ads_explicit_area_verdict(area, verdict):
    # A labelled sentence is independently judgeable by the scorer.
    own_ad = NODE_22426 + f'<p>المساحة {area}م</p>'
    scoped = S.scope_to_its_ad(URL_22426, own_ad + RELATED_22426)
    assert f'المساحة {area}م' in scoped
    assert '500م' not in scoped
    assert _area_375(scoped) == verdict


@pytest.mark.parametrize("related", [
    '<section id="similar-properties"><span>إيجار</span></section>',
    '<section><h3>عقارات مشابهة</h3><span>إيجار</span></section>',
])
def test_ashab_cut_preserves_the_complete_preceding_ad(related):
    own_ad = '<section><h4>دور للبيع</h4></section>\n'
    expected = own_ad + ('<section>' if related.startswith('<section><h3>') else '')
    assert S.drop_similar_block(URL, own_ad + related) == expected
