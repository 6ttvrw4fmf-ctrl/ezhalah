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
    ("حي السدرة", "فيلا للإيجار في روشن سدرة حي سدرة", MATCH),   # the article is not the name (eilmalriyada 18624025)
    ("حي السدرة", "حي العليا حي سدرات", MISMATCH),  # whole words only: «سدرات» is not «سدرة»
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


# ── The yearly pool serves a per-month rent under «سنوي» (owner 2026-10-25/26); the SOURCE period decides ──
# ashab 20927683 (2026-10-27 score): source rent_period monthly, price_annual 108000; index سنوي 108000.

def test_source_monthly_rent_served_yearly_compares_the_monthly_figure():
    stored = {"price_annual": 108000, "rent_period_ar": "سنوي",
              "source_rent_period": "monthly", "source_price_annual": 108000}
    assert compare_listing(stored, page("السعر 9,000 ريال شهري"))["price"] == MATCH
    assert compare_listing(stored, page("السعر 8,000 ريال شهري"))["price"] == MISMATCH
    # without the source period the same row reads as a yearly figure, as before
    assert compare_listing({"price_annual": 108000, "rent_period_ar": "سنوي"},
                           page("السعر 9,000 ريال شهري"))["price"] == MISMATCH


def test_cheap_yearly_served_x12_compares_the_sources_own_figure():
    # rent_price_annual_ar serves a «yearly» 3,000 on an apartment as 36,000; the source says annual 3000
    stored = {"price_annual": 36000, "rent_period_ar": "سنوي",
              "source_rent_period": "annual", "source_price_annual": 3000}
    assert compare_listing(stored, page("السعر 3,000 ريال سنوي"))["price"] == MATCH
    assert compare_listing(stored, page("السعر 36,000 ريال سنوي"))["price"] == MISMATCH


def test_score_site_reads_the_source_tables_period():
    stored = {"source_table": "fake_residential_listings", "listing_id": 8, "platform": "fakesite",
              "deal_ar": "إيجار", "rent_period_ar": "سنوي", "type_ar": "شقة", "price_annual": 108000}
    client = FakeClient({
        "search_listings_ar": [stored],
        "fake_residential_listings": [{"id": 8, "listing_url": "https://example.test/8",
                                       "rent_period": "monthly", "price_annual": 108000}],
    })
    html = "<html><body><p>شقة للإيجار</p><p>السعر 9,000 ريال شهري</p></body></html>"
    row = score_site(client, "fakesite", [("fake_residential_listings", 8)],
                     night="2026-10-27", pace=0, probe=lambda url: (200, html))
    assert row["fields"]["price"][MATCH] == 1 and row["fields"]["price"].get(MISMATCH, 0) == 0


def test_latin_k_after_the_figure_is_thousands():
    # tuba 21078156 (2026-10-27): page «SAR 990k», we store 990000
    assert compare_listing({"price_total": 990000}, page("السعر :", "SAR 990k"))["price"] == MATCH
    assert compare_listing({"price_total": 990000}, page("السعر :", "SAR 980k"))["price"] != MATCH
    # a «k» that starts a word, or «km», is not thousands
    assert compare_listing({"price_total": 990000}, page("السعر :", "990 km من المطار"))["price"] != MATCH


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


@pytest.mark.parametrize("area,want", [(163, PAGE_SILENT), (101, MATCH), (300, MISMATCH)])
def test_unit_inside_a_project_span_is_silence_not_a_mismatch(area, want):
    # wahadat 17399567: project page «101 - 259 م²» / «131 - 168 م²»; stored unit 163 m² (unit 9 in the payload).
    r = compare_listing({"area_m2": area}, page("101 - 259 م²", "131 - 168 م²"))
    assert r["area"] == want


