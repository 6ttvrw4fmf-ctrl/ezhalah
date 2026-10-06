"""aqarcity: the Advanced Filter amenities come from the ad's own description (🔬 AF engineer, 2026-10-06).

1,729 production listings stored 0 kitchen / elevator / parking / AC answers while the ads list them
line by line («3 غرف نوم. مطبخ. 4 دورات مياه. مستودع. … مدخل سيارة.», /property/30751). aqarcity's
details list has NO amenity field — only «خدمات العقار» (utilities) — so the description is the source,
read with the shared four-outcome matcher: named → True, negated → False, silent → absent (NULL).
Utilities stay structured-only: prose never overrides «خدمات العقار».
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

DL = (Path(__file__).resolve().parents[2] / "aqarcity" / "testdata"
      / "aqarcity_dl_layout_2026_10.excerpt.html").read_text()


def _body(description: str, services: str = "كهرباء,مياه,صرف صحي,هاتف,ألياف ضوئية") -> str:
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing",
          "url": "https://www.aqarcity.net/property/30751", "name": "شقة للبيع في أبها حي الزهور",
          "description": description,
          "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 650000,
                     "availability": "https://schema.org/InStock"},
          "address": {"@type": "PostalAddress", "addressLocality": "ابها", "addressRegion": "منطقة عسير"}}
    dl = DL.replace("كهرباء,مياه,صرف صحي,هاتف,ألياف ضوئية", services)
    return f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>' + dl


# The live ad's description, verbatim (2026-10-06; no name or phone in it).
LIVE = ("تفاصيل الشقة. ابها حي الزهور. السعر 650،000. مجلس رجال. مقلط. صالة. مجلس نساء. 3 غرف نوم. "
        "مطبخ. 4 دورات مياه. مستودع. المساحة 232م. السعر 650،000. مدخل سيارة.")


def test_the_amenities_the_ad_lists_are_stored_true():
    row, _ = R.map_listing(_body(LIVE), "https://www.aqarcity.net/property/30751")
    assert row["kitchen"] is True
    assert row["car_entrance"] is True


def test_silence_stays_unknown_never_no():
    row, _ = R.map_listing(_body(LIVE), "https://www.aqarcity.net/property/30751")
    for col in ("elevator", "parking", "air_conditioner", "maid_room", "driver_room"):
        assert row.get(col) is None, col


def test_a_stated_absence_is_a_no():
    row, _ = R.map_listing(_body("شقة للإيجار. بدون مصعد. مطبخ راكب."), "https://www.aqarcity.net/property/30751")
    assert row["elevator"] is False
    assert row["kitchen"] is True


def test_prose_never_decides_a_utility():
    row, _ = R.map_listing(_body("ألياف بصرية متوفرة. مطبخ.", services="كهرباء"),
                           "https://www.aqarcity.net/property/30751")
    assert row.get("optical_fibers") is not True    # utilities come from خدمات العقار only
