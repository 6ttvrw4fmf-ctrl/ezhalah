"""wasalt: elevator / air conditioning / private entrance come from the ad's OWN description, YES-only.

🦅 Falcon 2026-10-16. wasalt publishes no structured field for these three (62,491 stored payloads, no such key
in attributes / additionalAttributes / propertyInfo), so the columns were NULL on every row while thousands of
descriptions state them, and the Advanced Filter could never find a wasalt ad by elevator. ADVANCED_FILTER_SOURCE_TRUTH
§2: prose may only say YES or nothing, and never for a field the platform publishes structurally.
The descriptions below are verbatim shapes from production rows (432670, 17203224, 17219475).
"""
import scrapers.wasalt.enrich_ar as E


def _d(html: str) -> dict:
    return {"propertyInfo": {"description": html}}


def test_real_descriptions_state_the_elevator():
    assert E.prose_amenities(_d('<p dir="rtl">​المساحة: 220 متر مربع.</p><p dir="rtl">​المصعد: راكب وجاهز للخدمة.</p>')) \
        == {"elevator": True}
    assert E.prose_amenities(_d("<div>الدور الرابع&nbsp;</div><div>يتوفر مصعد في المبنى.</div>")) == {"elevator": True}
    got = E.prose_amenities(_d("<p>مدخل خاص</p><p>مكيفات سبليت في جميع الغرف</p>"))
    assert got == {"private_entrance": True, "air_conditioner": True}


def test_negation_prepared_and_proximity_stay_unknown_never_false():
    assert E.prose_amenities(_d("<p>لا يوجد مصعد</p>")) == {}
    assert E.prose_amenities(_d("<p>تأسيس مصعد</p><p>تأسيس مكيفات</p>")) == {}
    assert E.prose_amenities(_d("<p>بالقرب من مدخل خاص للحي</p>")) == {}
    # two statements that disagree have not stated the fact
    assert E.prose_amenities(_d("<p>مصعد</p><p>بدون مصعد</p>")) == {}
    assert all(v is True for v in E.prose_amenities(_d("<p>مصعد</p><p>غير مكيفة</p>")).values())


def test_fields_wasalt_publishes_structurally_are_never_read_from_prose():
    got = E.prose_amenities(_d("<p>شقة مفروشة مع مطبخ وموقف سيارة وغرفة خادمة وغرفة سائق ومصعد</p>"))
    assert got == {"elevator": True}
    assert set(E.PROSE_ONLY) == {"elevator", "air_conditioner", "private_entrance"}


def test_unreadable_or_silent_payload_writes_nothing():
    assert E.prose_amenities({"_err": "404", "propertyInfo": {"description": "مصعد"}}) == {}
    assert E.prose_amenities({}) == {}
    assert E.prose_amenities(None) == {}
    assert E.prose_amenities(_d("")) == {}
    assert E.prose_amenities(_d("<p>شقة واسعة في حي هادئ</p>")) == {}


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.f, self.op, self.payload = db, table, {}, "select", None

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, k, v):
        self.f[k] = v
        return self

    def is_(self, k, _v):
        self.f.setdefault("null", []).append(k)
        return self

    def or_(self, _s):
        return self

    def gt(self, _k, v):
        self.f["gt"] = v
        return self

    def order(self, *_a):
        return self

    def limit(self, n):
        self.f["limit"] = n
        return self

    def execute(self):
        rows = self.db.rows
        if self.op == "update":
            r = next(r for r in rows if r["id"] == self.f["id"])
            for col in self.f.get("null", []):
                if r.get(col) is not None:
                    return type("R", (), {"data": []})()
            r.update(self.payload)
            self.db.writes.append((r["id"], dict(self.payload)))
            return type("R", (), {"data": [r]})()
        col = self.f["null"][0]
        got = [{"id": r["id"], "desc": r["desc"]} for r in rows
               if r["id"] > self.f.get("gt", 0) and r.get(col) is None][: self.f["limit"]]
        return type("R", (), {"data": got})()


class _DB:
    def __init__(self, rows):
        self.rows, self.writes = rows, []

    def table(self, t):
        return _Q(self, t)


def test_backfill_writes_yes_only_into_null_columns_and_never_overwrites():
    db = _DB([
        {"id": 1, "desc": "<p>يتوفر مصعد</p>", "elevator": None, "air_conditioner": None, "private_entrance": None},
        {"id": 2, "desc": "<p>لا يوجد مصعد</p>", "elevator": None, "air_conditioner": None, "private_entrance": None},
        {"id": 3, "desc": "<p>مصعد</p>", "elevator": False, "air_conditioner": None, "private_entrance": None},
        {"id": 4, "desc": None, "elevator": None, "air_conditioner": None, "private_entrance": None},
    ])
    out = E.prose_backfill(db, "wasalt_residential_listings", page=2)
    assert out == {"elevator": 1, "air_conditioner": 0, "private_entrance": 0}
    assert db.writes == [(1, {"elevator": True})]
    assert db.rows[1]["elevator"] is None and db.rows[2]["elevator"] is False
    assert all(v is True for _, w in db.writes for v in w.values())