def test_area_spec_row_is_kept_over_description_prose():
    # reinvest 17384293: table «مساحة العقار» / «77» (= 625,000 ÷ «سعر المتر» 8116.883); prose «147 متر مربع مع الاسطح».
    from scrapers.common.source_reread import page_evidence
    body = ('<html><body><div><span>مساحة العقار</span><span>77</span></div>'
            '<div><span>سعر المتر</span><span>8116.883</span></div>'
            '<p>- اجمالي المساحة: 147 متر مربع مع الاسطح</p></body></html>')
    pe = page_evidence(body)
    assert "مساحة العقار 77" in pe["evidence_lines"]
    assert compare_listing({"area_m2": 77}, pe)["area"] == MATCH


def test_latin_m2_spec_value_is_kept_over_description_prose():
    # akariyoun 17512660 (2026-10-13, re-read run 38361896741): spec «<strong> مساحة العقار: </strong> 578 m²»
    # and card «المساحة: 578 m²»; the description says «المساحة : 900م (30*30)». We store the structured 578.
    from scrapers.common.source_reread import page_evidence
    body = ('<html><body><ul class="detail_features"><li><strong> مساحة العقار: </strong> 578 m²</li></ul>'
            '<div class="listing-card-info-icon">المساحة:</div><div>578 m²</div>'
            '<p>الموقع : الرياض حي العقيق</p><p>المساحة : 900م (30*30)</p></body></html>')
    pe = page_evidence(body)
    assert any("578 m²" in x for x in pe["evidence_lines"])
    assert compare_listing({"area_m2": 578}, pe)["area"] == MATCH
    # Both directions: a stored figure the page never states is still a mismatch.
    assert compare_listing({"area_m2": 640}, pe)["area"] == MISMATCH


def test_a_unit_past_the_first_sixty_lines_is_still_read():
    # rakez 17539724 (2026-10-13, re-read run 38361960175): project 34830 lists its units as
    # «#Cnn» / «متاحة» / «<price> ريال» / «<rooms>» / «<area> م²»; ours, #C22 at 890,000 / 161 m², comes
    # after 60 evidence lines, and the score called the price and area wrong (backlog #124).
    from scrapers.common.source_reread import page_evidence
    rows = "".join(f'<div>#A{i}</div><div>متاحة</div><div>{1_000_000 + i * 1000:,} ريال</div><div>3</div>'
                   f'<div>{200 + i}.5 م²</div>' for i in range(40))
    ours = '<div>#C22</div><div>متاحة</div><div>890,000 ريال</div><div>3</div><div>161 م²</div>'
    pe = page_evidence(f"<html><body>{rows}{ours}</body></html>")
    r = compare_listing({"price_total": 890000, "area_m2": 161}, pe)
    assert r["price"] == MATCH and r["area"] == MATCH
    assert compare_listing({"price_total": 777000}, pe)["price"] == MISMATCH


def test_shell_page_platform_is_unreadable_not_wrong():
    # ebriza 17513425 (2026-10-13): the HTML is the site shell plus a featured ad «جدة - حي الزهراء» /
    # «الغرف 1»; our row is a الخرج / العيون villa with 6 rooms, read from ebriza's API.
    body = ("<html><head><title>منصة إبريزة العقارية</title></head><body><p>للبيع</p><p>الغرف 1</p>"
            "<p>حمامات 1</p><p>جدة - حي الزهراء- ستارز افينيو</p></body></html>")
    client = FakeClient({
        "search_listings_ar": [{"source_table": "t", "listing_id": 1, "district_ar": "العيون",
                                "bedrooms": 6, "bathrooms": 4}],
        "t": [{"id": 1, "listing_url": "https://ebriza.com.sa/for_sell/780/x/y/z"}],
    })
    row = score_site(client, "ebriza", [("t", 1)], night="2026-10-13", pace=0, probe=lambda url: (200, body))
    assert row["unreadable_pages"] == 1 and row["normal_mismatch"] == 0 and row["mismatch_ids"] == []
    # the same page on any other website is still judged
    other = score_site(client, "fakesite", [("t", 1)], night="2026-10-13", pace=0, probe=lambda url: (200, body))
    assert other["normal_mismatch"] > 0


