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
    return normalize.prose_amenities(R._broker_text(body), skip=R._PROSE_SKIP), \
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


def test_a_negated_lift_is_a_stated_no():
    am, _ = _read('<div class="rt-content">' + _P.format("لا يوجد مصعد") + "</div>")
    assert am.get("elevator") is False      # owner 2026-10-24: an explicit negation is a stated no


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


# Every column the reader can emit must exist on raghdan_residential_listings (measured 2026-10-09 via
# information_schema). «شقة مفروشة» emitted `furnished`, which the table does not have, and PGRST204 failed the
# whole crawl batch (run 37927579101).
RAGHDAN_COLUMNS = {"bathrooms", "elevator", "kitchen", "car_entrance", "air_conditioner", "private_entrance",
                   "optical_fibers", "laundry_room", "balcony_terrace", "maid_room", "driver_room", "parking"}


def test_the_reader_only_emits_columns_raghdan_has():
    every_token = "<br>".join(t for toks in normalize._AMENITY_TOKENS.values() for t in toks)
    am = normalize.prose_amenities(R._broker_text(f'<div class="rt-content">{every_token}</div>'), skip=R._PROSE_SKIP)
    assert am and set(am) <= RAGHDAN_COLUMNS, set(am) - RAGHDAN_COLUMNS


def test_a_furnished_flat_does_not_break_the_crawl():
    row, _ = R.map_listing(_page('<div class="rt-content"><p><span>شقة مفروشة مع مطبخ</span></p></div>'),
                           "https://raghdan.sa/ar/property/375444614027/")
    assert "furnished" not in row and row["kitchen"] is True


# The redesigned page (CI re-read 39229707556, 2026-10-19): the broker's text is ONE pre-wrap <p> whose lines are
# literal newlines. Verbatim from live ads 10440439 and 12751033 (contact lines cut).
_PW = ('<div class="flex-1"><p class="text-gray-600 dark:text-gray-400 font-medium leading-relaxed text-sm font-cairo" '
       'style="white-space:pre-wrap;text-align:justify">{}</p></div>')
AD_10440439 = _PW.format("الموقع: مدينة الخبر - حي الحمراء (موقع استراتيجي مميز وقريب جداً من جسر البحرين).\n"
                         "الدور: الدور الرابع (يوجد مصعد في المبنى).\nالمساحة الإجمالية: 131 متر مربع.\n"
                         "التفاصيل الداخلية:\n3 غرف نوم واسعة.\n3 دورات مياه.\nمطبخ راكب بالكامل.\n"
                         "مكيفات راكبة وجاهزة للتشغيل.\n[المزايا والخدمات]\nموقف سيارة مستقل وخاص بالشقة.")
AD_12751033 = _PW.format("🟧 شقة للبيع\n 📍جنوب الرياض - حي المروة \n\n-  المساحة: 118.78م\n- دور ثاني \n- مصعد \n\n"
                         "🔻الشقة تتكون من⬇️\n- مجلس رجال \n- صالة\n- مطبخ \n- عدد 3 غرف نوم \n- عدد 3 دورات مياه")


def test_the_redesigned_page_states_lift_kitchen_ac_parking():
    am, baths = _read(AD_10440439)
    assert am.get("elevator") is True and am.get("kitchen") is True
    assert am.get("air_conditioner") is True and am.get("parking") is True
    assert baths == 3


def test_the_redesigned_dash_list_reads_the_same():
    am, baths = _read(AD_12751033)
    assert am.get("elevator") is True and am.get("kitchen") is True and baths == 3


def test_mutation_the_old_pattern_alone_reads_nothing_from_the_new_page():
    # what every crawl did since the redesign: rt-content is absent, so nothing was read
    assert R._RT_CONTENT_RE.search(AD_10440439) is None
