"""aqarcity 2026-10 redesign: the 2026-09 card grid became a definition list («<dt>LABEL</dt><dd>VALUE</dd>»)
and neither earlier regex matched, so all 1,813 live rows were again stored as type «unknown» («غير معروف»
on every card) and new ads lost their area. The list is read now; the officer's name and phone it prints are
never read.

Fixture: the live details list of /property/27257 (2026-10-03, «عمارة للبيع في ابها الضباب | 570 م²»),
officer name and phone replaced with placeholders.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

DL = (Path(__file__).resolve().parents[2] / "aqarcity" / "testdata"
      / "aqarcity_dl_layout_2026_10.excerpt.html").read_text()
LD = {"@context": "https://schema.org", "@type": "RealEstateListing",
      "url": "https://www.aqarcity.net/property/27257", "name": "عمارة للبيع في ابها الضباب",
      "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 7000000,
                 "availability": "https://schema.org/InStock"},
      "address": {"@type": "PostalAddress", "addressLocality": "ابها", "addressRegion": "منطقة عسير"}}
BODY = f'<script type="application/ld+json">{json.dumps(LD, ensure_ascii=False)}</script>' + DL


def test_the_list_is_read_under_the_names_the_scraper_uses():
    pi = R._pi_table(DL)
    assert pi["التصنيف"] == "عمارة"                     # «نوع العقار», not swallowed by the location row
    assert pi["مساحة العقار"] == "570 م²" and pi["عرض الشارع"] == "15 م"
    assert pi["رقم ترخيص الإعلان"] == "7200703708"      # «رقم الترخيص»
    assert pi["تاريخ انتهاء ترخيص الإعلان"] == "05/10/2026"   # «ساري حتى»
    assert pi["وصف موقع العقار حسب الصك"].startswith("حي")    # the deed text, not «وجود قيد»'s «لا»


def test_the_officer_name_and_phone_are_never_read():
    pi = R._pi_table(DL)
    assert not any("مسؤول" in k for k in pi)
    assert "اسم المسؤول" not in json.dumps(pi, ensure_ascii=False)


def test_a_list_page_maps_to_its_real_type_and_facts():
    row, cat = R.map_listing(BODY, "https://www.aqarcity.net/property/27257")
    assert row is not None and cat == "residential"
    assert row["property_type"] == "Building"          # was «unknown» for every live row
    assert row["area_m2"] == 570 and row["street_width_m"] == 15
    assert row["additional_info"]["rega_ad_license_number"] == 7200703708
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "اسم المسؤول" not in blob and "0500000000" not in blob