def test_a_closed_ad_page_is_unreadable_not_wrong():
    # aqarmonthly 18842133 (2026-10-20, re-read run 39384695539 verdict=dead): the closed ad's URL serves another
    # listing's leftovers; scored as a 300 m² area MISMATCH that capped the night. aqar's own dead marker decides.
    from scrapers.common.cleanup import AQAR_DEAD_MARKERS
    alive = "<html><body><h1>شقة للإيجار في حي العارض</h1><p>المساحة 450 م²</p></body></html>"
    dead = alive.replace("</body>", f"<p>{AQAR_DEAD_MARKERS[0]}</p></body>")
    client = FakeClient({
        "search_listings_ar": [{"source_table": "t", "listing_id": 1, "district_ar": "حي العارض", "area_m2": 300}],
        "t": [{"id": 1, "listing_url": "https://sa.aqar.fm/x-6461856"}],
    })
    row = score_site(client, "aqarmonthly", [("t", 1)], night="2026-10-20", pace=0, probe=lambda url: (200, dead))
    assert row["unreadable_pages"] == 1 and row["normal_mismatch"] == 0
    live = score_site(client, "aqarmonthly", [("t", 1)], night="2026-10-20", pace=0, probe=lambda url: (200, alive))
    assert live["normal_mismatch"] > 0                     # a live page is still judged


def test_area_the_page_labels_in_its_own_payload_is_the_page_value():
    # sanadak 17502436 (2026-10-13, re-read run 38361883389): the flight payload maps its area label to
    # lotSize and carries "lotSize":760 (= what we store); the visible text has only «المساحة : 150م تقريباً».
    from scrapers.common.source_reread import page_evidence
    body = ('<html><head><meta name="description" content="المساحة : 150م تقريباً"></head><body>'
            '<p>المساحة : 150م تقريباً</p>'
            '<script>self.__next_f.push([1,"{\\"label\\":\\"area_m2\\",\\"key\\":\\"lotSize\\"},'
            '{\\"landNumber\\":\\"3/67/2\\",\\"lotSize\\":760,\\"numberBedrooms\\":3}"])</script>'
            '</body></html>')
    pe = page_evidence(body)
    assert compare_listing({"area_m2": 760}, pe)["area"] == MATCH
    assert compare_listing({"area_m2": 300}, pe)["area"] == MISMATCH
    # without the page's own label, the prose alone is what the page says
    assert compare_listing({"area_m2": 760}, page_evidence(body.replace("area_m2", "x")))["area"] == MISMATCH


@pytest.mark.parametrize("stored,text,want", [
    ("الضاحية الرابع", "أرض سكنية للبيع في حي الرابع بضاحية هجر | 437.5 م²", MATCH),
    ("الضاحية الحادي عشر", "أرض سكنية للبيع في حي الحادي عشر بضاحية هجر", MATCH),
    ("الضاحية الخامس", "ضاحية هجر(الحي الخامس)", MATCH),
    ("الضاحية الخامس", "أرض سكنية للبيع في حي الرابع بضاحية هجر", MISMATCH),
    # bossbih 18985501 (2026-10-20, re-read run 39384692527): served «ضاحية هجر(الحي الخامس)», page «الضاحية الحي الخامس»
    ("ضاحية هجر(الحي الخامس)", "نص أرض للبيع في الضاحية الحي الخامس (640/4) د", MATCH),
    ("الضاحية الخامس", "مخطط الضاحية الحي الخامس", MATCH),
])
def test_hajer_suburb_spellings_are_one_place(stored, text, want):
    # Only the SAME ordinal is the same place, in the fourth form too (a bare «الضاحية الحي X» page is not read
    # as naming a district at all, backlog #61, so the other ordinal is silence — never a match).
    other = "نص أرض للبيع في الضاحية الحي الرابع (640/4) د"
    assert compare_listing({"district_ar": "ضاحية هجر(الحي الخامس)"}, page(other, title=other))["district"] != MATCH
    # arkaan 17543658 … 17544564 (2026-10-13): served the catalog's «الضاحية X» for «حي X بضاحية هجر».
    assert compare_listing({"district_ar": stored}, page(text, title=text))["district"] == want


