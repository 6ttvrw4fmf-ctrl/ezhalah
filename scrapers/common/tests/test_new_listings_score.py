"""new_listings_score: the comparison and the rating rule, hermetic (synthetic fixtures only)."""
from __future__ import annotations

import pytest

from scrapers.common.new_listings_score import (
    FLOOR_CAP, MATCH, MISMATCH, PAGE_SILENT, WE_MISS,
    _cmp_district, af_precision, af_recall, compare_listing, empty_row, fold,
    norm, normal_accuracy, rating, score_site,
)


def page(*lines, title=""):
    return {"title": title, "meta": {}, "jsonld": [], "evidence_lines": list(lines),
            "text_head": " | ".join(lines)}


# ── District equivalence (the owner's priority, the exact rules) ───────────────────────────────

@pytest.mark.parametrize("stored,on_page,want", [
    ("حي النرجس", "النرجس", MATCH),              # «حي X» stored, bare «X» on the page
    ("النرجس", "حي النرجس", MATCH),              # bare stored, «حي X» on the page
    ("الرابية", "الرابية الهفوف", MATCH),        # glued city suffix CONTAINS our district → match
    ("المحمدية 2", "حي المحمدية", MATCH),        # numbered district folds onto the plain name
    ("النرجس", "حي العليا", MISMATCH),           # the page names a DIFFERENT district
    (None, "حي العليا", WE_MISS),                # page states it, we serve NULL
])
def test_district_rules(stored, on_page, want):
    assert _cmp_district(stored, norm(on_page)) == want


def test_district_silent_is_never_wrong():
    assert _cmp_district(None, norm("لا شيء هنا")) == PAGE_SILENT
    assert _cmp_district("النرجس", norm("لا شيء هنا")) == PAGE_SILENT  # we claim, page silent: not a mismatch


# ── Booleans, numbers, deal ─────────────────────────────────────────────────────────────────────

def test_bool_negation_and_unknown():
    r = compare_listing({"elevator": False}, page("شقة بدون مصعد"))
    assert r["elevator"] == MATCH
    r = compare_listing({"elevator": True}, page("شقة بدون مصعد"))
    assert r["elevator"] == MISMATCH
    r = compare_listing({"elevator": None}, page("يوجد مصعد"))
    assert r["elevator"] == WE_MISS
    r = compare_listing({"elevator": None}, page("شقة واسعة"))
    assert r["elevator"] == PAGE_SILENT          # silent means unknown, never a miss


def test_price_grouping_and_arabic_digits():
    ok = page("السعر 1,250,000 ريال")
    assert compare_listing({"price_total": 1250000}, ok)["price"] == MATCH
    assert compare_listing({"price_total": 1250000}, page("السعر ١٬٢٥٠٬٠٠٠ ريال"))["price"] == MATCH
    assert compare_listing({"price_total": 1250000}, page("السعر 900,000 ريال"))["price"] == MISMATCH
    assert compare_listing({"price_total": None}, page("السعر 900,000 ريال"))["price"] == WE_MISS


def test_small_numbers_only_count_near_their_keyword():
    # a stray «3» on the page must not confirm bedrooms=3; «3 غرف» must.
    assert compare_listing({"bedrooms": 3}, page("الدور 3", "غرف نوم عديدة"))["bedrooms"] != MATCH
    assert compare_listing({"bedrooms": 3}, page("3 غرف نوم"))["bedrooms"] == MATCH


def test_label_and_value_on_neighbouring_lines():
    # aqar renders «غرف النوم» / «4» and «م²» / «240» as label + bare-value lines (seen live
    # 2026-10-03): the bare neighbour confirms the figure; a busy neighbour never does.
    assert compare_listing({"bedrooms": 4}, page("غرف النوم", "4"))["bedrooms"] == MATCH
    assert compare_listing({"area_m2": 240}, page("م²", "240"))["area"] == MATCH
    assert compare_listing({"bedrooms": 4}, page("غرف النوم", "5"))["bedrooms"] == MISMATCH


