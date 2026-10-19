"""af_score: a rakez page is its PROJECT's page, so its warranty block and its unit-trait list are not this unit's ad.

CI re-read 39228336072 (2026-10-19, projects 15002 and 65739): every rakez «miss» of the 08:00 score asked
air_conditioner from the warranty heading «التكييف» (under «5 سنوات»), and 3 of 5 also asked maid_room from the
project's shared feature list, which is never stored per unit (backlog 467).
"""
from scrapers.common import af_score as A

# The warranty block exactly as the re-read printed it (classes trimmed to the shape that matters).
BODY = ('<div class="brxe-rbassd brxe-div"><span class="brxe-tsxkrh brxe-text-basic">20</span>'
        '<span class="brxe-hqqgvn brxe-text-basic">سنوات</span></div><h3 class="brxe-bdqkvq brxe-heading">المصاعد</h3>'
        '</div><div class="brxe-jvvwus brxe-block"><div class="brxe-rbassd brxe-div">'
        '<span class="brxe-tsxkrh brxe-text-basic">05</span><span class="brxe-hqqgvn brxe-text-basic">سنوات</span>'
        '</div><h3 class="brxe-bdqkvq brxe-heading">التكييف</h3></div>')
PAGE = {"evidence_lines": ["450,000 ريال 2", "التكييف", "المصاعد", "تكييف مخفي"], "text_head": "التكييف | 20 | سنوات"}


def test_warranty_headings_are_not_evidence():
    out = A.strip_warranty(PAGE, BODY)
    assert "التكييف" not in out["evidence_lines"] and "المصاعد" not in out["evidence_lines"]
    assert "التكييف" not in out["text_head"].split(" | ")
    # a feature term that merely contains the word is the project's spec, and stays
    assert "تكييف مخفي" in out["evidence_lines"]


def test_without_warranty_markup_nothing_is_dropped():
    assert A.strip_warranty(PAGE, "<h3>التكييف</h3>") == PAGE


def test_a_common_area_term_is_not_the_units_ac():
    # 11750314 (branch dry run 39231712736): the spec's «ممرات مكيفة» asked air_conditioner
    page = {"evidence_lines": ["ممرات مكيفة", "تكييف مخفي"], "text_head": "ممرات مكيفة"}
    out = A.strip_warranty(page, "")
    assert out["evidence_lines"] == ["تكييف مخفي"] and out["text_head"] == ""
    assert A.page_says_yes(["ممرات مكيفة"], "air_conditioner")   # what the score read before


def test_the_warranty_heading_alone_never_builds_an_ac_request():
    lines = A.strip_warranty(PAGE, BODY)["evidence_lines"]
    assert not A.page_says_yes([x for x in lines if x != "تكييف مخفي"], "air_conditioner")
    # mutation: the unstripped page DID ask air_conditioner (the 10-19 misses)
    assert A.page_says_yes(["التكييف"], "air_conditioner")


def test_rakez_unit_traits_are_silent_and_building_traits_still_scored():
    results = {"maid_room": A.WE_MISS, "parking": A.WE_MISS, "elevator": A.WE_MISS, "air_conditioner": A.MATCH}
    out = A.structured_only("rakez", results, {"maid_room": None, "elevator": None}, {"jsonld": []})
    assert out["maid_room"] == A.PAGE_SILENT and out["parking"] == A.PAGE_SILENT
    assert out["elevator"] == A.WE_MISS and out["air_conditioner"] == A.MATCH


def test_another_site_keeps_its_unit_traits():
    out = A.structured_only("sakan", {"maid_room": A.WE_MISS}, {"maid_room": None}, {"jsonld": []})
    assert out["maid_room"] == A.WE_MISS


def test_a_heading_glued_to_the_next_value_is_still_the_heading():
    # 11748121 / 11748137: «2 سنوات · مكينة مصعد» reached the evidence as «مكينة مصعد 10»
    body = ('<span class="a">2</span><span class="b">سنوات</span></div><h3 class="c">مكينة مصعد</h3>')
    page = {"evidence_lines": ["مكينة مصعد 10", "مصاعد"], "text_head": "مكينة مصعد 10"}
    out = A.strip_warranty(page, body)
    assert out["evidence_lines"] == ["مصاعد"] and out["text_head"] == ""