def test_the_district_the_page_states_in_its_own_payload_beats_the_sellers_prose():
    # mobasher 17693081 (2026-10-14, re-read run 38527021238): the payload carries
    # "neighborhoodNameAr":"حي الثقبة" (= what we store); the description says «مدينة الخبر، حي الحمراء».
    from scrapers.common.source_reread import page_evidence
    body = ('<html><head><meta name="description" content="الموقع: المنطقة الشرقية، مدينة الخبر، حي الحمراء.">'
            '</head><body><script>self.__next_f.push([1,"{\\"cityNameAr\\":\\"الخبر\\",'
            '\\"neighborhoodNameAr\\":\\"حي الثقبة\\",\\"rooms\\":2}"])</script></body></html>')
    pe = page_evidence(body)
    assert compare_listing({"district_ar": "حي الثقبة"}, pe)["district"] == MATCH
    assert compare_listing({"district_ar": "حي العقربية"}, pe)["district"] == MISMATCH
    # without the payload field, the prose is all the page says
    no_payload = page_evidence(body.replace("neighborhoodNameAr", "x"))
    assert compare_listing({"district_ar": "حي الثقبة"}, no_payload)["district"] == MISMATCH


def test_a_spec_value_in_a_sibling_element_beats_the_descriptions_dual_word():
    # hajer 17663701 (2026-10-14): REM spec «عدد غرف النوم» / «6» in sibling spans; the description lists
    # «غرفتين نوم» / «غرفتين ماستر» / «غرفتين نوم». The spec is the field; the prose dual is not the count.
    from scrapers.common.source_reread import page_evidence

    def body(n):
        return ('<html><body><ul><li>•غرفتين نوم +دورة مياه</li><li>•غرفتين ماستر</li></ul>'
                '<div class="detail rem-field-value"><strong class="rem-single-field-title">عدد غرف النوم</strong>'
                '<span class="rem-single-field-sep"> : </span>'
                f'<span class="rem-single-field-value">{n}</span></div></body></html>')
    assert compare_listing({"bedrooms": 6}, page_evidence(body(6)))["bedrooms"] == MATCH
    assert compare_listing({"bedrooms": 6}, page_evidence(body(3)))["bedrooms"] == MISMATCH


def test_a_share_link_whose_page_never_carries_the_ad_code_is_unreadable():
    # nufouth 17667724 (2026-10-14): /latest-offers?ads-N5470=1 serves the vacancy table without «5470».
    from scrapers.common.new_listings_score import page_lacks_its_ad
    table = "<html><body>جدول الشواغر | 6 غرف | حي المحمدية | 3 غرف | حي العارض</body></html>"
    assert page_lacks_its_ad("https://nufouth.com/latest-offers?ads-N5470=1", table)
    assert not page_lacks_its_ad("https://nufouth.com/latest-offers?ads-N5470=1", table + '<div id="N5470">2 غرف</div>')
    assert not page_lacks_its_ad("https://nufouth.com/latest-offers?ads-N5470=1", table.replace("6 غرف", "إعلان 5470"))
    assert not page_lacks_its_ad("https://aqar.fm/ad/5470", table)        # no code in the query: not this rule