def test_an_area_figure_is_never_another_fields_value():
    # tuba prints an EMPTY «عمر العقار :» with «214.66 م²» on the next line (source-reread 37600467768,
    # 2026-10-07): that is the area, not a stated age — silent, never a mismatch against our stored 0.
    assert compare_listing({"property_age": 0}, page("عمر العقار :", "214.66 م²"))["property_age"] == PAGE_SILENT
    assert compare_listing({"bathrooms": 5}, page("الحمامات :", "159.06 م²"))["bathrooms"] == PAGE_SILENT
    # …while a real bare value still counts, a street width in «متر» still counts, and the area keeps its m².
    assert compare_listing({"bathrooms": 2}, page("الحمامات :", "2"))["bathrooms"] == MATCH
    assert compare_listing({"street_width_m": 15}, page("عرض الشارع", "15 متر"))["street_width_m"] == MATCH
    assert compare_listing({"area_m2": 214}, page("المساحة", "214 م²"))["area"] == MATCH


def test_one_written_as_a_word():
    # gathern prints «دورة مياه واحدة» (one bathroom, as a word) — 3/3 false «mismatches» on 2026-10-07.
    assert compare_listing({"bathrooms": 1}, page("دورات المياة", "دورة مياه واحدة"))["bathrooms"] == MATCH
    assert compare_listing({"bathrooms": 2}, page("دورة مياه واحدة"))["bathrooms"] == MISMATCH


def test_a_prepared_lift_shaft_is_not_a_lift():
    assert compare_listing({"elevator": None}, page("نوافذ زجاج ، تأسيس مصعد"))["elevator"] == PAGE_SILENT
    assert compare_listing({"elevator": None}, page("يوجد مصعد"))["elevator"] == WE_MISS


def test_gathern_price_is_never_compared():
    r = compare_listing({"price_total": 999}, page("السعر 5 ريال"), skip_price=True)
    assert "price" not in r


def test_deal_words():
    assert compare_listing({"deal_ar": "بيع"}, page("فيلا للبيع"))["deal"] == MATCH
    assert compare_listing({"deal_ar": "إيجار"}, page("شقة للإيجار"))["deal"] == MATCH
    assert compare_listing({"deal_ar": "بيع"}, page("شقة للإيجار"))["deal"] == MISMATCH


# ── The rating rule (the constants the owner tunes) ────────────────────────────────────────────

def _row(**kw):
    r = empty_row("2026-10-02", kw.pop("platform", "siteA"))
    r.update(kw)
    return r


def test_rating_10_needs_thresholds_and_every_site_measured():
    good = _row(sampled=10, decided_ads=6, normal_match=200, normal_mismatch=0,
                af_claimed=20, af_agree=20, af_page_states=20, af_captured=19)
    assert rating([good])[0] == 10


def test_rating_caps_at_5_when_any_site_is_under_the_floor():
    bad = _row(platform="siteB", decided_ads=6, normal_match=5, normal_mismatch=5)
    cap, why = rating([bad])
    assert cap == FLOOR_CAP and "siteB" in why


def test_rating_9_when_no_site_reaches_min_decided_ads():
    thin = _row(decided_ads=2, normal_match=10, normal_mismatch=0)
    assert rating([thin])[0] == 9


def test_unknown_never_lowers_the_rating_below_9():
    silent = _row(sampled=5, decided_ads=0)       # every field page-silent or unreadable
    cap, why = rating([silent])
    assert cap == 9 and normal_accuracy(silent) is None and "not measured" in why


# ── The whole site path over a fake client and a fake page (no network, no database) ──────────

class _Q:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val or r.get("id") == val and col == "id"]
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class FakeClient:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Q([dict(r) for r in self.tables.get(name, [])])


HTML = """<html><head><title>شقة للإيجار في حي النرجس</title></head><body>
<p>شقة للإيجار سنوي في حي النرجس</p><p>السعر 35,000 ريال</p><p>المساحة 120 م2</p>
<p>3 غرف نوم</p><p>يوجد مصعد</p><p>بدون مسبح</p></body></html>"""


