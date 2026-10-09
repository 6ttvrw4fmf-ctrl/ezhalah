"""Raghdan: the kitchen, bathrooms and lift the BROKER wrote reach the Advanced Filter (🔬 2026-10-09).

The JSON-LD description is a generated spec line; the broker's own text is the rendered «rt-content»
block. Kitchen / bathrooms / lift were stored on 0 of 382 while the ads state them (ops_af_score 2026-10-09:
raghdan 0 of 3 findable). The block below is verbatim from live ads 13048764 and 9038628 (source-reread run
37925550283). Prose is yes-or-nothing (ADVANCED_FILTER_SOURCE_TRUTH §2).

Run: python -m pytest scrapers/common/tests/test_raghdan_broker_description_amenities.py -q
"""
from __future__ import annotations

from scrapers.common import normalize
from scrapers.raghdan import run as R

_P = '<p dir="rtl"><span>{}</span></p>'
AD_13048764 = ('<div class="leading-relaxed text-sm font-cairo"><div dir="rtl" class="rt-content ">'
               + "".join(_P.format(x) for x in (
                   "✨ شقة فاخرة للبيع في حي السلامة – جدة جديدة جاهزة للسكن", "🏠 تفاصيل الشقة",
                   "▪️ 4 غرف نوم، منها غرفة رئيسية ماستر", "▪️ مجلس رجال مستقل", "▪️ صالة معيشة مريحة",
                   "▪️ مطبخ", "▪️ 3 دورات مياه", "▪️ غرفة شغالة", "▪️ مدخلين مستقلين", "▪️ موقف سيارة",
                   "🏢 مميزات المشروع", "✔️ مصعد", "✔️ عداد كهرباء خاص"))
               + "</div></div>")
AD_9038628 = ('<div dir="rtl" class="rt-content ">' + "".join(_P.format(x) for x in (
    "الشقة تتكون من:", " 4 غرف + مدخلين +3 دورات مياه +مطبخ +صاله جانبيه + غرفة شغالة بدورات مياة خاصة",
    "مميزات المشروع:", "مصعد للمشروع", "غرفة سائق لكل شقه")) + "</div>")


def _read(body):
    return normalize.prose_amenities_yes(R._broker_text(body), skip=R._PROSE_SKIP), \
        normalize.baths_from_leading_count(R._broker_text(body))


def test_the_bulleted_description_states_kitchen_lift_parking_maid_and_three_bathrooms():
    am, baths = _read(AD_13048764)
    assert am.get("kitchen") is True and am.get("elevator") is True and am.get("parking") is True
    assert am.get("maid_room") is True and baths == 3


def test_the_plus_list_reads_the_same():
    am, baths = _read(AD_9038628)
    assert am.get("kitchen") is True and am.get("elevator") is True and am.get("driver_room") is True
    assert baths == 3, "«بدورات مياة خاصة» has no count and does not compete with «3 دورات مياه»"


def test_no_description_block_writes_nothing():
    assert _read("<div>المساحة 120 م²، عدد الغرف 4</div>") == ({}, None)


def test_a_negated_lift_is_never_a_no():
    am, _ = _read('<div class="rt-content">' + _P.format("لا يوجد مصعد") + "</div>")
    assert "elevator" not in am


def test_mutation_the_generated_spec_line_alone_states_nothing():
    # the old source of truth (JSON-LD description) has none of these: if _broker_text stopped reading
    # the rt-content block, the first test would fail — this pins that the block IS what carries them
    am, baths = _read("المساحة 113.81 م²، عدد الغرف 4")
    assert am == {} and baths is None


def _page(desc_block: str) -> str:
    import json
    ld = {"@type": "RealEstateListing", "name": "شقة للبيع", "description": "المساحة 113.81 م²، عدد الغرف 4",
          "offers": {"price": 650000, "businessFunction": "Sell"}, "floorSize": {"value": 114},
          "address": {"addressLocality": "جدة", "addressRegion": "منطقة مكة المكرمة"}}
    return f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>{desc_block}'


def test_map_listing_stores_what_the_broker_wrote():
    row, _ = R.map_listing(_page(AD_13048764), "https://raghdan.sa/ar/property/375444614027/")
    assert row is not None
    assert row["kitchen"] is True and row["elevator"] is True and row["bathrooms"] == 3
    assert "optical_fibers" not in row or row["optical_fibers"] is not False