def test_a_district_the_page_names_only_in_seller_prose_is_silence_on_prose_only_sites():
    # mobasher 17693081 (2026-10-14): we serve the API's «حي الثقبة»; the page HTML has only the seller's
    # «مدينة الخبر، حي الحمراء». On a prose-only site that is silence; elsewhere it still contradicts.
    from scrapers.common.new_listings_score import PROSE_ONLY_DISTRICT
    page = {"title": "شقة سكني في المنطقة الشرقية الخبر للبيع",
            "meta": {"description": "الموقع: المنطقة الشرقية، مدينة الخبر، حي الحمراء."}}
    stored = {"district_ar": "حي الثقبة"}
    assert "mobasher" in PROSE_ONLY_DISTRICT
    assert compare_listing(stored, page, prose_only_district=True)["district"] == PAGE_SILENT
    assert compare_listing(stored, page)["district"] == MISMATCH


def test_a_per_meter_rate_matches_the_total_the_page_prints_for_it():
    # muktamel 17584328 (2026-10-14): stored rate 420 × 690 m²; the page prints only «690 م² 289,800».
    page = {"title": "أرض سكني للبيع في حي الجامعة في ثادق", "evidence_lines": ["690 م² 289,800", "للبيع 289,800"]}
    assert compare_listing({"price_per_meter": 420, "area_m2": 690}, page)["price"] == MATCH
    assert compare_listing({"price_per_meter": 400, "area_m2": 690}, page)["price"] != MATCH


def test_wasalt_and_sanadak_are_read_from_their_own_record_not_the_shell():
    # #540: the shared probe answers a live wasalt page with an empty body → 10/10 «unreadable» every night.
    # #546: sanadak's page lists OTHER ads' areas; its own listing object is the ad.
    stored = {"source_table": "wasalt_residential_listings", "listing_id": 9, "platform": "wasalt",
              "district_ar": "حي النرجس", "deal_ar": "إيجار", "type_ar": "شقة"}
    client = FakeClient({
        "search_listings_ar": [stored],
        "wasalt_residential_listings": [{"id": 9, "listing_url": "https://wasalt.sa/en/property/x-9"}],
    })
    own = {"title": "شقة للإيجار في حي النرجس", "meta": {}, "jsonld": [],
           "evidence_lines": ["شقة للإيجار في حي النرجس"], "text_head": "شقة للإيجار في حي النرجس"}
    shell = lambda url: (200, "<html><body></body></html>")          # what the probe really returns
    row = score_site(client, "wasalt", [("wasalt_residential_listings", 9)], night="2026-10-16", pace=0,
                     probe=shell, wasalt=lambda url: own, sanadak=lambda url: None)
    assert row["decided_ads"] == 1 and row["fields"]["district"][MATCH] == 1
    row = score_site(client, "wasalt", [("wasalt_residential_listings", 9)], night="2026-10-16", pace=0,
                     probe=shell, wasalt=lambda url: None, sanadak=lambda url: None)
    assert row["unreadable_pages"] == 1 and row["normal_mismatch"] == 0


def test_muktamel_rooms_come_from_its_offer_record():
    from scrapers.common.new_listings_score import muktamel_room_lines
    got = (34519, {"offer": {"bedRoomsCount": 4, "bathroomsCount": 4}}, True)
    lines = muktamel_room_lines("https://www.muktamel.com/real-estates/34519", fetch=lambda i: got)
    assert lines == ["عدد غرف النوم 4", "عدد دورات المياه 4"]
    # 17886575 (2026-10-16): stored 4/4, the description's prose says otherwise; the offer is the ad.
    p = page(*lines, "شقة 3 غرف نوم و 2 حمام")
    out = compare_listing({"bedrooms": 4, "bathrooms": 4}, p)
    assert out["bedrooms"] == MATCH and out["bathrooms"] == MATCH
    assert muktamel_room_lines("https://www.muktamel.com/real-estates/1", fetch=lambda i: None) == []
    assert muktamel_room_lines("https://example.test/x", fetch=lambda i: got) == []