def test_score_site_end_to_end():
    stored = {"source_table": "fake_residential_listings", "listing_id": 7, "platform": "fakesite",
              "district_ar": "النرجس", "city_ar": None, "region_ar": None, "deal_ar": "إيجار",
              "rent_period_ar": "سنوي", "type_ar": "شقة", "price_annual": 35000, "area_m2": 120,
              "bedrooms": 3, "elevator": True, "pool": True}   # pool True but the page says «بدون مسبح»
    client = FakeClient({
        "search_listings_ar": [stored],
        "fake_residential_listings": [{"id": 7, "listing_url": "https://example.test/7"}],
    })
    row = score_site(client, "fakesite", [("fake_residential_listings", 7)],
                     night="2026-10-02", pace=0, probe=lambda url: (200, HTML))
    assert row["sampled"] == 1 and row["decided_ads"] == 1
    assert row["fields"]["district"][MATCH] == 1
    assert row["fields"]["deal"][MATCH] == 1 and row["fields"]["rent_period"][MATCH] == 1
    assert row["fields"]["price"][MATCH] == 1 and row["fields"]["area"][MATCH] == 1
    assert row["fields"]["pool"][MISMATCH] == 1          # we say yes, the page says «بدون مسبح»
    assert row["mismatch_ids"] == ["fake_residential_listings:7"]
    assert normal_accuracy(row) == 1.0
    assert af_precision(row) is not None and af_precision(row) < 1.0


def test_unreadable_page_is_counted_but_never_wrong():
    client = FakeClient({
        "search_listings_ar": [{"source_table": "t", "listing_id": 1}],
        "t": [{"id": 1, "listing_url": "https://example.test/1"}],
    })
    row = score_site(client, "fakesite", [("t", 1)], night="2026-10-02", pace=0,
                     probe=lambda url: (503, ""))
    assert row["sampled"] == 1 and row["unreadable_pages"] == 1
    assert row["normal_mismatch"] == 0 and row["mismatch_ids"] == []


def test_fold_counts_af_recall_misses():
    row = empty_row("2026-10-02", "s")
    stored = {"elevator": None}
    fold(row, "t:1", {"elevator": WE_MISS, "district": MATCH}, stored)
    assert row["af_page_states"] == 1 and row["af_captured"] == 0
    assert af_recall(row) == 0.0
    assert row["normal_match"] == 1      # district is a normal field


# ── The writer: only the table's columns, and only a missing TABLE is forgiven (2026-10-05) ─────

class _Upsert:
    def __init__(self, sink, err=None):
        self.sink, self.err = sink, err

    def upsert(self, payload, on_conflict=None):
        self.sink.append((payload, on_conflict))
        return self

    def execute(self):
        if self.err:
            raise Exception(self.err)
        return self


class _WriteClient:
    def __init__(self, err=None):
        self.sent, self.err = [], err

    def table(self, _name):
        return _Upsert(self.sent, self.err)


def test_write_rows_sends_only_table_columns():
    from scrapers.common.new_listings_score import COLUMNS, write_rows
    row = empty_row("2026-10-05", "aqar")
    row["new_24h"] = 3180                     # the extra key that made PostgREST refuse every night
    c = _WriteClient()
    assert write_rows(c, [row]) == "wrote 1 rows to ops_new_listings_score"
    (payload, conflict), = c.sent
    assert set(payload[0]) == set(COLUMNS) and conflict == "night,platform"


def test_write_rows_missing_column_is_loud_not_table_missing():
    from scrapers.common.new_listings_score import write_rows
    c = _WriteClient(err="{'code': 'PGRST204', 'message': \"Could not find the 'x' column of "
                         "'ops_new_listings_score' in the schema cache\"}")
    with pytest.raises(Exception):
        write_rows(c, [empty_row("2026-10-05", "aqar")])
    gone = _WriteClient(err="{'code': 'PGRST205', 'message': \"Could not find the table "
                            "'public.ops_new_listings_score' in the schema cache\"}")
    assert "does not exist yet" in write_rows(gone, [empty_row("2026-10-05", "aqar")])


