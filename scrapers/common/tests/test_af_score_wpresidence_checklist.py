"""af_score: eastabha's WP Residence checklist — a ticked item is the statement, an ✗ item is silence.

CI source-reread 39020724177 / 39020878305 (2026-10-17): eastabha 595393 prints its whole feature taxonomy,
ticked items with `fa-check-circle`, unticked ones with `not_present` and `fa-times` («مصعد», «مطبخ مجهز»,
«حمام ساخن»). The score read the ✗ items and the description («مطبخ مستقل») as «the page says yes», so kitchen,
elevator and AC scored «we miss» 5 of 5 and 0 of 4 ads were findable, on ads whose ticked list (the scraper's
REST `property_features`: شُرفة ، بلكونة · كهرباء · ماء) names none of them. Our NULL is the source's answer.
"""
from scrapers.common import af_score as A
from scrapers.common.source_reread import page_evidence

# Verbatim from re-read 39020878305 (class slugs trimmed), plus the elevator item from 39020724177.
GRID = ('<div class="feature_chapter_name col-md-12">تفاصيل خارجية</div>'
        '<div class="listing_detail not_present col-md-4 d8add8afd98ad982d8a9"><i class="fas fa-times"></i>حديقة</div>'
        '<div class="listing_detail not_present col-md-4 d8add985d8a7d985-d8b3d8a7d8aed"><i class="fas fa-times"></i>حمام ساخن</div>'
        '<div class="listing_detail col-md-4 d8b4d98fd8b1d981d8a9-d88c-d8a8"><i class="far fa-check-circle"></i>شُرفة ، بلكونة</div>'
        '<div class="listing_detail not_present col-md-4 d985d8b5d8b9d8af"><i class="fas fa-times"></i>مصعد</div>'
        '<div class="listing_detail not_present col-md-4 d985d8b7d8a8d8ae"><i class="fas fa-times"></i>مطبخ مجهز</div>')
PROSE = '<p>4 غرف واسعة</p><p>مطبخ مستقل</p>'


def _page(body):
    page = page_evidence(body)
    return {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": A.wpresidence_props(body)}]}


def test_only_ticked_items_are_statements():
    assert A.wpresidence_props(GRID) == [{"name": "شُرفة ، بلكونة", "value": "نعم"}]


def test_an_unticked_item_is_not_a_page_line():
    lines = page_evidence(GRID)["text_head"]
    assert "مصعد" not in lines and "مطبخ مجهز" not in lines and "شُرفة" in lines


def test_eastabha_prose_and_crossed_items_never_score_a_miss():
    page = _page(GRID + PROSE)
    results = {"kitchen": A.WE_MISS, "elevator": A.WE_MISS}
    out = A.structured_only("eastabha", results, {"kitchen": None, "elevator": None}, page)
    assert out == {"kitchen": A.PAGE_SILENT, "elevator": A.PAGE_SILENT}


def test_a_ticked_kitchen_still_counts_and_a_missing_value_is_still_a_miss():
    ticked = GRID.replace('not_present col-md-4 d985d8b7d8a8d8ae"><i class="fas fa-times">',
                          'col-md-4 d985d8b7d8a8d8ae"><i class="far fa-check-circle">')
    out = A.structured_only("eastabha", {"kitchen": A.WE_MISS}, {"kitchen": None}, _page(ticked))
    assert out["kitchen"] == A.WE_MISS
    out = A.structured_only("eastabha", {"kitchen": A.WE_MISS}, {"kitchen": True}, _page(ticked))
    assert out["kitchen"] == A.MATCH


def test_mutation_reading_crossed_items_would_be_caught():
    # The old reading: every checklist label, ticked or not, is a «yes».
    crossed_as_yes = [{"name": n, "value": "نعم"} for _, n in A._WPR_ITEM.findall(GRID)]
    page = {"jsonld": [{"additionalProperty": crossed_as_yes}]}
    out = A.structured_only("eastabha", {"elevator": A.WE_MISS}, {"elevator": None}, page)
    assert out["elevator"] == A.WE_MISS          # what the fix prevents
    assert A.structured_only("eastabha", {"elevator": A.WE_MISS}, {"elevator": None},
                             _page(GRID))["elevator"] == A.PAGE_SILENT