def test_dwelleo_bedrooms_come_from_its_api_record_not_the_title():
    from scrapers.common.new_listings_score import dwelleo_room_lines
    villa = {"id": 1, "bedrooms": 5, "property_type": {"name": "فيلا"}}
    url = "https://www.dwelleo.sa/ar/properties/for-sale/villa/riyadh/x/villa-slug"
    lines = dwelleo_room_lines(url, fetch=lambda slug: villa if slug == "villa-slug" else None)
    assert lines == ["عدد غرف النوم 5"]
    # 20013764 (2026-10-24, re-read 40078610599): record 5 bedrooms, title prose «فيلا 4 غرف».
    p = page(*lines, "فيلا 4 غرف للبيع")
    assert compare_listing({"bedrooms": 5}, p)["bedrooms"] == MATCH
    assert compare_listing({"bedrooms": 3}, p)["bedrooms"] == MISMATCH
    # A Building's count is its room stock: we store none, so the record says nothing to compare.
    bld = {"id": 2, "bedrooms": 30, "property_type": {"name": "مبني"}}
    assert dwelleo_room_lines(url, fetch=lambda slug: bld) == []
    assert dwelleo_room_lines(url, fetch=lambda slug: None) == []
    assert dwelleo_room_lines("https://example.test/x", fetch=lambda slug: villa) == []


def test_wasalt_structured_rows_are_read_as_labelled_lines():
    # 17926766 (2026-10-16, re-read 38925580390): builtUpArea «96» = ours, while the REGA deed text names a land share.
    from scrapers.common.af_score import wasalt_page
    data = {"props": {"pageProps": {"propertyDetailsV3": {
        "regaMojDesc": "حي قرطبة بمدينة الرياض  مساحة الوحدة من الأرض 51.52 متر",
        "attributes": [{"key": "noOfBedrooms", "name": "Bedrooms", "value": 3},
                       {"key": "builtUpArea", "name": "Built-Up Area", "value": "96", "unit": "SQM"}]}}}}
    p = wasalt_page("https://wasalt.sa/en/property/x", fetch=lambda url: (data, 200, 0))
    out = compare_listing({"area_m2": 96, "bedrooms": 3}, p)
    assert out["area"] == MATCH and out["bedrooms"] == MATCH
    assert compare_listing({"area_m2": 120}, p)["area"] == MISMATCH


def test_wasalt_photo_classifier_labels_are_not_the_ads_statement():
    from scrapers.common.af_score import wasalt_page
    data = {"props": {"pageProps": {"propertyDetailsV3": {"classificationData": [
        {"classificationScore": 0.99, "classificationName": "kitchen", "name": "a.jpg"}]}}}}
    p = wasalt_page("https://wasalt.sa/en/property/x", fetch=lambda url: (data, 200, 0))
    assert not any("kitchen" in x for x in p["evidence_lines"])


def test_sanadak_structured_area_beats_its_approximate_prose():
    # 17944027 (2026-10-16): lotSize 105.6 (page «مساحة العقار 105.6 م²»), description «المساحة : 120م تقريبا».
    from scrapers.common.af_score import sanadak_page
    o = {"title": "شقة للإيجار في الرياض قرطبة 2 غرفة", "lotSize": 105.6, "numberBedrooms": 2,
         "description": "الموقع : الرياض حي قرطبة\nالمساحة : 120م تقريبا"}
    p = sanadak_page("https://sanadak.sa/property-details/x", fetch=lambda url: (o, "", url))
    assert compare_listing({"area_m2": 105, "bedrooms": 2}, p)["area"] == MATCH

def test_three_to_ten_written_as_words_on_the_keyword_line():
    # aljassim 17947950 (2026-10-16): the structured room cell «أربع غرف», stored 4, scored MISMATCH because the
    # description's dual «غرفتين نوم» was the only figure the scorer could read.
    p = page("فيلا جاهز للايجار في الخالدية أربع غرف", "(غرفة نوم رئيسية ماستر مع دورة مياة-صالة غرفتين نوم مع دورة مياة)")
    assert compare_listing({"bedrooms": 4}, p)["bedrooms"] == MATCH
    assert compare_listing({"bedrooms": 5}, page("أربع غرف"))["bedrooms"] == MISMATCH
    # A word that only CONTAINS a number word is not one («مستودع» holds «ست»).
    assert compare_listing({"bedrooms": 6}, page("غرف مستودع"))["bedrooms"] != MATCH


