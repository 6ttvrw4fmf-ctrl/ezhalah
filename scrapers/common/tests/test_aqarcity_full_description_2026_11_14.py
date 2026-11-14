"""aqarcity: the JSON-LD description is a cut copy; the page's description box is the whole ad (🔬 2026-11-14).

278 of 2,058 active aqarcity ads stored a description ending «…»: the JSON-LD copy stops near 800 characters, usually
on the ad's feature list. /property/29874 (aqarcity 2292946) stored «… حوش واسع بمساحة 14 × 15 متر. حديقة وأشج…»
while the page shows «✨ المميزات ✔️ مصعد إيطالي من شركة بلتك ✔️ عدد 18 مكيف Gree», so the af-score customer
search for «elevator + kitchen» never found it (night 11-13). The fixture is the live page's description box re-read
on 2026-11-14 (net.http_get, HTTP 200), verbatim except the agency name.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

TD = Path(__file__).resolve().parents[2] / "aqarcity" / "testdata"
BOX = (TD / "aqarcity_description_body_2026_11_14.excerpt.html").read_text(encoding="utf-8")
DL = (TD / "aqarcity_dl_layout_2026_10.excerpt.html").read_text(encoding="utf-8")
# the JSON-LD copy as stored on 2026-11-13 (the cut ending kept)
CUT = ("فيلا فاخرة للبيع الدمام. حي الشعلة (الفاخرية 2) رقم الفيلا 6781. موقع مميز قريب من جميع الخدمات، أمام مجمع "
       "خدمات الحي والمسجد، وبالقرب من مستشفى المغربي. مساحة الأرض: 510 م². زاوية على شارعين. الحوش الخارجي. حوش واسع "
       "بمساحة 14 × 15 متر. حديقة وأشج…")


def _body(desc: str, box: str = BOX) -> str:
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing", "url": "https://www.aqarcity.net/property/29874",
          "name": "فيلا للبيع في الدمام حي الشعلة", "description": desc,
          "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 3500000, "availability": "https://schema.org/InStock"},
          "address": {"@type": "PostalAddress", "addressLocality": "الدمام", "addressRegion": "المنطقة الشرقية"}}
    return f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>' + DL + box


def test_a_cut_copy_is_replaced_by_the_page_box():
    full = R.full_description(_body(CUT), CUT)
    assert "مصعد إيطالي من شركة بلتك" in full and "عدد 18 مكيف Gree" in full
    assert full.split("\n")[0] == "🏡 فيلا فاخرة للبيع – الدمام"          # one line per source line


def test_the_contact_line_and_everything_after_it_is_dropped():
    full = R.full_description(_body(CUT), CUT)
    assert "للتواصل" not in full and "AGENCY_NAME_REMOVED" not in full
    assert full.endswith("✔️ خصوصية عالية وتصميم عملي للعائلة")


def test_a_complete_copy_is_kept_as_is():
    whole = "شقة للإيجار مكونة من 3 غرف ومطبخ راكب ومصعد"
    assert R.full_description(_body(whole), whole) == whole


def test_no_box_keeps_the_cut_copy():
    assert R.full_description(_body(CUT, box=""), CUT) == CUT


def test_the_mapped_row_reads_the_feature_list():
    row, why = R.map_listing(_body(CUT), "https://www.aqarcity.net/property/29874")
    assert row, why
    assert row["elevator"] is True and row["air_conditioner"] is True and row["kitchen"] is True
    assert "للتواصل" not in row["description"]


# PDPL: aqarcity 20504187 (re-read 2026-11-14) prints the phone in split spans; digits replaced, markup verbatim
_PHONE_BOX = ('<div class="description-body x"><p>• 3 غرف نوم.<br />• مطبخ.</p><p>جوال '
              '<span class="desc-phone" dir="ltr"><span>05</span><span>00</span><span>00</span><span>00</span><span>00</span></span>'
              ' متاح للمعاينة</p></div>')


def test_a_split_phone_never_reaches_the_description():
    full = R.full_description(_PHONE_BOX, "• 3 غرف نوم…")
    assert "05" not in full and "00 00" not in full
    assert "متاح للمعاينة" in full and "مطبخ" in full
