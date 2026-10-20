"""fursaghyr's «المميزات» checklist (Houzez property_feature) is the ad's structured amenity statement (🔬 2026-10-20).

FG26842 ticks «تكييف» on its own page; the fgh feed the scraper reads never carried it, so air_conditioner was NULL and
a customer asking the Advanced Filter for AC in Khobar never found it. A ticked label is a yes, an unticked or unread
checklist is silence (never «no»), and only columns both tables carry are written."""
from __future__ import annotations

from scrapers.fursaghyr import run

# FG26842's real ticked list (wp-json/wp/v2/properties/26842 property_feature, read 2026-10-20).
FG26842 = ["أسواق", "الاستخدام الحالي", "تكييف", "حديقة", "صالة رياضية", "صرف صحي", "كاميرات مراقبة", "مسبح",
           "مسجد", "مغسلة", "مياه", "نادي رياضي", "نظام أمن", "واي فاي"]


def _item(labels):
    return {"id": 26842, "permalink": "https://fursaghyr.com/property/x/", "feature_labels": labels,
            "rea": {"property_type": "شقة", "purpose": "إيجار", "city": "الخبر", "region": "المنطقة الشرقية"}}


def test_ticked_ac_is_yes():
    assert run.feature_answers(FG26842) == {"air_conditioner": True}


def test_silence_is_never_no():
    assert run.feature_answers([]) == {}
    assert run.feature_answers(None) == {}
    assert run.feature_answers(["مسجد", "مياه"]) == {}


def test_only_table_columns_are_written():
    out = run.feature_answers(["مصعد", "مطبخ", "مواقف سيارات", "تكييف", "مسبح", "حديقة"])
    assert set(out) <= set(run.FEATURE_COLS)
    assert out == {"elevator": True, "kitchen": True, "parking": True, "air_conditioner": True}


def test_map_listing_carries_the_checklist():
    row, _ = run.map_listing(_item(FG26842))
    assert row is not None and row.get("air_conditioner") is True
    row, _ = run.map_listing(_item(None))
    assert row is not None and "air_conditioner" not in row


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


def test_fetch_joins_labels_and_fails_to_silence(monkeypatch):
    monkeypatch.setattr(run, "_throttle", lambda: None)
    ok = _S(_Resp(200, [{"id": 106, "name": "تكييف"}, {"id": 30, "name": "مسجد"}]),
            _Resp(200, [{"id": 26842, "property_feature": [106, 30]}, {"id": 27683, "property_feature": []}]))
    assert run.fetch_feature_names(ok) == {26842: ["تكييف", "مسجد"], 27683: []}
    bad = _S(_Resp(503, None), _Resp(200, []))
    assert run.fetch_feature_names(bad) == {}