def test_every_worded_figure_on_a_keyword_line_counts():
    # bossbih 18945171 (2026-10-20, re-read run 39384692527): the ad's own «غرفتين نوم», then the related-ads
    # table's «المساحة194مأربع غرف» for another unit. Stored 2 = the ad's own figure; 3 is on no line.
    p = page("شقة للايجار في حي الصحافه ب الدور الاول", "▫️غرفتين نوم\n▫️مطبخ\nحي الصحافه\nالمساحة194مأربع غرف")
    assert compare_listing({"bedrooms": 2}, p)["bedrooms"] == MATCH
    assert compare_listing({"bedrooms": 3}, p)["bedrooms"] == MISMATCH


def test_tuba_street_width_comes_from_its_rega_record():
    """#621 (2026-10-18): tuba 18258569 stores the REGA licence streetWidth 25; the page prose says «شارع 20».
    The score must read the licence (structured beats prose), and an unreadable record adds nothing."""
    import json
    from scrapers.common import new_listings_score as nls
    rec = {"slug": "villa-for-sale-in-riyadh-61",
           "advalidatorinfo": {"response_data": json.dumps({"streetWidth": 25})}}
    nls._TUBA_RECORDS = None
    assert nls.tuba_rega_lines("https://tuba.com.sa/property/villa-for-sale-in-riyadh-61",
                               fetch=lambda: [rec]) == ["عرض الشارع 25"]
    assert nls.tuba_rega_lines("https://tuba.com.sa/property/other-slug", fetch=lambda: [rec]) == []
    nls._TUBA_RECORDS = None
    assert nls.tuba_rega_lines("https://tuba.com.sa/property/x", fetch=lambda: 1 / 0) == []
    nls._TUBA_RECORDS = None
    lines = nls.tuba_rega_lines("https://tuba.com.sa/property/villa-for-sale-in-riyadh-61", fetch=lambda: [rec])
    assert nls._cmp_number(25, lines + ["شارع 20 متر"], " ".join(lines), r"عرض الشارع") == nls.MATCH
    nls._TUBA_RECORDS = None


def test_a_share_link_page_is_read_only_inside_the_card_that_carries_its_code():
    # nufouth 18610653 (2026-10-19, re-read run 39215530774): the vacancy table carries our card («الدمام ·
    # حي الخالدية الجنوبية - N4175») beside other units with their own areas; the whole page scored our
    # 236 m² against «المساحة 400 م²» of a unit in المحمدية. Only the card with the code is this ad.
    from scrapers.common.new_listings_score import scope_to_its_ad
    from scrapers.common.source_reread import page_evidence
    card = ('<div class="col-6 col-md-4 d-flex card-item " data-index="{i}"><div>{d}</div><div>{a}</div>'
            '<a onclick="openDetailsModal(\'{c}\')"></a></div>')
    table = ("<html><body><h1>جدول الشواغر</h1>"
             + card.format(i=1, d="الدمام حي المحمدية - N5105", a="المساحة 400 م²", c="N5105")
             + card.format(i=2, d="الدمام حي الخالدية الجنوبية - N4175", a="", c="N4175")
             + card.format(i=3, d="الدمام حي الياسمين - N3001", a="المساحة 300 م²", c="N3001")
             + "</body></html>")
    url = "https://nufouth.com/latest-offers?ads-N4175=1"
    ours = scope_to_its_ad(url, table)
    assert "الخالدية" in ours and "المحمدية" not in ours and "الياسمين" not in ours
    got = compare_listing({"area_m2": 236, "district_ar": "حي الخالدية الجنوبية"}, page_evidence(ours))
    assert got["area"] != MISMATCH and got["district"] == MATCH
    assert compare_listing({"area_m2": 236}, page_evidence(table))["area"] == MISMATCH   # the whole page misreads
    assert scope_to_its_ad("https://aqar.fm/ad/4175", table) == table                   # no code: unchanged
    assert scope_to_its_ad(url, "<html>جدول N4175 بلا بطاقات</html>") == "<html>جدول N4175 بلا بطاقات</html>"


