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


def test_negation_is_a_no_and_prepared_and_proximity_stay_unknown():
    # owner 2026-10-24: yes / an explicit no tied to the word / unknown
    assert E.prose_amenities(_d("<p>لا يوجد مصعد</p>")) == {"elevator": False}
    assert E.prose_amenities(_d("<p>تأسيس مصعد</p><p>تأسيس مكيفات</p>")) == {}
    assert E.prose_amenities(_d("<p>بالقرب من مدخل خاص للحي</p>")) == {}
    # two statements that disagree have not stated the fact
    assert E.prose_amenities(_d("<p>مصعد</p><p>بدون مصعد</p>")) == {}
    assert E.prose_amenities(_d("<p>مصعد</p><p>غير مكيفة</p>")) == {"elevator": True, "air_conditioner": False}


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

    def _match(self, r):
        if any(r.get(col) is not None for col in self.f.get("null", [])):
            return False
        return all(r.get(k) == v for k, v in self.f.items() if k not in ("null", "gt", "limit", "active", "id"))

    def execute(self):
        rows = self.db.rows
        if self.op == "update":
            r = next(r for r in rows if r["id"] == self.f["id"])
            if not self._match(r):
                return type("R", (), {"data": []})()
            r.update(self.payload)
            self.db.writes.append((r["id"], dict(self.payload)))
            return type("R", (), {"data": [r]})()
        got = [{"id": r["id"], "desc": r["desc"]} for r in rows
               if r["id"] > self.f.get("gt", 0) and self._match(r)][: self.f["limit"]]
        return type("R", (), {"data": got})()


class _DB:
    def __init__(self, rows):
        self.rows, self.writes = rows, []

    def table(self, t):
        return _Q(self, t)


def test_backfill_writes_yes_or_a_stated_no_into_null_columns_then_rejudges_its_own_answers():
    db = _DB([
        {"id": 1, "desc": "<p>يتوفر مصعد</p>", "elevator": None, "air_conditioner": None, "private_entrance": None},
        {"id": 2, "desc": "<p>لا يوجد مصعد</p>", "elevator": None, "air_conditioner": None, "private_entrance": None},
        {"id": 3, "desc": "<p>مصعد</p>", "elevator": False, "air_conditioner": None, "private_entrance": None},
        {"id": 4, "desc": None, "elevator": None, "air_conditioner": None, "private_entrance": None},
    ])
    out = E.prose_backfill(db, "wasalt_residential_listings", page=2)
    assert {k: v for k, v in out.items() if not k.endswith("_unset")} == {"elevator": 2, "air_conditioner": 0, "private_entrance": 0}
    # NULL columns get the stated answer; row 3's «no» (only this module writes these columns) is re-judged to the
    # yes its own words give; row 4 has no words and is never written.
    assert db.writes == [(1, {"elevator": True}), (2, {"elevator": False}), (3, {"elevator": True})]
    assert db.rows[1]["elevator"] is False and db.rows[2]["elevator"] is True and db.rows[3]["elevator"] is None


def test_the_four_wrong_yes_of_the_first_backfill_are_unknown():
    """Verbatim shapes of rows 9313822, 11923578, 442940 and 526753 (2026-10-16): each was written elevator = YES."""
    assert E.prose_amenities(_d("الخدمات: شبكة كهرباء - شبكة مياه\\n\\n🔘 المصعد: لا يوجد مصعد\\n\\n☀️ مميزات العقار:")) == {"elevator": False}
    assert "elevator" not in E.prose_amenities(_d("<p>المصعد: غير راكب، ويوجد تأسيس للمصعد</p><p>تأسيس مصعد</p>"))
    assert E.prose_amenities(_d("ضمانات تصل حتى 25 سنة\\n\\n \\n•\\n \\nتأسيس مصعد\\n\\n \\n•\\n \\nعدادات كهرباء")) == {}
    assert "elevator" not in E.prose_amenities(_d("* سطح مع الملحق&nbsp;\\n\\n* مؤسس مصعد.\\n\\n* يتوفر لكل وحدة خزان"))


def test_a_labelled_yes_still_reads_yes():
    assert E.prose_amenities(_d("<p>المصعد: يوجد مصعد كهربائي</p>")) == {"elevator": True}
    assert E.prose_amenities(_d("<p>التكييف: مكيفات سبليت راكبة</p>")) == {"air_conditioner": True}
    assert E.prose_amenities(_d("التجهيزات:\\n - مصعد كهربائي\\n - تكييف سبليت")) == {"elevator": True, "air_conditioner": True}


def test_a_prepared_or_uninstalled_fixture_anywhere_makes_the_answer_unknown():
    """526753: «مدخل مرورا بالمصعد» on one line, «مؤسس مصعد» on another — never YES."""
    assert "elevator" not in E.prose_amenities(_d("* مدخل مرورا بالمصعد\\n\\n* مؤسس مصعد."))
    assert "air_conditioner" not in E.prose_amenities(_d("<p>مكيفات في الصالة</p><p>تأسيس تكييف مركزي</p>"))
    assert E.prose_amenities(_d("<p>مصعد</p><p>تأسيس مكيفات</p>")) == {"elevator": True}


def test_recheck_moves_a_yes_the_current_reader_no_longer_reads_to_what_it_reads_now():
    """The first backfill wrote 9313822 elevator = YES from «المصعد: لا يوجد مصعد»; the next run must undo it,
    and must leave a real YES alone."""
    db = _DB([
        {"id": 1, "desc": "🔘 المصعد: لا يوجد مصعد", "elevator": True, "air_conditioner": None, "private_entrance": None},
        {"id": 2, "desc": "<p>يتوفر مصعد</p>", "elevator": True, "air_conditioner": None, "private_entrance": None},
    ])
    out = E.prose_backfill(db, "wasalt_residential_listings", page=1)
    assert out["elevator_unset"] == 1
    assert db.rows[0]["elevator"] is False and db.rows[1]["elevator"] is True     # «لا يوجد مصعد» is a stated no
    assert (1, {"elevator": False}) in db.writes


def test_the_plural_lifts_reaches_the_backfill_candidates():
    # 🔬 2026-10-18: 199 active ads say only «مصاعد», which the «مصعد» pre-filter never selected, so the
    # reader (which now knows the plural) was never shown them.
    seen: list[str] = []

    class _RecQ(_Q):
        def or_(self, s):
            seen.append(s)
            return self

    class _RecDB(_DB):
        def table(self, t):
            return _RecQ(self, t)

    db = _RecDB([{"id": 1, "desc": "<p>العمارة فيها مصاعد حديثة</p>", "elevator": None,
                  "air_conditioner": None, "private_entrance": None}])
    E.prose_backfill(db, "wasalt_residential_listings", page=5)
    assert any("مصاعد" in s for s in seen), seen
    assert db.writes == [(1, {"elevator": True})]