# ── «عمر العقار جديد» is the figure 0 (aqar 15415047, 2026-10-05) ───────────────────────────────

AQAR_SPEC = ("تفاصيل الإعلان نوع العقار سكني غرف النوم 3 الصالات 1 دورات المياه 2 الدور أرضي "
             "عمر العقار جديد المساحة 273 م² غرف نوم 3")


@pytest.mark.parametrize("age,want", [(0, MATCH), (5, MISMATCH), (None, WE_MISS)])
def test_new_building_word_reads_as_age_zero(age, want):
    got = compare_listing({"property_age": age, "area_m2": 273}, page(AQAR_SPEC))
    assert got["property_age"] == want
    assert got["area"] == MATCH          # the spec line's own area is still read as before


@pytest.mark.parametrize("age,want", [(0, MATCH), (5, MISMATCH)])
def test_new_building_word_on_the_line_after_its_label(age, want):
    # the live page: label and value on separate lines, the previous row's bare area just above
    # (aqar 15703930, 2026-10-06: «المساحة» / «220 م²» / «عمر العقار» / «جديد»)
    got = compare_listing({"property_age": age}, page("المساحة", "220 م²", "عمر العقار", "جديد"))
    assert got["property_age"] == want


def test_new_building_word_never_answers_another_number_field():
    # bedrooms 0 is not «جديد» (its keyword line is the same spec line): the word is the age label's only
    got = compare_listing({"bedrooms": 0}, page(AQAR_SPEC))
    assert got["bedrooms"] == MISMATCH


# ── A monthly rent is stored ×12; the page prints the month (superoffice 15485140, 2026-10-05) ──

def test_monthly_rent_compares_the_monthly_figure():
    stored = {"price_annual": 75456, "rent_period_ar": "شهري"}
    assert compare_listing(stored, page("6288.40 ريال / شهر"))["price"] == MATCH
    # the ×12 figure is never on the page, and a different month is still wrong
    assert compare_listing(stored, page("7000 ريال / شهر"))["price"] == MISMATCH


def test_annual_rent_is_compared_as_stored():
    stored = {"price_annual": 75456, "rent_period_ar": "سنوي"}
    assert compare_listing(stored, page("75,456 ريال سنوياً"))["price"] == MATCH
    assert compare_listing(stored, page("6288 ريال"))["price"] == MISMATCH


# ── «اختر عدد الغرف» is a room picker, not a stated count (rakez 15742193, 2026-10-06) ─────────────

def test_room_picker_prompt_is_not_a_room_count():
    lines = ("اختر عدد الغرف", "2,600,000 ريال", "268.75 م²", "2,450,000 ريال", "332.46 م²")
    assert compare_listing({"bedrooms": 4}, page(*lines))["bedrooms"] == PAGE_SILENT
    # a real stated count on the same page still decides
    assert compare_listing({"bedrooms": 4}, page(*lines, "غرف النوم 3"))["bedrooms"] == MISMATCH
    assert compare_listing({"bedrooms": 3}, page(*lines, "غرف النوم 3"))["bedrooms"] == MATCH


# ── Known answers from the 2026-10-12 score (job 114677400387, re-read run 38216091755) ─────────

def test_al_hay_tail_is_not_a_district_on_the_page():
    # mustqr 17151695: app shell, the only «حي» is «الحي» in «تصفح حسب الحي والسعر» → silent, not MISMATCH.
    assert _cmp_district("حي السويفلة", norm("تصفح حسب الحي والسعر")) == PAGE_SILENT
    # aqalemhajer title «الضاحية الحي الاول» names no «حي X» either.
    assert _cmp_district(None, norm("أرض للبيع في الضاحية الحي الاول 23-1 أ")) == PAGE_SILENT
    # «حي X» on its own, or glued to «ب», still names one.
    assert _cmp_district("النرجس", norm("حي العليا")) == MISMATCH
    assert _cmp_district(None, norm("شقة بحي حطين")) == WE_MISS