def test_a_number_first_chip_is_read_with_its_own_label():
    # abaad 18623200 (2026-10-19, re-read run 39215583152): «<strong>6</strong> حمام», «<strong>8</strong> غرف نوم»,
    # «<strong>3</strong> صالات», past the 1,500-character text head. The visible-text split glued each label to
    # the NEXT chip's figure («حمام 8», «غرف نوم 3») and our 8 bedrooms / 6 bathrooms (= the API) scored wrong.
    from scrapers.common.source_reread import page_evidence
    chip = '<div class="chip"><i class="fa-solid fa-{i}"></i>\n <strong>{n}</strong> {l}\n</div>'
    body = ("<html><body><p>" + "نص " * 600 + "</p><div>عدد الغرف</div><div>11</div>"
            + chip.format(i="shower", n=6, l="حمام") + chip.format(i="bed", n=8, l="غرف نوم")
            + chip.format(i="couch", n=3, l="صالات") + "</body></html>")
    got = compare_listing({"bedrooms": 8, "bathrooms": 6}, page_evidence(body))
    assert got["bedrooms"] == MATCH and got["bathrooms"] == MATCH
    wrong = compare_listing({"bedrooms": 3, "bathrooms": 9}, page_evidence(body))
    assert wrong["bathrooms"] == MISMATCH                      # a figure no chip states is still wrong


def test_a_price_written_in_thousands_is_the_same_figure():
    # akariyoun 18605450 (2026-10-19, re-read run 39215534393): «السعر : 150 الف ريال», stored 150000.
    page = {"title": "مستودع للايجار في الغنامية", "evidence_lines": ["المساحة : 605 متر السعر : 150 الف ريال"],
            "text_head": "السعر | المساحة: | 396 m²"}
    assert compare_listing({"price_annual": 150000}, page)["price"] == MATCH
    assert compare_listing({"price_annual": 160000}, page)["price"] != MATCH         # another figure is not ours
    assert compare_listing({"price_total": 1500000}, page)["price"] != MATCH         # 150 الف is not 1.5 million


def test_dwelleo_bathrooms_and_livings_come_from_its_api_record_not_the_prose():
    # backlog #890 (2026-10-26, dry re-score 40288432059): 19471735 «ست غرف نوم وخمس حمامات» (record bathrooms 5)
    # and 19471811 «صالة مع بلكونة … شارع 30» (record livings 1) were scored as wrong.
    from scrapers.common.new_listings_score import dwelleo_room_lines
    apt = {"id": 3, "bedrooms": 6, "bathrooms": 5, "livings": 1, "floor_number": 0, "property_type": {"name": "شقة"}}
    url = "https://dwelleo.sa/ar/properties/6-bedroom-apartment"
    lines = dwelleo_room_lines(url, fetch=lambda slug: apt)
    assert lines == ["عدد غرف النوم 6", "عدد الحمامات 5", "عدد الصالات 1"]
    p = page(*lines, "وتضم ست غرف نوم وخمس حمامات", "صالة مع بلكونة واجهة شرقية على شارع 30")
    assert compare_listing({"bathrooms": 5}, p)["bathrooms"] == MATCH
    assert compare_listing({"bathrooms": 3}, p)["bathrooms"] == MISMATCH
    assert compare_listing({"living_rooms": 1}, p)["living_rooms"] == MATCH
    assert compare_listing({"living_rooms": 4}, p)["living_rooms"] == MISMATCH
    # The floor is never restated: the page does not show it and the record's 0 is ambiguous.
    assert not any("الطابق" in x or "الدور" in x for x in lines)
