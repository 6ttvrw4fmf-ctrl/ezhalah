"""fursaghyr: the ad's own WordPress post is its amenity statement (🔬 2026-10-20, ops_af_score fursaghyr 0 of 4).

The fgh feed the scraper reads carries neither the «المميزات» checklist (Houzez property_feature) nor the description.
FG26842 ticks «تكييف» and its description says «مطبخ مجهز بالكامل» and «مرافق البرج: … مواقف», while we stored NULL
for all three, so a customer asking the Advanced Filter for AC or a kitchen in Khobar never found it.
- A column a checklist term can express (AC) is STRUCTURED: ticked = yes, unticked = silence, prose never read.
- A column no term can express (kitchen, parking …) has no structured field, so the description is read (law §2).
- A failed read writes nothing; only columns both tables carry are written."""
from __future__ import annotations

from scrapers.fursaghyr import run

# FG26842's real ticked list (wp-json/wp/v2/properties/26842, read 2026-10-20) and lines of its description.
FG26842 = ["أسواق", "الاستخدام الحالي", "تكييف", "حديقة", "صالة رياضية", "صرف صحي", "كاميرات مراقبة", "مسبح",
           "مسجد", "مغسلة", "مياه", "نادي رياضي", "نظام أمن", "واي فاي"]
FG26842_TEXT = ("🔹شقة فاخرة للإيجار في برج سكني | حي البحر – الخبر\n– المساحة: 150 م²- 3 غرف- صالة مفتوحة + بلكونة- "
                "مطبخ مجهز بالكامل- مجلس مستقل\n✨ مكيفات + أجهزة كهربائية متكاملة\n🏢 مرافق البرج:مسبح | حضانة | مواقف")
CHECKLIST = frozenset({"air_conditioner"})


def _facts(labels, text="", cols=CHECKLIST):
    return {"labels": labels, "text": text, "checklist_cols": cols}


def _item(facts):
    return {"id": 26842, "permalink": "https://fursaghyr.com/property/x/", "post_facts": facts,
            "rea": {"property_type": "شقة", "purpose": "إيجار", "city": "الخبر", "region": "المنطقة الشرقية"}}


def test_fg26842_reads_ac_from_the_checklist_and_kitchen_parking_from_its_description():
    assert run.feature_answers(_facts(FG26842, FG26842_TEXT)) == {
        "air_conditioner": True, "kitchen": True, "parking": True, "balcony_terrace": True}


def test_prose_never_answers_a_checklist_column():
    # «مكيفات» in the description of an ad whose checklist does not tick «تكييف»: silence, not yes
    assert "air_conditioner" not in run.feature_answers(_facts([], "مكيفات سبليت في جميع الغرف"))


def test_silence_and_failed_reads_write_nothing():
    assert run.feature_answers(None) == {}
    assert run.feature_answers(_facts(["مسجد", "مياه"])) == {}
    assert run.feature_answers(_facts(FG26842, FG26842_TEXT, cols=frozenset())) == {}


def test_only_table_columns_are_written():
    out = run.feature_answers(_facts(["تكييف"], "مسبح وحديقة ومصعد", cols=frozenset({"air_conditioner"})))
    assert set(out) <= set(run.FEATURE_COLS) and out == {"air_conditioner": True, "elevator": True}


def test_map_listing_carries_the_answers():
    row, _ = run.map_listing(_item(_facts(FG26842, FG26842_TEXT)))
    assert row is not None and row.get("air_conditioner") is True and row.get("kitchen") is True
    row, _ = run.map_listing(_item(None))
    assert row is not None and "air_conditioner" not in row and "kitchen" not in row


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


class _S:
    def __init__(self, terms, posts):
        self.r = {run.TERMS: terms, run.POSTS: posts}

    def get(self, url, **_):
        return self.r[url]


def test_fetch_joins_labels_text_and_expressible_columns(monkeypatch):
    monkeypatch.setattr(run, "_throttle", lambda: None)
    ok = _S(_Resp(200, [{"id": 106, "name": "تكييف"}, {"id": 30, "name": "مسجد"}]),
            _Resp(200, [{"id": 26842, "property_feature": [106, 30], "content": {"rendered": "<p>مطبخ مجهز</p>"}},
                        {"id": 27683, "property_feature": []}]))
    got = run.fetch_post_facts(ok)
    assert got[26842]["labels"] == ["تكييف", "مسجد"] and "مطبخ مجهز" in got[26842]["text"]
    assert got[26842]["checklist_cols"] == frozenset({"air_conditioner"}) and got[27683]["labels"] == []
    assert run.fetch_post_facts(_S(_Resp(503, None), _Resp(200, []))) == {}


def test_a_district_name_is_not_a_balcony():
    """«حي مشرفة» holds «شرفة»: the shared reader read every ad in Jeddah's مشرفة as balcony = yes (FG25354)."""
    from scrapers.common.normalize import amenities_from_text
    assert amenities_from_text("📍 الموقع: جدة – حي مشرفة") == {}
    assert amenities_from_text("بلكونة") == {"balcony_terrace": True}
    assert amenities_from_text("وبالمصعد") == {"elevator": True}
    # a glued typo is still the ad naming a balcony (muhaysini 15874198 «منبلكونه», dwelleo 13135529)
    assert amenities_from_text("مجلس يتكون منبلكونه كبيره") == {"balcony_terrace": True}
    assert amenities_from_text("ماستروبلكونة") == {"balcony_terrace": True}


def test_fg27238_furnished_comes_from_its_own_description():
    """🔬 2026-10-23 (backlog 763): FG27238 (3237533), a Makkah flat, says «الشقه مؤثثه بالكامل»; we had no column, so a
    customer asking «مفروش» never found it. A mixed building («6 وحدات مفروشة + 3 غير مفروشة») is not one answer."""
    assert run.feature_answers(_facts([], "الشقه مؤثثه بالكامل و يوجد غرفه سايق")).get("furnished") is True
    assert "furnished" not in run.feature_answers(_facts([], "* 6 وحدات مفروشة + 3 غير مفروشة"))
    row, _ = run.map_listing(_item(_facts([], "الشقه مؤثثه بالكامل")))
    assert row is not None and row.get("furnished") is True