def test_office_contact_line_is_not_the_ads_district():
    # aqalemhajer 17387590: footer «الأحساء, الهفوف, حي الملك فهد, هاتف:…» under every ad.
    r = compare_listing({"district_ar": None},
                        page("بيت للبيع في المزرع", "الأحساء, الهفوف, حي الملك فهد, هاتف:0500000000 - 0500000001"))
    assert r["district"] == PAGE_SILENT
    # the same district on an ad line is still read
    r = compare_listing({"district_ar": None}, page("فيلا للبيع في حي الملك فهد"))
    assert r["district"] == WE_MISS


@pytest.mark.parametrize("stored,want", [(2, MATCH), (3, MISMATCH)])
def test_dual_word_states_two(stored, want):
    # bossbih 17388816: «▫️غرفتين النوم» / «غرفتين», stored bedrooms 2.
    assert compare_listing({"bedrooms": stored}, page("▫️غرفتين النوم", "12,000 ريال"))["bedrooms"] == want


def test_other_ads_table_page_is_unreadable_not_wrong():
    from scrapers.common.new_listings_score import is_other_ads_page
    # nufouth 17377059 (stored حي الوزارات): the share link's static HTML is the vacancies table.
    table = page("ر.س", "6 غرف", "حي المحمدية", "ر.س", "3 غرف", "حي البحيرة", "ر.س", "4 غرف", "حي الياسمين",
                 title="نفوذ التطوير للعقارات وادارة الأملاك - جدول الشواغر")
    assert is_other_ads_page({"district_ar": "حي الوزارات"}, table)
    assert is_other_ads_page({"district_ar": None}, table)
    # ours among them, or the title naming one, is a real ad page with a «similar ads» strip
    assert not is_other_ads_page({"district_ar": "حي البحيرة"}, table)
    titled = dict(table, title="شقة للإيجار في حي الياسمين")
    assert not is_other_ads_page({"district_ar": "حي الوزارات"}, titled)
    # two districts is not a table
    assert not is_other_ads_page({"district_ar": "حي النسيم الشرقي"},
                                 page("حي النسيم الشرقي", "101 - 259 م²", "حي العارض", title="مشروع الصفوة"))


def test_score_site_counts_other_ads_page_as_unreadable():
    body = ("<html><head><title>جدول الشواغر</title></head><body><p>6 غرف</p><p>حي المحمدية</p>"
            "<p>3 غرف</p><p>حي البحيرة</p><p>4 غرف</p><p>حي الياسمين</p></body></html>")
    client = FakeClient({
        "search_listings_ar": [{"source_table": "t", "listing_id": 1, "district_ar": "حي الوزارات", "bedrooms": 2}],
        "t": [{"id": 1, "listing_url": "https://example.test/?ads-N1=1"}],
    })
    row = score_site(client, "fakesite", [("t", 1)], night="2026-10-12", pace=0, probe=lambda url: (200, body))
    assert row["unreadable_pages"] == 1 and row["normal_mismatch"] == 0 and row["mismatch_ids"] == []


def test_spec_table_value_on_its_own_line_is_kept_with_its_label():
    # reinvest 17384274: table «عدد غرف النوم» / «1» (structured), description «* 3 غرف نوم» (prose).
    from scrapers.common.source_reread import page_evidence
    body = ('<html><body><div><span>عدد غرف النوم</span><span>1</span></div>'
            '<div><span>عدد دورات المياه</span><span>1</span></div>'
            '<p>* 3 غرف نوم</p><p>* 3 دورات مياه</p></body></html>')
    pe = page_evidence(body)
    assert "عدد غرف النوم 1" in pe["evidence_lines"]
    r = compare_listing({"bedrooms": 1, "bathrooms": 1}, pe)
    assert r["bedrooms"] == MATCH and r["bathrooms"] == MATCH
