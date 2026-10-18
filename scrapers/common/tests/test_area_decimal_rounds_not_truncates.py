"""A decimal m² is stored and scored as its nearest whole metre (🆕 2026-10-17, tuba 18258569 «232.8 م²»).

area_m2 is an integer column (backlog #123). tuba truncated 232.8 → 232; the score read the page's decimal
as a contradiction of every whole number and capped the night on tuba's single sampled ad.
"""
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing
from scrapers.tuba.run import _area


def _page(*lines):
    return {"title": "", "meta": {}, "jsonld": [], "evidence_lines": list(lines), "text_head": ""}


def test_tuba_rounds_the_source_area():
    assert _area("232.8") == 233
    assert _area(232.4) == 232
    assert _area("630") == 630
    assert _area("0") is None and _area("") is None and _area(None) is None


def test_score_accepts_the_nearest_whole_metre_only():
    p = _page("المساحة:", "232.8 م²")
    assert compare_listing({"area_m2": 233}, p)["area"] == MATCH
    assert compare_listing({"area_m2": 232}, p)["area"] == MATCH          # the integer prefix (pre-existing)
    assert compare_listing({"area_m2": 240}, p)["area"] == MISMATCH
