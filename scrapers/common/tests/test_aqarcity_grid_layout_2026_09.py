"""aqarcity 2026-09 redesign: the «pi-item» detail table became a card grid and PI_RE matched nothing, so
1,800 of 1,800 live rows were stored as type «unknown» («غير معروف» on every card) with no area, age,
facade or street width. The grid is read now; the officer's name and phone it prints are never read.

Fixture: the live grid of /property/27913 (2026-09-28), officer name and phone replaced with placeholders.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

GRID = (Path(__file__).resolve().parents[2] / "aqarcity" / "testdata"
        / "aqarcity_grid_layout_2026_09.excerpt.html").read_text()
LD = {"@context": "https://schema.org", "@type": "RealEstateListing",
      "url": "https://www.aqarcity.net/property/27913", "name": "فيلا للبيع في الدمام حي ضاحية الملك فهد",
      "description": "فيلا فاخرة للبيع. للتواصل: 0500000000",
      "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 1120000,
                 "availability": "https://schema.org/InStock"},
      "address": {"@type": "PostalAddress", "addressLocality": "الدمام", "addressRegion": "المنطقة الشرقية"}}
BODY = f'<script type="application/ld+json">{json.dumps(LD, ensure_ascii=False)}</script>' + GRID


def test_the_grid_is_read_under_the_names_the_scraper_uses():
    pi = R._pi_table(GRID)
    assert pi["التصنيف"] == "فيلا"                      # «نوع العقار» in the grid
    assert pi["مساحة العقار"] == "250 م²" and pi["عرض الشارع"] == "18 م" and pi["عمر العقار"] == "جديد"
    assert pi["تاريخ انتهاء ترخيص الإعلان"] == "27/11/2026"
    assert pi["وصف موقع العقار حسب الصك"].startswith("حي/السابع")   # folded into the label cell


def test_the_officer_name_and_phone_are_never_read():
    pi = R._pi_table(GRID)
    assert not any("مسؤول" in k for k in pi)
    assert "اسم المسؤول" not in json.dumps(pi, ensure_ascii=False)


def test_a_grid_page_maps_to_its_real_type_and_facts():
    row, cat = R.map_listing(BODY, "https://www.aqarcity.net/property/27913")
    assert row is not None and cat == "residential"
    assert row["property_type"] == "Villa"             # was «unknown» for every live row
    assert row["area_m2"] == 250 and row["property_age"] == 0 and row["street_width_m"] == 18
    # the grid's «رقم ترخيص الإعلان» reaches additional_info, where the index reads it; the aqarcity
    # tables have NO license_number column (run 36404400023 died on PGRST204 writing one)
    assert row["additional_info"]["rega_ad_license_number"] == 7200776150
    assert "license_number" not in row
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "اسم المسؤول" not in blob and "0500000000" not in blob
