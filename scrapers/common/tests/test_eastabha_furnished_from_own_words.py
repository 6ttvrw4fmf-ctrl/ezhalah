"""eastabha: furnished comes from the ad's own words (its WP Residence checklist has no furnished item), and only
on the residential table, the only one with the column (20261018093318). 🔬 2026-10-18, backlog 626.

Run: python -m pytest scrapers/common/tests/test_eastabha_furnished_from_own_words.py -v
"""
import sys

sys.path.insert(0, ".")

import scrapers.eastabha.run as R  # noqa: E402

TAX = {"property_city": {2: "أبها"}, "property_county_state": {4: "عسير"},
       "property_category": {5: "شقق", 7: "محلات"}, "property_action_category": {6: "إيجار"}, "property_area": {},
       "property_features": {}, "property_status": {}}


def _post(cat, text):
    return {"id": 595344, "title": {"rendered": "شقة للإيجار"}, "content": {"rendered": f"<p>{text}</p>"},
            "property_city": [2], "property_county_state": [4], "property_category": [cat],
            "property_action_category": [6], "link": "https://eastabha.sa/estate_property/x/"}


def _row(cat, text):
    row, category, _ = R.map_listing(_post(cat, text), TAX, {"price": 30000}, None)
    return row, category


def test_a_furnished_ad_says_yes():
    row, category = _row(5, "شقة مفروشة بالكامل للإيجار السنوي")
    assert category == "residential" and row["furnished"] is True


def test_a_stated_unfurnished_ad_says_no():
    row, _ = _row(5, "شقة غير مفروشة")
    assert row["furnished"] is False


def test_silence_and_partly_furnished_write_nothing():
    assert "furnished" not in _row(5, "شقة واسعة ثلاث غرف")[0]
    assert "furnished" not in _row(5, "شقة مفروشة جزئيا")[0]


def test_commercial_rows_never_carry_the_key():
    row, category = _row(7, "محل مؤثث بالكامل")
    if category == "commercial":
        assert "furnished" not in row
    else:   # the category map may route محلات to residential; then the column exists and the answer is read
        assert row["furnished"] is True


# Verbatim excerpts, 2026-10-18 (phone-free).
def test_a_best_use_suggestion_is_not_furnished():
    land = ("📐 المساحة : 750 م² ✅ أفضل استخدام للعقار : فيلا سكنية فاخرة. عمارة صغيرة مكونة من شقق مفروشة "
            "للإيجار اليومي أو الشهري")                                                         # 595438, a plot
    villa = ("متبقي فقط: تركيب الألمنيوم والأبواب الداخلية والدهانات 💡 أفضل استخدام: سكن عائلي فاخر. "
             "استثمار راقٍ كفيلا مفروشة أو سكن تنفيذي عالي المستوى.")                           # 595405
    building = ("💡 3 مقترحات مثالية لاستخدام العقار: تحويل العقار إلى شقق مفروشة فندقية")      # 595463
    near = ("✨ مميزات إضافية: تصميم حديث وفخم يتناسب مع السكن العائلي أو الشقق المفروشة.")        # 595407
    for d in (land, villa, building, near):
        assert R.furnished_answer(d) == {}, d


def test_a_stated_furnishing_survives_its_own_suggestion_block():
    d = ("العمارة مكونة من 3 أدوار سكنية كاملة + بدروم واسع ، مؤثثة بالكامل بأثاث عصري، ومكيفات راكبة ✅ أفضل "
         "استخدامات العقار: 🏨 تحويله إلى مشروع شقق مفروشة")                                    # 595466
    assert R.furnished_answer(d) == {"furnished": True}
    d2 = ("الفيلا مؤثثة بالكامل ، وتحتوي على مطبخين 🧱 مثالية للسكن العائلي الفاخر أو الاستثمار المفروش")  # 595471
    assert R.furnished_answer(d2) == {"furnished": True}
    d3 = "🏡 (شقة مفروشة بالكامل): 2 غرف نوم صالة واسعة مجلس 3 دورات مياه"                       # 595420
    assert R.furnished_answer(d3) == {"furnished": True}
