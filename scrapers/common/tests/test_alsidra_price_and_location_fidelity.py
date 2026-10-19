"""OFFLINE barrier for scrapers/alsidra/run.py — the real parsers, fed real alsidra.com.sa payloads.

No network, no database. Everything here executes the REAL functions in scrapers/alsidra/run.py;
nothing is reimplemented or copied. The strings are verbatim production output captured from
/?rest_route=/wp/v2/%D8%B9%D9%82%D8%A7%D8%B1%D8%A7%D8%AA on 2026-09-20 (X-WP-Total=46):
`RAW_21153` is the untouched `content.rendered` HTML, and the `BODY_*`/`TITLE_*` blocks are exactly
what run.html_text() returns for those posts — so the parse functions see the same bytes production
hands them, not a shape this test chose.

to_catalog / find_district_in_text are the only things patched, because they read the location
catalog out of the database. CATALOG below is not invented: every entry is the value real
to_catalog() returned for that exact string against production loc_catalog_city (4,582 rows), and
the names it deliberately OMITS (القويعية unhinted, الفويلق unhinted) are names production also
fails to resolve without a region hint — that twin behaviour is what two of these tests turn on.

WHAT THIS BARRIER IS FOR. Each test names the mutation it must fail on. The central one is
test_a_ratio_threshold_cannot_replace_the_equality_discriminator: the tempting way to catch
alsidra's per-metre-figure-in-the-price-field bug is "if price/area looks too small, multiply".
Production contains a row that defeats that (farm land genuinely priced at 15.74 ﷼/m² with the
total spelled out in words), so the discriminator is exact equality between the source's own two
numbers. Swap it for any threshold and that row inflates 22,000-fold, silently, on a live card.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alsidra import run as R  # noqa: E402

# ── verbatim production payloads ──────────────────────────────────────────────────────────────────

# `content.rendered` for post 21153, byte-for-byte. Exercises html_text(): <br /> must become a line
# break (every price parse is line-scoped) and `&#8211;` must be unescaped, because that en-dash is
# the separator _loc_segments() splits «غرب عين دار – الاحساء» on.
RAW_21153 = (
    '<p>أرض زراعية للبيع في غرب عين دار بالاحساء،</p>\n'
    '<p>تقع على الطريق السريع، بمساحة 325000 م²<br />\n'
    'تقع في غرب عين دار ، وتتميز بموقع مناسب للاستثمار على اربعة شوارع بعرض 200 مترًا شمالا ،و 50 '
    'مترًا شرقًا وغربًا وجنوبًا بمساحة إجمالية تبلغ 325000م².</p>\n'
    '<p>تفاصيل الأرض<br />\n'
    'الموقع: غرب عين دار &#8211; الاحساء<br />\n'
    'نوع العقار: أرض زراعية<br />\n'
    'المساحة: 325,000 م²<br />\n'
    'رقم القطعة: 2<br />\n'
    'رقم المخطط: 3374<br />\n'
    'عرض الشارع: 200م × 50م × 50م × 50م<br />\n'
    'الواجهة: اربع جهات<br />\n'
    'سعر البيع للمتر : 50 ريال<br />\n'
    'وصل السوم للمتر : 32 ريال<br />\n'
    'فرصة تملك أرض زراعية في الأحساء</p>\n'
    '<p>تتميز بوجود ترخيص مزرعة دواجن , يوجد بئر , واصل الكهرب للارض الليي جنبها</p>\n'
    '<p>سعر البيع: 50 ريال للمتر</p>\n'
    '<p>للاستفسار عن تفاصيل الأرض الزراعية للبيع في الأحساء أو معرفة المزيد من المعلومات، يمكن '
    'التواصل مع السدرة العقارية.</p>\n'
)
# The TITLE contradicts the body: 660 m² against a body that states 325,000 m² four times, with
# plot and plan numbers. A copy-paste leftover from a previous ad.
TITLE_21153 = 'أرض زراعية للبيع في غرب عين دار بالاحساء بمساحة 660 متر مربع'

# 21243 — fave_property_price is 1100 and the ad says why: it is the PER-METRE price.
TITLE_21243 = 'ارض سكنية للبيع بأساسات جاهزة للبناء في حي الامواج بالخبر'
BODY_21243 = "\n".join([
    'ارض سكنية للبيع بأساسات جاهزة للبناء في حي الامواج بالخبر',
    ' الميزة التنافسية: الأرض مبني عليها أساسات فيلا وجاهزة تماماً، وتتوفر معها رخصة البناء ! 💡',
    ' الموقع الاستراتيجي: مدينة الخبر – حي الأمواج .',
    ' المساحة: 420 متر مربع (مساحة مثالية لتصميم فيلا راقية).',
    ' الواجهة: تقع على شارع بعرض 16 متر غربي .',
    ' بيانات المخطط: مخطط رقم 480 ش خ | قطعة رقم 204/1',
    ' فرصة استثنائية بسعر منافس جداً للمتر في هذه المنطقة:',
    ' سعر البيع للمتر: 1,100 ريال فقط! 💰',
    ' 🏡 مكتب السدرة العقارية تابعونا للمزيد من الفرص العقارية الذكية:',
])

# 21229 — 22,237.95 m² of farm land for a stated 350,000 ﷼ = 15.74 ﷼/m². The figure a threshold
# would "repair". «آخر سوم» right under it is a bid.
BODY_21229 = "\n".join([
    ' فرصة استثمارية وزراعية لا تعوض في منطقة القصيم! يعلن مكتب السدرة العقارية عن عرض أرض زراعية',
    ' الموقع: عقلة الصقور – منطقة القصيم.',
    ' إجمالي المساحة: 22,237.95 متر مربع.',
    ' الواجهة والشوارع: تقع على شارعين بعرض 30م × 20م (واجهة شمالية غربية) لسهولة الدخول والخروج.',
    ' استراحة متكاملة ومؤثثة بالكامل.',
    ' عداد كهرباء مستقل بقوة (100) أمبير جاهز للتشغيل.',
    ' 💰 تفاصيل السعر والسوم:',
    ' سعر البيع النهائي: 350,000 ريال سعودي (ثلاثمائة وخمسون ألف ريال).',
    ' آخر سوم (أعلى سوم): 230,000 ريال سعودي.',
])

# 21177 — the ask is 900,000; the 800,000 under it is the highest bid received.
BODY_21177 = "\n".join([
    ' يعلن مكتب السدرة العقارية عن توفر فيلا فاخرة للبيع في مدينة المبرز بمحافظة الأحساء',
    ' المساحة الإجمالية: 400 متر مربع.',
    ' الواجهة: شمالية على شارع بعرض 12 متر.',
    ' الدور الأول: يضم 4 غرف نوم (منها غرفة ماستر رئيسية بدورة مياه خاصة) بالإضافة',
    ' إلى دورتين مياه تخدم بقية الغرف.',
    ' تفاصيل السعر والبيع:',
    ' سعر البيع المطلوب: 900,000 ريال سعودي (تسعمائة ألف ريال).',
    ' أعلى سوم واصل: 800,000 ريال سعودي.',
])

# 21156 — «سعر البيع: على السوم» (no figure), a 1200 ﷼/m² bid, and a 1300 ﷼/m² ask.
BODY_21156 = "\n".join([
    'ارض سكنية للبيع في حي الجامعيين،',
    'الموقع: حي الجامعيين – الأحساء',
    'المساحة: 660م²',
    'عرض الشارع: 30 مترًا',
    'سعر البيع: على السوم',
    'وصل السوم : 1200 للمتر',
    'سعر البيع: 1300 للمتر',
])

# 21210 — the office's own property_city term is the bare «الرياض» (a real catalog city), while the
# ad's location line and its property_area term both say القويعية, ~250 km away.
BODY_21210 = "\n".join([
    ' لكل الباحثين عن فرص استثمارية ناجحة أو بناء سكن مستقبلي، يعلن مكتب السدرة العقارية عن عرض',
    ' 📌 تفاصيل ومواصفات العقار:',
    ' الموقع الجغرافي: القويعية – منطقة الرياض.',
    ' المساحة الإجمالية: 630 متر مربع',
    ' 💰 سعر البيع:',
    ' السعر: على السوم (نستقبل سوماتكم الجادة).',
])
TITLE_21210 = 'أرض سكنية مميزة للبيع في القويعية بالرياض (مخطط 1029)'

# 21181 — no location line at all. «مميزات الموقع والخدمات:» is marketing prose that merely contains
# the word «الموقع»; treating it as the location statement fed whole clauses to to_catalog.
BODY_21181 = "\n".join([
    ' أرض للبيع في حائل بقعاء (قرية الشعلانية) بمساحة 300 متر',
    ' المساحة الإجمالية: 300 متر مربع.',
    ' مميزات الموقع والخدمات: تتميز الأرض بوقوعها في منطقة مأهولة، حيث تتوفر في قرية الشعلانية '
    'كافة الخدمات الأساسية والمرافق الحكومية التي تجعلها خياراً ممتازاً للبناء أو الاستثمار.',
    ' السعر: 28,000 ريال سعودي فقط.',
])

# Term tables exactly as /wp/v2/<taxonomy> serves them (ids are install-local, which is why run.py
# fetches them instead of hardcoding them).
TERMS = {
    "property_type": {107: "ارض", 145: "ارض سكنية", 149: "ارض تجارية", 146: "ارض زراعية",
                      106: "فيلا", 135: "بيت شعبي", 153: "ارض مرفق تعليمي"},
    "property_status": {115: "للبيع", 116: "للايجار", 117: "مزاد"},
    "property_city": {122: "الاحساء", 128: "القصيم", 129: "الرياض", 126: "حائل"},
    "property_area": {131: "القويعية", 121: "الاحساء"},
    "property_feature": {118: "كهرباء", 119: "مياه", 120: "مصعد", 150: "صرف صحي"},
}

# Every value below is what production to_catalog() actually returned for that exact string.
# (city_id, region_id). Names production cannot resolve WITHOUT a region hint are absent on purpose.
CATALOG = {
    "الاحساء": (3677, 5), "الأحساء": (3677, 5), "المبرز": (2748, 5), "الخبر": (31, 5),
    "بقعاء": (2370, 8), "الشعلانية": (2379, 8), "عقلة الصقور": (2988, 4),
    "الرياض": (3, 1), "لبخة": (822, 1), "رياض الخبراء": (2467, 4), "رفحاء": (2256, 9),
}
REGIONS = {"منطقة الرياض": 1, "منطقة القصيم": 4, "منطقة حائل": 8, "حائل": 8, "القصيم": 4,
           "منطقة الحدود الشمالية": 9}
# Twin names: unresolvable bare, resolvable once the ad's own region narrows them.
HINTED = {("القويعية", 1): (9001, 1), ("الفويلق", 4): (2631, 4)}


def _to_catalog(city_ar, region_hint=None):
    """Stand-in for arabic_location.to_catalog with production's measured answers."""
    if not city_ar:
        return None, None
    name = city_ar.strip()
    if (name, region_hint) in HINTED:
        return HINTED[(name, region_hint)]
    if name in CATALOG:
        return CATALOG[name]
    if name.startswith("منطقة "):
        return None, REGIONS.get(name)
    if name in REGIONS:
        return None, REGIONS[name]
    return None, region_hint


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", _to_catalog)
    monkeypatch.setattr(R, "city_ar_for",
                        lambda cid: next((k for k, v in CATALOG.items() if v[0] == cid),
                                         "القويعية" if cid == 9001 else
                                         ("الفويلق" if cid == 2631 else None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)


def _post(pid, body, title, *, meta_price=None, types=(145,), status=(115,),
          city=(), area=(), feature=(), media=0):
    """A WP post in the shape /wp/v2/عقارات serves, with the fields run.map_listing reads."""
    meta = {}
    if meta_price is not None:
        meta["fave_property_price"] = [str(meta_price)]
    return {
        "id": pid, "status": "publish", "link": f"https://alsidra.com.sa/property/{pid}/",
        "title": {"rendered": title}, "content": {"rendered": body},
        "featured_media": media, "property_type": list(types),
        "property_status": list(status), "property_city": list(city),
        "property_area": list(area), "property_feature": list(feature),
        "property_meta": meta,
    }


def _plain(pid, body, title, **kw):
    """map_listing over already-extracted text. html_text is idempotent on tag-free text, so the
    parsers receive exactly the string given — see test_html_text_* for the HTML path itself."""
    return R.map_listing(_post(pid, body, title, **kw), TERMS, {})


# ── the price discriminator ───────────────────────────────────────────────────────────────────────

def test_a_ratio_threshold_cannot_replace_the_equality_discriminator():
    """THE mutation this file exists to fail on: replacing the equality test with "price/area looks
    too small → it must be per-metre". No floor can separate these two production rows.

        21243: meta 1100, area 420      → 2.62 ﷼/m², and 1100 IS the per-metre price
        21229: meta 350000, area 22237  → 15.74 ﷼/m², and 350000 IS the total

    A floor below 2.62 misses 21243 (a 420× understatement ships). Any floor above 15.74 "repairs"
    21229 into 7,783,282,500 ﷼. The source's own two numbers being EQUAL is what distinguishes them.
    """
    # 21243 — no stated total; meta == the stated per-metre price ⇒ it IS the rate, no total.
    assert R.resolve_price(None, [1100], 1100) == (None, 1100, "per_metre")
    # 21229 — a stated total, cheaper per metre than 21243's per-metre figure. Untouched.
    assert R.resolve_price(350000, [], 350000) == (350000, None, "stated_total")

    # THE assertion that no threshold can satisfy. Identical meta_price and identical area as the
    # 21243 call above — only `ppms` differs. A ratio test ignores `ppms` entirely, so it is forced
    # to give both calls the same answer, and one of the two must then be wrong. Storing a
    # source-published 1100 verbatim when the ad labels nothing per-metre is the rule
    # (PRICE = SOURCE; a plausibility gate that hides a published price is the regression).
    assert R.resolve_price(None, [], 1100) == (1100, None, "meta_total")

    # 21153's real shape: a per-metre price IS stated (50) but the office's own total is the meta
    # field, and the two are not equal, so the total is published as-is. At 50 ﷼/m² exactly, this is
    # the row any "too cheap per metre" floor of 50-or-more turns into 5.3 trillion riyals.
    assert R.resolve_price(None, [50], 16250000) == (16250000, 50, "meta_total")
    # and with a per-metre figure ALSO present, a stated total still wins outright.
    assert R.resolve_price(16250000, [50], 16250000)[0] == 16250000


def test_the_per_metre_figure_is_never_stored_as_the_total():
    row, _, why = _plain(21243, BODY_21243, TITLE_21243, meta_price=1100, city=(),
                         types=(145,))
    assert why == ""
    assert row["area_m2"] == 420
    assert row.get("price_total") is None, "1100 is the per-metre figure, and 462,000 is not the ad's"
    assert row["price_per_meter"] == 1100
    assert row["additional_info"]["price_provenance"] == "per_metre"


def test_a_stated_total_outranks_a_stale_per_metre_price():
    """21171 publishes both: a total of 48,000 (in words AND digits, matching its meta field) and a
    per-metre price of 78 ﷼ which multiplies out to 37,674. Reversing the order loses 10,326 ﷼."""
    assert R.resolve_price(48000, [78], 48000) == (48000, 78, "stated_total")


def test_a_bid_is_never_read_as_the_asking_price():
    total, ppms = R.parse_prices(BODY_21177)
    assert total == 900000, "«أعلى سوم واصل: 800,000» is the highest bid received, not the ask"
    assert 800000 not in ppms

    total2, ppms2 = R.parse_prices(BODY_21156)
    assert 1200 not in ppms2, "«وصل السوم : 1200 للمتر» is a bid"
    assert ppms2 == [1300]
    assert total2 is None, "«سعر البيع: على السوم» publishes no figure"

    total3, ppms3 = R.parse_prices(R.html_text(RAW_21153))
    assert 32 not in ppms3, "«وصل السوم للمتر : 32 ريال» is a bid"
    assert ppms3 == [50]

    # On the three rows above the «سعر» requirement in the label patterns already excludes the bid,
    # so BID_RE is belt-and-braces there. This is the shape where it is the ONLY thing standing
    # between a bid and the card, and it is a phrasing this office already uses in pieces
    # («سعر البيع: على السوم» on 21156, «وصل السوم : 1200» right under it):
    assert R.parse_prices("السعر: على السوم، وصل السوم إلى 230,000 ريال")[0] is None
    assert R.parse_prices("سعر البيع: على السوم — أعلى سوم 800,000 ريال")[0] is None


def test_no_published_figure_means_null_not_a_fabricated_price():
    row, _, why = _plain(21210, BODY_21210, TITLE_21210, city=(129,), area=(131,))
    assert why == ""
    assert row["price_total"] is None
    assert row["additional_info"]["price_provenance"] == "no_price_published"


def test_a_word_only_total_restated_in_digits_is_read():
    """«سعر البيع : ثمانية واربعون الف ريال (48000 ريال)» — the gap between label and digits spans
    an Arabic word numeral. Requiring the number to follow the colon directly loses this price."""
    total, _ = R.parse_prices("سعر البيع : ثمانية واربعون الف ريال (48000 ريال)")
    assert total == 48000


def test_a_bare_label_line_does_not_borrow_the_next_lines_digits():
    """«💰 تفاصيل سعر البيع:» is a heading. An unbounded gap would let it swallow whatever number
    appears next — on 21177 that is the 800,000 bid line."""
    total, _ = R.parse_prices("💰 تفاصيل سعر البيع:\n أعلى سوم واصل: 800,000 ريال سعودي.")
    assert total is None


# ── refusals ──────────────────────────────────────────────────────────────────────────────────────

def test_an_auction_is_skipped_and_counted():
    """20 of the 46 posts carry property_status «مزاد» — third-party auctions on soum.tech with no
    price, area or single subject property. Publishing them as listings would be fabrication."""
    row, _, why = _plain(21128, 'مزاد فلوة يطرح باقة من الأصول العقارية في الدمام ورأس تنورة.',
                         'مزاد فلوة', status=(117,), types=(149,))
    assert row is None
    assert why == "auction", "the reason must reach end_run(notes=...) so an empty run says why"


def test_a_sold_ad_is_skipped():
    row, _, why = _plain(21243, BODY_21243 + "\n تم البيع بحمد الله", TITLE_21243, meta_price=1100)
    assert row is None and why == "sold_or_rented"


def test_an_unmappable_type_is_skipped_rather_than_folded_into_a_neighbour():
    """«بيت شعبي» and «ارض مرفق تعليمي» have no canonical type. Villa / Commercial Land would be a
    guess, so they are refused and counted — the ask-first rule, not a silent approximation."""
    for term in (135, 153):
        row, _, why = _plain(21243, BODY_21243, TITLE_21243, types=(term,))
        assert row is None
        assert why.startswith("type_unmapped"), why
        assert TERMS["property_type"][term] in why, "the tally must name the term, not just count it"


def test_the_source_spellings_that_the_shared_map_misses_do_map():
    """map_type_exact has no normalization pass, so this source's bare-alif spellings need the
    overrides dict. Deleting it silently drops 23 of the 26 sellable listings as type_unmapped."""
    assert R.normalize.map_type_exact("ارض سكنية", R.TYPE_OVERRIDES) == "Residential Land"
    assert R.normalize.map_type_exact("ارض تجارية", R.TYPE_OVERRIDES) == "Commercial Land"
    assert R.normalize.map_type_exact("ارض زراعية", R.TYPE_OVERRIDES) == "Farm"
    assert R.normalize.category_for_type("Commercial Land").lower() == "commercial"


# ── location: never broader than the ad ───────────────────────────────────────────────────────────

def test_the_region_capital_is_not_published_for_a_listing_in_a_smaller_town():
    """21210's property_city term is the bare «الرياض» — a real catalog city — but its own location
    line says «القويعية – منطقة الرياض» and its property_area term says القويعية. Trusting the
    taxonomy term (or the title, «في القويعية بالرياض») puts a القويعية plot ~250 km away, in front
    of every الرياض-city search. The location line wins when it exists."""
    row, _, why = _plain(21210, BODY_21210, TITLE_21210, city=(129,), area=(131,))
    assert why == ""
    assert row["city_ar"] == "القويعية"
    assert row["city_id"] != CATALOG["الرياض"][0]
    assert row["region_id"] == 1, "the region is still recorded — precision is kept, not discarded"


def test_a_bare_region_name_loses_to_the_town_beside_it():
    """«حائل – بقعاء (الشيحية)»: حائل is one of the 13 region names, بقعاء is a catalog city ~100 km
    from حائل city. Taking the first resolvable segment publishes the wrong one."""
    cands, regions = R._loc_segments("الموقع: حائل – بقعاء (الشيحية).")
    assert cands.index("بقعاء") < cands.index("حائل")
    assert R.resolve_city(None, "الموقع: حائل – بقعاء (الشيحية).", "")[2] == "بقعاء"


def test_the_most_specific_administrative_prefix_wins():
    """«منطقة القصيم – محافظة الأسياح – مركز البعيثة» runs general→specific, the opposite of
    «حي النور – مدينة الدمام». Reading order alone gets one of the two wrong."""
    cands, regions = R._loc_segments(
        "الموقع الجغرافي: منطقة القصيم – محافظة الأسياح – مركز البعيثة.")
    assert cands == ["البعيثة", "الأسياح"], cands
    assert regions == ["منطقة القصيم"], "a «منطقة» segment is a hint, never a city candidate"


def test_a_region_only_ad_yields_no_city_rather_than_its_capital():
    """to_catalog returns (None, region_id) for a region label. That must stay a skip."""
    cid, rid, ar = R.resolve_city(None, "الموقع: مخطط العدل السليمي.", "أرض ركنية بمخطط 1532")
    assert cid is None and ar is None


def test_the_region_hint_is_collected_even_when_the_label_carried_the_word():
    """21257's line is «المنطقة: القصيم – الفويلق»: «منطقة» is the LABEL, so «القصيم» arrives as a
    bare segment — and الفويلق is a twin name that resolves to nothing without its region. Losing
    the hint here loses the whole listing."""
    cid, rid, ar = R.resolve_city("القصيم", "المنطقة: القصيم – الفويلق.", "")
    assert ar == "الفويلق" and rid == 4


def test_a_marketing_sentence_is_not_the_location_statement():
    """«مميزات الموقع والخدمات: تتميز الأرض بوقوعها في منطقة مأهولة…» merely contains «الموقع».
    Accepting it fed whole clauses to to_catalog and dropped a listing that resolves without it."""
    assert R._location_line(BODY_21181) is None
    row, _, why = _plain(21181, BODY_21181, 'أرض للبيع في حائل بقعاء (قرية الشعلانية)', city=(126,))
    assert why == "" and row["city_id"] is not None


def test_the_brokerages_own_name_never_reaches_the_district_lookup(monkeypatch):
    """«حي السدرة» is a real catalog district of الرياض and «مكتب السدرة العقارية» appears in every
    single ad, so the boilerplate matched as the listing's district on two Riyadh-region rows."""
    seen = []

    def spy(text, city_id):
        seen.append(text or "")
        return None

    monkeypatch.setattr(R, "find_district_in_text", spy)
    # Their titles are marketing copy and do carry the office name, so it must be stripped from the
    # text the lookup sees — not merely absent from it by luck of which fields are searched.
    _plain(21210, BODY_21210, "مكتب السدرة العقارية يقدم: أرض سكنية في القويعية بالرياض",
           city=(129,), area=(131,))
    assert seen, "the district lookup must actually be attempted"
    assert any("القويعية" in t for t in seen), "the real place names must still reach it"
    assert not any("السدرة" in t for t in seen), seen


# ── amenities: silence is NULL ─────────────────────────────────────────────────────────────────────

def test_silence_is_null_not_false():
    """The four outcomes. An amenity the ad never mentions must be ABSENT from the row — an explicit
    False writes «لا يوجد مصعد» into an Advanced-Filter answer the source never gave."""
    row, _, _ = _plain(21229, BODY_21229, 'أرض زراعية مميزة للبيع في عقلة الصقور بالقصيم',
                       meta_price=350000, types=(146,))
    for col in ("elevator", "parking", "maid_room", "driver_room", "optical_fibers",
                "air_conditioner", "balcony_terrace"):
        assert col not in row, f"{col} is unmentioned — it must be NULL, not False"
    assert row["furnished"] is True, "«استراحة متكاملة ومؤثثة بالكامل» names it"
    assert all(v is not False for k, v in row.items() if k in
               ("elevator", "parking", "furnished", "kitchen"))


def test_a_named_feature_term_fills_a_gap_but_never_overrides_a_negation():
    """property_feature «مصعد» is the source naming an elevator → True where the prose is silent.
    It must not overwrite an explicit «غير» in the prose, which is the source saying no."""
    row, _, _ = _plain(21177, BODY_21177, 'فيلا للبيع', meta_price=900000, types=(106,),
                       feature=(120,), city=(122,))
    assert row["elevator"] is True

    row2, _, _ = _plain(21177, BODY_21177 + "\n لا يوجد مصعد في الفيلا.", 'فيلا للبيع',
                        meta_price=900000, types=(106,), feature=(120,), city=(122,))
    assert row2["elevator"] is False, "the prose negation is the source's own answer"


def test_features_without_a_column_are_kept_not_dropped():
    """كهرباء / مياه / صرف صحي have no column in the row schema. They are the most commonly stated
    facts on this source (22 / 9 / 7 of 46) and go to additional_info rather than being discarded
    or forced into a neighbouring column."""
    row, _, _ = _plain(21229, BODY_21229, 'أرض زراعية', meta_price=350000, types=(146,),
                       feature=(118, 119, 150))
    kept = row["additional_info"]["source_features"]
    assert "كهرباء" in kept and "مياه" in kept and "صرف صحي" in kept


# ── rent period ───────────────────────────────────────────────────────────────────────────────────

def test_the_rent_period_is_never_defaulted():
    """property_status «للايجار» has a count of 0 today, so this path has no production row to
    fixture — the post below is a real one with only its status term id changed to the real
    «للايجار» term (116). A defaulted period is a 12× error on the card, so it must stay NULL when
    the ad states none, and be read when it does."""
    # meta 50,000 ≠ the ad's 1,100 per-metre figure, so it is a total (a rate has no annual rent).
    row, _, why = _plain(21243, BODY_21243, TITLE_21243, meta_price=50000, status=(116,))
    assert why == "" and row["transaction_type"] == "Rent"
    assert "rent_period" not in row, "no شهري/سنوي token in the ad → the period stays NULL"
    assert "price_total" not in row
    assert row["price_annual"] == 50000

    monthly, _, _ = _plain(21243, BODY_21243 + "\n الإيجار شهري.", TITLE_21243,
                           meta_price=50000, status=(116,))
    assert monthly["rent_period"] == "monthly"
    assert monthly["price_annual"] == 50000 * 12

    yearly, _, _ = _plain(21243, BODY_21243 + "\n الإيجار سنوي.", TITLE_21243,
                          meta_price=50000, status=(116,))
    assert yearly["rent_period"] == "annual"
    assert yearly["price_annual"] == 50000


# ── extraction ─────────────────────────────────────────────────────────────────────────────────────

def test_html_text_keeps_lines_and_unescapes_entities():
    """Two requirements the one-line `sub(r"<[^>]+>", " ")` idiom does not meet. `<br />` must
    become a newline, because every price parse is line-scoped and RAW_21153 puts the 50 ﷼/m² ask
    and the 32 ﷼/m² bid on consecutive lines. `&#8211;` must be unescaped, because that en-dash is
    what _loc_segments splits «غرب عين دار – الاحساء» on."""
    text = R.html_text(RAW_21153)
    assert "&#8211;" not in text and "–" in text
    lines = [ln.strip() for ln in text.split("\n")]
    assert "سعر البيع للمتر : 50 ريال" in lines
    assert "وصل السوم للمتر : 32 ريال" in lines
    assert "<" not in text and ">" not in text
    assert R._loc_segments(R._location_line(text))[0][:2] == ["غرب عين دار", "الاحساء"]

    # RAW_21153 also happens to carry a literal newline after each <br />, so the substitution above
    # is not what splits THAT payload. The invariant is nonetheless that a block boundary is a line
    # boundary — asserted directly, on one physical line, because the parses are line-scoped and a
    # single run-together line puts an ask and a bid in the same parse window.
    one_line = R.html_text(
        '<p>المساحة: 600م²</p><p>سعر البيع للمتر : 125 ريال</p><p>وصل السوم : 1200 للمتر</p>')
    assert one_line.count("\n") == 2, one_line
    assert R.parse_prices(one_line) == (None, [125]), "1200 is a bid on its own line"
    assert R.html_text("أ<br />ب") == "أ\nب"


def test_the_body_area_outranks_a_contradicting_title():
    """21153's title says 660 m²; its body states 325,000 m² four times with plot and plan numbers.
    Title-first turns a 32-hectare farm into a suburban plot and makes its price 24,621 ﷼/m²."""
    area, exact = R.parse_area(R.html_text(RAW_21153), TITLE_21153)
    assert area == 325000
    assert R.parse_area("", TITLE_21153)[0] == 660, "the title IS the fallback when the body is mute"


def test_a_street_width_is_not_an_area():
    """«الواجهة: تقع على شارع بعرض 16 متر غربي» and «عرض الشارع: 200م × 50م × 50م × 50م» are street
    widths in metres. Dropping the «مساحة» anchor makes the first of them this plot's area."""
    assert R.parse_area(" الواجهة: تقع على شارع بعرض 16 متر غربي .\n عرض الشارع: 30 مترًا",
                        "") == (None, None)
    assert R.parse_area(BODY_21243, TITLE_21243)[0] == 420
    assert R.parse_area("", "بيت للبيع في حي المنقور الاحساء بمساحة واسعة") == (None, None)
    # The case the gap guard is for, and it is ordinary phrasing here — this office writes
    # «بمساحة واسعة»/«مساحة ممتازة» and «على شارع بعرض 16 متر» in every ad. When «مساحة» carries an
    # adjective instead of a number, the lazy gap reaches the street width three tokens later and
    # publishes a 16-metre road as a 16 m² plot.
    assert R.parse_area("بمساحة ممتازة على شارع 16 متر", "") == (None, None)
    assert R.parse_area("مساحة كبيرة وشارع 30 متر", "") == (None, None)
    # A longer run-up is already out of reach of the 3-token gap, with or without the guard.
    assert R.parse_area("بمساحة واسعة على شارع بعرض 30 متر", "") == (None, None)


def test_arabic_indic_digits_are_real_digits():
    """٠-٩ must be translated before parsing, in the exact-area float path as well as the int one."""
    area, exact = R.parse_area("المساحة: ٤٢٠ متر مربع", "")
    assert area == 420 and exact == 420.0
    total, ppms = R.parse_prices("سعر البيع: ٦٥٠٠٠ ريال سعودي")
    assert total == 65000
    assert R.parse_area("المساحة الإجمالية: ٥٥٥٫٦٢ متر مربع", "") == (555, 555.62)


def test_the_listing_url_is_usable_and_the_ad_number_is_prefixed():
    row, _, _ = _plain(21243, BODY_21243, TITLE_21243, meta_price=1100, media=21244)
    assert row["ad_number"] == "SDR21243"
    assert row["listing_url"].startswith("https://alsidra.com.sa/") and "&amp;" not in row["listing_url"]
    assert row["source"] == "Al Sidra" and row["active"] is True


def test_photo_ids_resolve_through_the_media_map_and_are_capped():
    """Houzez stores ATTACHMENT IDS, never URLs; an unresolved id must not reach photo_urls."""
    post = _post(21243, BODY_21243, TITLE_21243, meta_price=1100, media=21244)
    post["property_meta"]["fave_property_images"] = ["21244,99999"]
    row, _, _ = R.map_listing(post, TERMS, {21244: "https://alsidra.com.sa/x.png"})
    assert row["photo_urls"] == ["https://alsidra.com.sa/x.png"]

    row2, _, _ = R.map_listing(post, TERMS, {})
    assert row2["photo_urls"] is None, "no resolvable id → NULL, never an id masquerading as a URL"


def test_bedrooms_are_left_null_and_the_prose_is_preserved():
    """21177 says «4 غرف نوم (منها غرفة ماستر)» = 4 while 21253 says «غرفة نوم ماستر» AND
    «4 غرف نوم إضافية» = 5. Same source, opposite conventions; either number needs arithmetic the
    source did not do, so nothing is published and nothing is thrown away."""
    row, _, _ = _plain(21177, BODY_21177, 'فيلا للبيع', meta_price=900000, types=(106,),
                       city=(122,))
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert "غرف نوم" in row["additional_info"]["rooms_prose"]


# ── review fixes 2026-09-21: each pins a branch a mutant previously survived ──────────────────────
_KHOBAR = " الموقع الاستراتيجي: مدينة الخبر – حي الأمواج ."


def test_a_room_area_is_never_the_plot_area():
    assert R.parse_area("مساحة المجلس 30 متر\nالمساحة: 580 متر مربع", "") == (580, 580.0)
    assert R.parse_area("مساحة الصالة 45 م2\nمساحة الأرض الإجمالية: 367.5 م", "") == (367, 367.5)


@pytest.mark.parametrize("line", ["سعر البيع: يحدد بعد المعاينة، رقم القطعة 123",
                                  "سعر البيع: قابل للتفاوض - عمر العقار 5 سنوات",
                                  "السعر: حسب الطلب، رقم المخطط 1532",
                                  "سعر المتر: حسب السوق، رقم القطعة 12"])
def test_a_price_label_never_reaches_a_different_number_on_its_line(line):
    assert R.parse_prices(line) == (None, [])


def test_a_real_per_metre_label_that_mentions_the_plot_is_kept():
    """21191, verbatim: the commercial strip's per-metre price. «القطعة» here is not a plot NUMBER."""
    line = " سعر المتر للأرض التجارية (في ظهر القطعة): 2,000 ريال سعودي. "
    assert R.parse_prices(line) == (None, [2000])


@pytest.mark.parametrize("ppm_line", ["قيمة المتر 1100 ريال", "المتر بـ 1100 ريال"])
def test_per_metre_phrasings_without_the_word_price_are_still_per_metre(ppm_line):
    body = "\n".join([_KHOBAR, " المساحة: 420 متر مربع", ppm_line])
    row, _, why = _plain(21243, body, TITLE_21243, meta_price=1100)
    assert why == "" and row.get("price_total") is None and row["price_per_meter"] == 1100


def test_the_scraper_never_multiplies_a_rate_into_a_stored_price():
    """21191: 1,700 ﷼/m² on 555.62 m². The ≈ total is the display layer's; here only the rate."""
    body = "\n".join([_KHOBAR, " المساحة الإجمالية: 555.62 متر مربع. ",
                      " سعر المتر للأرض السكنية: 1,700 ريال سعودي. "])
    row, _, why = _plain(21191, body, TITLE_21243, meta_price=1700)
    assert why == "" and row["area_m2"] == 555
    assert row.get("price_total") is None and row["price_per_meter"] == 1700
    assert row["additional_info"]["area_m2_exact"] == 555.62

def test_a_per_metre_figure_with_no_area_publishes_no_price():
    body = "\n".join([_KHOBAR, " سعر البيع للمتر: 1,100 ريال فقط! 💰"])
    row, _, why = _plain(21243, body, TITLE_21243, meta_price=1100)
    assert why == "" and row.get("price_total") is None and row["price_per_meter"] == 1100
    assert row["additional_info"]["price_provenance"] == "per_metre"


def test_a_region_only_ad_is_skipped_by_map_listing_itself():
    row, _, why = _plain(1, "الموقع: مخطط العدل السليمي.", "أرض ركنية بمخطط 1532")
    assert row is None and why == "city_not_in_catalog"


# ── Advanced Filter columns (2026-09-21): land answers ONLY street_width + direction ───────────
def test_the_labelled_facade_line_fills_street_width_and_direction_once_or_not_at_all():
    row, _, why = _plain(21243, BODY_21243, TITLE_21243, meta_price=1100)
    assert why == "" and (row["street_width_m"], row["direction"]) == (16, "غرب")   # SDR21243
    two, _, _ = _plain(21229, "الواجهة والشوارع: تقع على شارعين بعرض 30م × 20م (واجهة شمالية غربية)",
                       "ارض سكنية للبيع", meta_price=1100, city=(129,))
    assert two is not None, _
    assert (two["street_width_m"], two["direction"]) == (None, None), "two streets / two facades"
    prose, _, _ = _plain(20404, "مبنى على شارع رئيسي يربط بين أحياء جنوب الرياض بعرض 30 متر",
                         "ارض سكنية للبيع", meta_price=1100, city=(129,))
    assert (prose["street_width_m"], prose["direction"]) == (None, None), "unlabelled prose is never read"


def test_named_utility_features_are_true_and_absent_ones_stay_null():
    row, _, _ = _plain(21243, BODY_21243, TITLE_21243, meta_price=1100, feature=(118, 119, 150))
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (True, True, True)
    bare, _, _ = _plain(21243, BODY_21243, TITLE_21243, meta_price=1100)
    assert not {"electricity", "water_supply", "sanitation"} & set(bare), "silence is NULL, never False"


# ── the card's district text is the SOURCE's text, not its label (2026-09-21) ──────────────────────
# `content.rendered` for post 21147, byte-for-byte as /wp/v2/عقارات served it on 2026-09-21 — the
# listing a real-user test found on the live card reading «الموقع: حي الورود – الأحساء». The label
# sits in its own <strong> inside a maps link, so html_text() and _location_line() both run on it.
RAW_21147 = (
    "<p class=\"PDq2pG_selectionAnchorContainer\" data-start=\"388\" data-end=\"535\"><strong data-start=\"388\" data-end=\"418\">أرض سكنية للبيع في الأحساء تقع في حي الورود، بمساحة 367.5م²<br />\n"
    "</strong>تقع في حي الورود، وتتميز بموقع مناسب داخل الحي وواجهة شرقية على شارع بعرض 15 مترًا، بمساحة إجمالية تبلغ <strong data-start=\"523\" data-end=\"534\">367.5م²</strong>.</p>\n"
    "<h4 data-start=\"537\" data-end=\"554\">تفاصيل الأرض</h4>\n"
    "<ul data-start=\"555\" data-end=\"768\">\n"
    "<li data-start=\"555\" data-end=\"588\"><a href=\"https://maps.app.goo.gl/Sgv2cXPAfkXpvzQaA\" target=\"_blank\" rel=\"noopener\"><strong data-start=\"557\" data-end=\"568\">الموقع:</strong> حي الورود – الأحساء</a></li>\n"
    "<li data-start=\"589\" data-end=\"616\"><strong data-start=\"591\" data-end=\"606\">نوع العقار:</strong> أرض سكنية</li>\n"
    "<li data-start=\"617\" data-end=\"639\"><strong data-start=\"619\" data-end=\"631\">المساحة:</strong> 367.5م²</li>\n"
    "<li data-start=\"640\" data-end=\"665\"><strong data-start=\"642\" data-end=\"657\">رقم القطعة:</strong> 202/2/ص</li>\n"
    "<li data-start=\"666\" data-end=\"690\"><strong data-start=\"668\" data-end=\"683\">رقم المخطط:</strong> 1100/4</li>\n"
    "<li data-start=\"691\" data-end=\"717\"><strong data-start=\"693\" data-end=\"708\">عرض الشارع:</strong> 15 مترًا</li>\n"
    "<li data-start=\"718\" data-end=\"738\"><strong data-start=\"720\" data-end=\"732\">الواجهة:</strong> شرقية</li>\n"
    "<li data-start=\"739\" data-end=\"768\"><strong data-start=\"741\" data-end=\"755\">سعر البيع:</strong> 245,000 ريال</li>\n"
    "</ul>\n"
    "<h4 data-start=\"770\" data-end=\"805\">فرصة تملك أرض سكنية في الأحساء</h4>\n"
    "<p data-start=\"806\" data-end=\"945\">تُعد الأرض خيارًا مناسبًا للراغبين في <strong data-start=\"844\" data-end=\"884\">تملك أرض سكنية في حي الورود بالأحساء</strong>، سواء بهدف بناء مسكن خاص أو للاستفادة من موقعها ضمن المنطقة.</p>\n"
    "<p data-start=\"947\" data-end=\"974\"><strong data-start=\"947\" data-end=\"974\">سعر البيع: 245,000 ريال</strong></p>\n"
    "<p data-start=\"976\" data-end=\"1097\">للاستفسار عن تفاصيل <strong data-start=\"996\" data-end=\"1030\">الأرض السكنية للبيع في الأحساء</strong> أو معرفة المزيد من المعلومات، يمكن التواصل مع <strong data-start=\"1077\" data-end=\"1096\">السدرة العقارية</strong>.</p>\n"
)
TITLE_21147 = "أرض سكنية للبيع في الأحساء بمساحة 367.5م²"


def test_the_card_shows_the_sources_location_text_without_its_label(monkeypatch):
    """MUTATION: return the whole matched line from _location_line (the pre-fix `line.strip()`)
    and every assertion on `neighborhood` below fails — that line IS the card text. Only the label
    and its colon go; the source's dash, city and punctuation stay exactly as written."""
    seen = []
    monkeypatch.setattr(R, "find_district_in_text", lambda text, cid: seen.append(text) or None)
    row, _, why = R.map_listing(_post(21147, RAW_21147, TITLE_21147, types=(107,), city=(122,)),
                                TERMS, {})
    assert why == "" and row["neighborhood"] == "حي الورود – الأحساء", row and row["neighborhood"]
    assert row["city_id"] == 3677 and row["price_total"] == 245000
    # The district lookup reads the same line — it gets the place names, never the label words.
    assert "حي الورود – الأحساء" in seen and not any("الموقع" in (t or "") for t in seen), seen

    # Every live label form, each against its own verbatim line (21243 «الموقع الاستراتيجي»,
    # 21210 «الموقع الجغرافي», 21257 «المنطقة», 21174 «الموقع:» with NO space after the colon).
    assert R._location_line(BODY_21243) == "مدينة الخبر – حي الأمواج ."
    assert R._location_line(BODY_21210) == "القويعية – منطقة الرياض."
    assert R._location_line("المنطقة: القصيم – الفويلق.") == "القصيم – الفويلق."
    assert R._location_line("الموقع:لبخة التابعة للرياض") == "لبخة التابعة للرياض"
    assert R._location_line("الموقع:") is None, "a bare label states no location"


def test_a_colon_inside_the_unlabelled_value_does_not_cut_it():
    """_location_line now hands _loc_segments the value WITHOUT its label, so the old unconditional
    `split(":", 1)[-1]` would cut at a colon in the value itself. The value below is 21153's own
    location value plus its own «رقم المخطط: 3374» line, joined. MUTATION: split unconditionally →
    the candidates collapse to [«3374»]."""
    cands, _ = R._loc_segments("غرب عين دار – الاحساء (رقم المخطط: 3374)")
    assert cands[:2] == ["غرب عين دار", "الاحساء"], cands


# ── 2026-09-23: the source's hosting account was suspended ───────────────────────────────────────
class _Resp:
    def __init__(self, status, text, url="", ctype="application/json"):
        self.status_code, self.text, self.url = status, text, url
        self.headers = {"content-type": ctype}

    def json(self):
        import json as _json
        return _json.loads(self.text)


class _FakeSession:
    def __init__(self, resp):
        self.resp = resp

    def get(self, *_a, **_kw):
        return self.resp


_CPANEL = ('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">'
           "<html><head><title>Contact Support</title></head><body>"
           "This Account has been suspended.</body></html>")


def test_a_suspended_host_is_reported_as_a_source_outage_not_a_parser_error():
    """Live 2026-09-23: every request 302s to /cgi-sys/suspendedpage.cgi and the cPanel page is
    HTML, so r.json() raised «Expecting value: line 1 column 1» and the run ledger blamed nothing.
    The message must name the source outage — and nothing may be retired on the strength of it."""
    s = _FakeSession(_Resp(200, _CPANEL, url="https://alsidra.com.sa/cgi-sys/suspendedpage.cgi",
                           ctype="text/html"))
    with pytest.raises(RuntimeError) as e:
        R._api(s, "/wp/v2/types")
    assert "SUSPENDED" in str(e.value) and "nothing retired" in str(e.value)


def test_an_html_answer_that_is_not_json_says_so_instead_of_raising_a_json_error():
    s = _FakeSession(_Resp(200, "<html>maintenance</html>", ctype="text/html"))
    with pytest.raises(RuntimeError) as e:
        R._api(s, "/wp/v2/types")
    assert "not JSON" in str(e.value)


def test_a_healthy_json_answer_still_parses():
    s = _FakeSession(_Resp(200, '[{"slug":"x"}]'))
    assert R._api(s, "/wp/v2/types") == [{"slug": "x"}]
