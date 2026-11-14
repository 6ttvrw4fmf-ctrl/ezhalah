"""ramzalqasim prints the ad's own fields in an ICON spec box (no label word: the icon is the label), and the
seller's prose beside it says other numbers. Read 2026-11-14 from https://ramzalqasim.com/x/118 (card parity
alerts 14642 / 14643 on 615847): box «715 م» · bathtub «5» · «(4) ماستر» · «(0) نوم»; prose «المساحة: 710م²»,
«ثلاث غرف نوم … غرفتين نوم». We store the box (715 / 4 / 5). The independent reader must give the score the box
with its labels, or every such ad reads «mismatch» on three fields. Markup below is the page's own, trimmed to the
box and the prose lines (svg paths cut after their first segments)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import source_reread as R  # noqa: E402
from scrapers.common.new_listings_score import compare_listing  # noqa: E402

_LI = ('<li class="flex items-center gap-2"> <svg class="w-6 h-6 text-green-500" viewBox="0 0 24 24" fill="currentColor">'
       '<path d="{d}"/></svg> {v} </li>')


def _page(items, prose=("📐 المساحة: 710م²", "ثلاث غرف نوم بدورة مياة مشتركه + مطبخ + غرفتين نوم بدورة مياه مشتركة")):
    box = "".join(_LI.format(d=d, v=v) for d, v in items)
    return (f'<html><head><title>ramzalqasim</title></head><body><ul class="flex flex-wrap gap-4 text-lg">{box}</ul>'
            + "".join(f"<p>{x}</p>" for x in prose) + "</body></html>")


X118 = [("M16,9h5a1,1,0,0,0,1-1", "715 م"), ("M8,5A1,1,0,1,0,9,6", "30 م"), ("M12,2A10,10,0,1,0,22", "متعدد"),
        ("M22 12H5V6.41a1.975", "5"), ("M20,3.5H4a3,3,0,0,0", "(4) ماستر"), ("M7,12.5a3,3,0,1,0", "(0) نوم")]
STORED = {"platform": "ramzalqasim", "area_m2": 715, "bedrooms": 4, "bathrooms": 5}


def test_the_box_reaches_the_reader_with_its_labels():
    assert R._icon_spec_lines(_page(X118)) == ["مساحة العقار 715 م²", "دورات المياه 5", "غرف النوم 4"]


def test_the_score_reads_our_structured_values_as_the_page_s_own():
    r = compare_listing(STORED, R.page_evidence(_page(X118)))
    assert (r["area"], r["bedrooms"], r["bathrooms"]) == ("match", "match", "match")


def test_a_different_box_still_reads_as_a_mismatch():
    wrong = dict(STORED, area_m2=900, bedrooms=7, bathrooms=9)
    r = compare_listing(wrong, R.page_evidence(_page(X118)))
    assert (r["area"], r["bedrooms"], r["bathrooms"]) == ("mismatch", "mismatch", "mismatch")


def test_an_unset_zero_and_an_unknown_icon_say_nothing():
    land = [("M16,9h5a1,1,0,0,0,1-1", "500 م"), ("M22 12H5V6.41a1.975", "0"), ("Mzz unknown icon", "7"),
            ("M20,3.5H4a3,3,0,0,0", "(0) ماستر"), ("M7,12.5a3,3,0,1,0", "(0) نوم")]
    assert R._icon_spec_lines(_page(land)) == ["مساحة العقار 500 م²"]
    assert R._icon_spec_lines("<p>no box here 715 م</p>") == []
