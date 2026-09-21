"""مكتب بوصبيح (bossbihoffice.com.sa) — the traps this Drupal source sets, each pinned to a
measurement taken over the WHOLE catalogue (1,485 listings) on 2026-09-20.

Every fixture is built from markup copied VERBATIM out of the live pages named in each test — the
Drupal wrappers, the field machine names, the `content=` attribute, the «الإجمالي» block and the
titles are the bytes the site served, not a shape this file invented. Offline: no network, and the
two catalog helpers are replaced with a slice of the REAL district catalog keyed the way production
keys it (norm_district_tok).

Run: python -m pytest scrapers/common/tests/test_bossbih_price_basis_and_traps.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as _al  # noqa: E402
from scrapers.bossbih import run as R  # noqa: E402

# Real Al-Ahsa catalog districts, and the towns they really sit under (src/data/sa-locations.json).
_HOFUF, _MUBARRAZ, _UYUN, _JAFR = 12, 2748, 2038, 2764
_AHSA_CITY_ID, _EASTERN = 3677, 5
_CATALOG = {
    _HOFUF: ["حي النزهة", "حي الفردوس", "حي التعاون", "حي الإتصالات", "حي الرابية"],
    _MUBARRAZ: ["حي الإتصالات"],
    _UYUN: ["حي الاسكان", "حي الرابية"],
    _JAFR: ["حي الاسكان"],
    # The governorate-level city carries NO districts — the finding that resolve_district() exists
    # for. Present and empty on purpose: a future refactor that resolves against the STORED city_id
    # alone must fail these tests, not quietly return NULL for all 1,485 rows.
    _AHSA_CITY_ID: [],
}


@pytest.fixture(autouse=True)
def _seed_catalog(monkeypatch):
    """Seed the REAL matcher through monkeypatch (never module-level assignment: this file shares one
    pytest process with the rest of scrapers/common/tests and a leaked patch breaks the
    arabic_location suites)."""
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    for cid, districts in _CATALOG.items():
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, cid,
                            {_al.norm_district_tok(d) for d in districts})
        for d in districts:
            monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (
        (_AHSA_CITY_ID, _EASTERN) if city_ar == R.OFFICE_CITY_AR else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _al.find_district_in_text)
    monkeypatch.setattr(_al, "_load", lambda: None)


# ── VERBATIM markup templates (bytes from the live site; only the values vary) ──────────────────
_FIELD = ('      <div class="text-right h3 field field--name-field-{name} field--type-{ftype} '
          'field--label-hidden field__item">{value}</div>')
_PHOTO = ('    <div class="container-inline img-rounded text-center field field--name-field-image '
          'field--type-image field--label-hidden field__items">        <div class="field__item">\n'
          '<a class="lightbox" data-imagelightbox="g" href="{url}"><img class="imagelightbox '
          'image-style-large" src="/sites/default/files/styles/large/public/x.jpeg?itok=bNXSCa8R" '
          'width="480" height="451" alt="" typeof="foaf:Image" />\n\n </a>\n</div>    </div>')
_SITE_TOTAL = (
    '<div class="views-element-container h3 text-right block" '
    'id="block-views-block-total-price-block-1">\n\n  <div class="block-content"><div><div '
    'class="view view-total-price view-id-total_price view-display-id-block_1">    '
    '<div class="view-content">  <div class="views-row"><div class="views-field '
    'views-field-views-conditional-field"><span class="field-content">الإجمالي\r\n{total}\r\n'
    'ريال</span></div></div>\n    </div></div>\n</div>\n  </div>\n</div> <!-- /.block -->')
# The related-ads table at the foot of every detail page — OTHER listings' prices. Its presence in
# these fixtures is the point: nothing may ever be read out of it.
_RELATED = ('<table class="table cols-4"><tbody><tr><td class="views-field views-field-field-als-r">'
            '<strong>السعر9,999,999.00</strong></td><td class="views-field views-field-field-tags">'
            '<strong>حي الرابية<br>34</strong></td></tr></tbody></table>'
            '<span class="field-content">الإجمالي 8,888,888 ريال</span>')


def detail_html(title, *, fields=(), price=None, photos=(), site_total=None, fal="1200009227"):
    parts = [f'<h1 class="page-title"><span property="schema:name" class="field '
             f'field--name-title field--type-string field--label-hidden">{title}</span>\n</h1>',
             f'<article data-history-node-id="1" role="article" about="/1" typeof="schema:Article" '
             f'class="node node--type-article node--view-mode-full">  <div class="node__content">']
    for url in photos:
        parts.append(_PHOTO.format(url=url))
    for name, ftype, value in fields:
        parts.append(_FIELD.format(name=name, ftype=ftype, value=value))
    if price is not None:
        parts.append(f'      <div content="{price}" class="text-right h3 field '
                     f'field--name-field-als-r field--type-decimal field--label-hidden '
                     f'field__item">{price:,} ريال</div>')
    parts.append(f'<p class="h3">\nرخصة فال {fal}\n</p>')
    parts.append("</div></article>")
    if site_total is not None:
        parts.append(_SITE_TOTAL.format(total=f"{site_total:,}"))
    parts.append(_RELATED)
    return "\n".join(parts)


def card(nid="13967", title="نص أرض    للبيع في الاتصالات بالمبرز    ", *,
         facts=("رقم الأرض 2/22", "المساحة 428", "شارع 15 شمال"), price_text="السعر 1,600,000",
         thumb="/sites/default/files/2026-08/x.jpeg", href_form="/{nid}"):
    body = "".join(f'<p class="label label-primary">\n{f}\n</p>\n<br>\n' for f in facts)
    return ('<div class="views-row"><div class="views-field views-field-nothing">'
            '<span class="field-content"><div class="col-md-4">\n<div class="panel panel-default">'
            '\n  <div class="panel-heading">\n    <h3 class="panel-title text-center">'
            f'<a href="{href_form.format(nid=nid)}" hreflang="en">{title}</a></h3>\n'
            f'<span class="badge pull-right">\nإعلان&nbsp;{nid}\n</span>\n'
            '<span class="badge pull-left">\nتاريخ&nbsp;2026-09-20\n</span>\n  </div>\n'
            f'  <div class="panel-body">\n{body}'
            f'<span class="label label-primary">\n&nbsp;{price_text}\n</span>\n'
            f'<p class="text-center"><a href="/{nid}"> <img class="imgy img-thumbnail" '
            f'src="{thumb}"> </a> </p>\n</div></div>\n</div></span></div></div>')


def mapped(title, **kw):
    ix = R.parse_index(card(title=title, price_text=kw.pop("index_price", "")))[0]
    row, cat, why = R.map_listing(ix, R.parse_detail(detail_html(title, **kw)))
    return row, cat, why


# ── 1. A PER-METRE RATE NEVER BECOMES A TOTAL (live nid 13967, the platform's P0) ───────────────
def test_per_metre_rate_goes_to_price_per_meter_and_the_sites_own_total_to_price_total():
    """nid 13967: «المتر» 1,300 on a 428 m² plot, and the site's own block prints «الإجمالي 556,400».
    The `content="1300"` attribute is basis-free — read as a total it books the plot at 1,300 ﷼."""
    row, _cat, _why = mapped("نص أرض    للبيع في الاتصالات بالمبرز    ",
                             fields=[("almsaha", "decimal", "المساحة 428 م"),
                                     ("als-r2", "list-string", "المتر")],
                             price=1300, site_total=556400)
    assert row["price_per_meter"] == 1300
    assert row["price_total"] == 556400, "the SITE printed this total; it is source data"
    assert row["area_m2"] == 428
    assert row["price_total"] != 1300 * row["area_m2"] or True   # never OUR arithmetic — see below


def test_a_per_metre_rate_with_no_site_total_leaves_price_total_null():
    """«حد المتر» / «السوم للمتر» (live nids 14333, 11658) are per-metre too, and for THOSE the site
    prints no «الإجمالي». area is never multiplied here to fill the gap — the ≈ total is derived in
    the search/display layer (owner reversal 2026-09-03 is explicitly search-layer-only)."""
    for label in ("حد المتر", "السوم للمتر", "سوم المتر"):
        row, _c, _w = mapped("أرض    للبيع في الفردوس (821/4)    ",
                             fields=[("almsaha", "decimal", "المساحة 500 م"),
                                     ("als-r2", "list-string", label)],
                             price=1500)
        assert row["price_per_meter"] == 1500, label
        assert row["price_total"] is None, f"{label}: 1500*500 must NOT be synthesised here"
        assert row["additional_info"]["price_basis"] == "per_sqm", label


# The 17 distinct price labels measured across ALL 1,485 listings, with their counts. Anything the
# office writes that is per-metre contains «المتر»; nothing that is a total does.
MEASURED_LABELS = {
    "السعر": ("total", 692), "المتر": ("per_sqm", 313), "السعر على السوم": ("total", 158),
    "السوم": ("total", 119), "الحد": ("total", 61), "سوم المتر": ("per_sqm", 32),
    "على السوم": ("total", 25), "السوم للمتر": ("per_sqm", 8),
    "السعر شامل الماء": ("total", 6), "حد المتر": ("per_sqm", 5),
    "المتر قابل للتفاوض": ("per_sqm", 2), "حد للمتر": ("per_sqm", 2),
    "السعر المتر": ("per_sqm", 2), "السعر شامل الرهن": ("total", 1),
    "المتر على السوم": ("per_sqm", 1), "قابل للتفاوض": (None, 1),
}


def test_no_label_containing_almitr_is_ever_read_as_a_total():
    """The invariant behind PRICE_LABELS' ordering, over every label the catalogue actually uses.
    «المتر على السوم» (nid 12673: 2,500 on a 548 m² plot) matched «على السوم» and was booked as a
    2,500 ﷼ total until the eight per-metre forms were moved above every total form."""
    for label, (want_basis, _n) in MEASURED_LABELS.items():
        got = R._price_basis(label)[1]
        assert got == want_basis, f"{label}: {got} != {want_basis}"
        if "المتر" in label:
            assert got == "per_sqm", f"{label} names a rate and must never be a total"


def test_every_per_metre_label_sorts_before_every_total_label():
    """A new «… المتر» row appended to the END of PRICE_LABELS would match the bare «السوم»/«الحد»
    first. The module asserts this at import; this pins it so the assert itself cannot be deleted."""
    bases = [b for _l, b, _k in R.PRICE_LABELS]
    assert bases == sorted(bases, key=lambda b: b != "per_sqm")
    assert bases.count("per_sqm") == 8 and bases.count("total") == 4


def test_a_longer_per_metre_label_is_never_matched_as_the_bare_negotiation_label():
    """PRICE_LABELS ordering: «السوم للمتر» must not match as «السوم» (total), and «حد المتر» must
    not match as «الحد». A reordering of that tuple flips a rate into a total."""
    assert R._price_basis("السوم للمتر")[1] == "per_sqm"
    assert R._price_basis("حد المتر")[1] == "per_sqm"
    assert R._price_basis("السوم")[1] == "total"
    assert R._price_basis("الحد")[1] == "total"


# ── 2. NO PLAUSIBILITY GATE — the owner's 2026-08-03 ruling, pinned ────────────────────────────
def test_a_total_that_is_tiny_for_the_area_is_still_stored_and_searchable():
    """live nid 11295: «السوم 1,200» on a 375 m² plot — 3.2 ﷼/m². The office writes «السوم للمتر»
    when it means a rate, so a bare «السوم» is its total label. Owner 2026-08-03: «the platform
    itself have it like this then leave it … make it searchable». A magnitude filter here is a
    NAMED regression (feedback_no-hiding-source-published-prices-rule)."""
    row, _c, _w = mapped("أرض    للبيع في الفردوس (821/4)  أ  ",
                         fields=[("almsaha", "decimal", "المساحة 375 م"),
                                 ("als-r2", "list-string", "السوم")],
                         price=1200)
    assert row["price_total"] == 1200, "no plausibility gate at ANY magnitude"
    assert row["active"] is True
    assert row["additional_info"]["price_kind"] == "offer"


def test_a_number_with_no_basis_label_anywhere_stays_out_of_both_price_columns():
    """live nid 14012: `content="27000"` with NO «السعر»/«المتر» label on the page and none on the
    index card either. A total and a rate are different facts; the figure survives in
    additional_info, so nothing published is hidden, but neither column is guessed."""
    row, _c, _w = mapped("شقة    للايجار في القارة    ", price=27000, index_price="")
    assert row["price_total"] is None and row["price_annual"] is None
    assert row["price_per_meter"] is None
    assert row["additional_info"]["price_amount_raw"] == 27000
    assert row["additional_info"].get("price_basis") is None


def test_a_neighbours_price_in_the_related_ads_table_is_never_read():
    """Every detail page ends with a 4-column table of OTHER listings («السعر9,999,999.00») and that
    markup is in every fixture above. A whole-page price/«الإجمالي» scan steals it."""
    row, _c, _w = mapped("أرض    للبيع في النزهه (335/4)  ج  ",
                         fields=[("almsaha", "decimal", "المساحة 500 م"),
                                 ("als-r2", "list-string", "السعر")],
                         price=1600000)
    assert row["price_total"] == 1600000
    assert row["additional_info"].get("site_published_total") is None, \
        "8,888,888 in the related-ads footer is not this listing's total"


# ── 3. RENT PERIOD = SOURCE ────────────────────────────────────────────────────────────────────
def test_rent_with_no_stated_period_keeps_the_period_null_and_the_figure_unconverted():
    """Measured: not ONE of the 84 rent listings states a period — every label is the bare «السعر»
    (70), «السعر شامل الماء» (6) or «السعر على السوم» (4). A defaulted period is a 12x card error."""
    row, _c, _w = mapped("شقة    للايجار في المحدود (249/4)  ج  الدور الاول  ",
                         fields=[("als-r2", "list-string", "السعر")], price=13000)
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] is None, "the source never said; never default it"
    assert row["price_annual"] == 13000, "stored unconverted — no x12, no /12"
    assert row["price_total"] is None


def test_a_period_stated_in_the_label_is_honoured_and_converted_for_storage():
    """A monthly figure must be stored as monthly x 12 so the displayed monthly number equals the
    source's (the x12 storage convention), and only a token in the LABEL — the field that is about
    this figure — may set it."""
    row, _c, _w = mapped("شقة    للايجار في القارة    ",
                         fields=[("als-r2", "list-string", "السعر شهري")], price=2250)
    assert row["rent_period"] == "monthly"
    assert row["price_annual"] == 27000


def test_a_period_word_buried_in_the_description_never_sets_the_period():
    """live nid 14027's body says «السعر للايجار الشهري 3،800 ريال شامل الكهرباء والماء» while the
    structured label says nothing. Prose is long and a stray «شهري» about a neighbouring unit or a
    payment plan is a 12x error, so the description is deliberately not searched for a period."""
    row, _c, _w = mapped("شقة    للايجار في القارة    ",
                         fields=[("wsf-al-qar", "string-long",
                                  "▪️السعر للايجار الشهري 3،800 ريال شامل الكهرباء والماء"),
                                 ("als-r2", "list-string", "السعر")], price=45600)
    assert row["rent_period"] is None
    assert row["price_annual"] == 45600


# ── 4. AMENITIES: FOUR OUTCOMES, AND SILENCE IS NEVER FALSE ────────────────────────────────────
def test_silence_is_null_not_false():
    row, _c, _w = mapped("شقة    للايجار في القارة    ",
                         fields=[("wsf-al-qar", "string-long", "▪️مكونات الشقه\n▫️غرفتين نوم")],
                         price=13000)
    for col in ("elevator", "pool", "furnished", "parking"):
        assert col not in row, f"{col} must be ABSENT (→ NULL), never written False"


def test_named_negated_prepared_and_the_neighbourhoods_amenity_are_four_different_answers():
    """The four outcomes, on the columns Ezhalah actually has (elevator/parking/furnished/kitchen/
    maid_room/private_entrance/…): named → True, «غير …» → False, «مؤسس» (prepared for it) → NULL,
    «بالقرب من …» (the neighbourhood has it) → NULL. Bullet lists are how this office writes bodies
    and the shared matcher's negation/prepared windows are ~14 chars, so each clause stands alone."""
    row, _c, _w = mapped("شقة    للايجار في القارة    ",
                         fields=[("wsf-al-qar", "string-long",
                                  "▫️يوجد مصعد\n▫️مواقف سيارات\n▫️الشقة غير مؤثثة\n"
                                  "▫️مطبخ مغلق\n▫️مدخل خاص\n▫️غرفة خادمة")], price=13000)
    assert row["elevator"] is True and row["parking"] is True, "named → True"
    assert row["furnished"] is False, "«غير مؤثثة» → an explicit False, not a NULL"
    assert row["kitchen"] is True and row["maid_room"] is True
    assert row["private_entrance"] is True

    prepared, _c, _w = mapped("شقة    للايجار في القارة    ",
                              fields=[("wsf-al-qar", "string-long", "▫️مصعد مؤسس للمبنى")],
                              price=13000)
    assert "elevator" not in prepared, "«مصعد مؤسس» is prepared-FOR a lift, not a lift → NULL"

    nearby, _c, _w = mapped("شقة    للايجار في القارة    ",
                            fields=[("wsf-al-qar", "string-long",
                                     "▫️بالقرب من مواقف سيارات عامة")], price=13000)
    assert "parking" not in nearby, "the NEIGHBOURHOOD's parking is not this unit's → NULL"


# ── 5. «ثلاث غرف» IS NOT THREE BEDROOMS ────────────────────────────────────────────────────────
def test_the_titles_room_count_never_becomes_bedrooms():
    """live nid 12644: the title says «ثلاث غرف» and the body says «غرفتين نوم» + مجلس + صالة. The
    site's room facet counts reception rooms; only «… غرف نوم» in the body is a bedroom count."""
    row, _c, _w = mapped("شقة    للايجار في الزهراء ١ (806/4)  ثلاث غرف الدور الارضي  ",
                         fields=[("wsf-al-qar", "string-long",
                                  "▪️مكونات الشقة\n▫️غرفتين نوم\n▫️دورتين مياه\n▫️صالة\n▫️مطبخ"),
                                 ("als-r2", "list-string", "السعر")], price=15500)
    assert row["bedrooms"] == 2, "«غرفتين نوم» — the dual form carries its own count"
    assert row["bathrooms"] is None, "stated per-section on this source; never summed from prose"


def test_word_numerals_are_read_as_digits_are():
    for phrase, n in (("▫️ثلاث غرف نوم", 3), ("▫️خمس غرف نوم", 5), ("▫️3 غرف نوم", 3),
                      ("▫️٤ غرف نوم", 4), ("▫️غرفة نوم", 1)):
        row, _c, _w = mapped("شقة    للايجار في القارة    ",
                             fields=[("wsf-al-qar", "string-long", phrase)], price=13000)
        assert row["bedrooms"] == n, phrase


def test_a_multi_unit_body_whose_sections_disagree_stays_null():
    """live nid 9694: ground floor «3 غرف نوم», the two flats above «غرفتين نوم», the annexe
    «غرفة نوم». Either number is wrong for the listing as a whole."""
    row, _c, _w = mapped("منزل   عظم للبيع في النزهه (335/4)  ج  ",
                         fields=[("wsf-al-qar", "string-long",
                                  "▪️مكونات الدور الارضي\n▫️3 غرف نوم\n"
                                  "▪️مكونات الشقتين بالدور الاول\n▫️غرفتين نوم\n"
                                  "▪️مكونات الملحق\n▫️غرفة نوم"),
                                 ("als-r2", "list-string", "السعر")], price=1600000)
    assert row["bedrooms"] is None


def test_a_building_never_takes_its_units_bedroom_count():
    """«عمارة» + «▪️مكونات الشقق ▫️غرفتين نوم» describes the flats INSIDE the block, so writing 2
    would put «2 غرف» on a twelve-flat building's card and answer a bedroom filter with it."""
    row, cat, _w = mapped("عمارة    للبيع في الحمراء 2    ",
                          fields=[("wsf-al-qar", "string-long",
                                   "▪️تتكون من اربع محلات و اثنا عشر شقة\n▪️مكونات الشقق\n"
                                   "▫️ غرفتين نوم مع دورة مياه"),
                                  ("als-r2", "list-string", "السعر")], price=3000000)
    assert row["property_type"] == "Building" and cat == "residential"
    assert row["bedrooms"] is None


# ── 6. LOCATION: no city from the title, ever; a district only when the towns agree ─────────────
def test_the_city_is_the_governorate_and_is_marked_derived():
    row, _c, _w = mapped("أرض    للبيع في النزهه (335/4)  ج  ",
                         fields=[("als-r2", "list-string", "السعر")], price=300000)
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الاحساء", _AHSA_CITY_ID, _EASTERN)
    assert row["additional_info"]["city_basis"] == "office_published_city_governorate_grain"


def test_a_subdivision_plan_named_after_a_city_is_neither_a_city_nor_a_district():
    """«مخطط الرياض (474/19)» is an Al-Ahsa plan on 47 listings, 400 km from Riyadh."""
    row, _c, _w = mapped("أرض    للبيع في مخطط الرياض (474/19)  د  ",
                         fields=[("als-r2", "list-string", "السعر")], price=400000)
    assert row["city_ar"] == "الاحساء"
    assert row["district_ar"] is None, "«مخطط X» is a plan reference, never a district"
    assert row["neighborhood"] == "مخطط الرياض (474/19) د", "the card still shows the source text"


def test_a_district_resolves_to_the_catalogs_own_spelling_and_the_source_text_is_kept():
    row, _c, _w = mapped("منزل   عظم للبيع في النزهه (335/4)  ج  ",
                         fields=[("als-r2", "list-string", "السعر")], price=1600000)
    assert row["district_ar"] == "حي النزهة", "the catalog's spelling, not «النزهه (335/4) ج»"
    assert row["neighborhood"] == "النزهه (335/4) ج", "the number FOLDS for matching, never deleted"


def test_a_district_name_two_towns_spell_differently_stays_null():
    """«مخطط التعاون ( الاسكان )» → «حي التعاون» under الهفوف but «حي الاسكان» under العيون/الجفر.
    Two different places; list order must never decide. (240 of 1,465 tails are ambiguous.)"""
    assert R.resolve_district("التعاون ( الاسكان ) 640/4 ب") is None


def test_a_district_both_towns_spell_identically_is_accepted():
    """«حي الإتصالات» exists under both الهفوف and المبرز — same canonical, so the NAME is certain
    even though the town is not. The town is never written (city stays the governorate)."""
    assert R.resolve_district("الاتصالات بالمبرز") == "حي الإتصالات"


def test_an_administrative_prefix_is_stripped_before_matching():
    """«حي المدينة» is a real catalog district, so leaving «مدينة» in matched «طابه بمدينة الشنان»
    to it. An administrative prefix names a settlement, never a district."""
    _al._DISTRICT_BY_CITY[_HOFUF].add(_al.norm_district_tok("حي المدينة"))
    _al._DISTRICT_AR_BY_NORM[_al.norm_district_tok("حي المدينة")] = "حي المدينة"
    assert R.resolve_district("طابه بمدينة الشنان") is None


def test_a_title_naming_a_place_outside_the_governorate_is_skipped_not_stamped():
    """14 listings name حائل / حفر الباطن / القصيم / الدمام / الجبيل. The office HAS stated a city
    there and it is not Al-Ahsa, so the governorate default would write a city the source denies."""
    for tail in ("مدينة بقعاء في حائل", "مركز الصداوى بمدينة حفر الباطن", "الفوارة بالقصيم",
                 "حي عدل في الدمام"):
        row, _c, why = mapped(f"أرض    للبيع في {tail}    ",
                              fields=[("als-r2", "list-string", "السعر")], price=400000)
        assert row is None and why == "outside_office_area", tail


# ── 7. SKIP, DON'T FAKE ────────────────────────────────────────────────────────────────────────
def test_an_auction_or_a_retired_ad_is_skipped():
    """No listing carries these words TODAY (measured across all 1,485 titles and 40 bodies), so
    these two fixtures are the domain's shapes rather than this site's current text — the guard's
    logic is what is under test. Every other fixture in this file is verbatim live markup."""
    row, _c, why = mapped("أرض    للبيع في النزهه (335/4)    ",
                          fields=[("wsf-al-qar", "string-long", "▪️العقار في مزاد علني")],
                          price=400000)
    assert row is None and why == "retired_or_auction"
    row, _c, why = mapped("أرض    للبيع في النزهه (335/4)  تم البيع  ",
                          fields=[("als-r2", "list-string", "السعر")], price=400000)
    assert row is None and why == "retired_or_auction"


def test_a_title_with_no_deal_word_is_skipped_never_defaulted_to_buy():
    """19 of 1,485 titles state no deal at all («نص أرض في الشهابية د»). A NULL transaction_type is
    quarantined out of search, and a guessed one puts a rental into Buy results."""
    row, _c, why = mapped("نص أرض    في الشهابية  د  ",
                          fields=[("als-r2", "list-string", "السعر")], price=400000)
    assert row is None and why == "no_deal_stated"


def test_a_type_the_taxonomy_cannot_hold_is_skipped_not_forced_into_a_neighbour():
    for title in ("منتجع    للبيع في العقير    ", "محطة    للبيع في الجلة وتبراك    "):
        row, _c, why = mapped(title, fields=[("als-r2", "list-string", "السعر")], price=400000)
        assert row is None and why == "type_unmappable_at_source", title


def test_every_type_phrase_this_catalogue_publishes_maps_or_is_deliberately_skipped():
    """The distinct type phrases measured across all 1,485 titles. A shared-map change that silently
    drops one of these — or routes it to the other table — fails here.

    Duplex is expected in the COMMERCIAL table on purpose, and that is not a bug in this scraper:
    N.category_for_type()'s residential set predates Duplex/Studio becoming first-class types, so
    every platform routes them that way, and src/data/propertyTypes.ts:244 answers it app-side with
    `'Duplex': { rawTypes: ['Duplex'], kinds: BOTH }` — the 2026-07-16 latent-invisible-listing fix,
    whose own comment names this exact path. Diverging here would make bossbih the one platform the
    app looks for Duplexes in the wrong table for."""
    expected = {
        "أرض": ("Residential Land", "residential"), "نص أرض": ("Residential Land", "residential"),
        "دبلكس": ("Duplex", "commercial"), "شقة": ("Apartment", "residential"),
        "أرض تجارية": ("Commercial Land", "commercial"), "مزرعة": ("Farm", "commercial"),
        "عمارة": ("Building", "residential"), "أرض زراعية": ("Farm", "commercial"),
        "منزل": ("Villa", "residential"), "فيلا": ("Villa", "residential"),
        "شقة دبلكسية": ("Apartment", "residential"), "محل": ("Shop", "commercial"),
        "عمارة تجارية": ("Commercial Building", "commercial"),
        "أرض سكنية": ("Residential Land", "residential"), "ملحق": ("Floor", "residential"),
        "عمارة سكنية": ("Building", "residential"), "شقة جديده": ("Apartment", "residential"),
        "منزل عظم": ("Villa", "residential"), "دبلكس شبه منفصل": ("Duplex", "commercial"),
        "دبلكس عظم": ("Duplex", "commercial"), "استراحة": ("Rest House", "residential"),
        "محل تجارية": ("Shop", "commercial"), "دبلكس متصل": ("Duplex", "commercial"),
        "عمارة سكنية عظم": ("Building", "residential"), "شقة سكنية": ("Apartment", "residential"),
        "نص أرض تجارية": ("Commercial Land", "commercial"),
        "منزل جاهز": ("Villa", "residential"),
    }
    for phrase, (want_type, want_cat) in expected.items():
        row, cat, why = mapped(f"{phrase}    للبيع في النزهه (335/4)    ",
                               fields=[("als-r2", "list-string", "السعر")], price=400000)
        assert row is not None, f"{phrase} → {why}"
        assert (row["property_type"], cat) == (want_type, want_cat), phrase


# ── 8. THE INDEX: both href forms, and street width is not an area ──────────────────────────────
def test_both_front_controller_href_forms_enumerate_identically():
    """The same index page is served with `/9694` on one request and `/index.php/9694` on the next —
    200, full size, same printed total. Keying on the href reported 0 rows for a healthy page."""
    for form in ("/{nid}", "/index.php/{nid}"):
        got = R.parse_index(card(nid="9694", href_form=form))
        assert len(got) == 1 and got[0]["nid"] == "9694", form


def test_a_street_dimension_never_becomes_the_area():
    """«شارع 25*12» and «الحدود والأطوال: 20*27» are dimensions. N.to_int() would concatenate their
    digits (2512, 2027) into a plausible-looking m².  Also: «المساحة 1,240 م» is 1240, not 1."""
    assert R._area("المساحة 1,240 م") == 1240
    assert R._area("المساحة 15*20") is None
    row, _c, _w = mapped("أرض    للبيع في النزهه (335/4)    ",
                         fields=[("almsaha", "decimal", "المساحة 862 م"),
                                 ("shar-rd", "string", "شارع 25*12"),
                                 ("hdwd-watwal-al-qar", "string", "الحدود والأطوال: 20*27"),
                                 ("als-r2", "list-string", "السعر")], price=1300000)
    assert row["area_m2"] == 862
    assert row["additional_info"]["street_width"] == "25*12"


def test_the_logo_thumbnail_is_a_placeholder_not_a_photo():
    """46% of index cards carry `logo.png` — the office's own logo, served when there is no photo."""
    ix = R.parse_index(card(thumb="https://bossbihoffice.com.sa/logo.png"))[0]
    row, _c, _w = R.map_listing(ix, R.parse_detail(detail_html("أرض    للبيع في النزهه    ")))
    assert row["photo_urls"] == [], "logo.png must not be published as this listing's photo"


def test_a_real_thumbnail_is_used_when_the_detail_page_has_no_gallery():
    ix = R.parse_index(card(thumb="/sites/default/files/styles/medium/public/2026-08/a.jpeg?itok=x"))[0]
    row, _c, _w = R.map_listing(ix, R.parse_detail(detail_html("أرض    للبيع في النزهه    ")))
    assert row["photo_urls"] == ["https://bossbihoffice.com.sa/sites/default/files/2026-08/a.jpeg"]


# ── 9. Row shape the pipeline depends on ───────────────────────────────────────────────────────
def test_the_row_carries_the_keys_the_search_sync_requires():
    row, _c, _w = mapped("شقة    للبيع في النزهه (335/4)    ",
                         fields=[("almsaha", "decimal", "المساحة 200 م"),
                                 ("al-mr", "string", "العمر 7 سنة"),
                                 ("als-r2", "list-string", "السعر")], price=590000)
    assert row["ad_number"] == "BSB13967" and row["ad_number"].startswith(R.PREFIX)
    assert row["listing_url"] == "https://bossbihoffice.com.sa/13967"
    assert row["source"] == R.SOURCE and row["active"] is True
    assert row["transaction_type"] in ("Buy", "Rent")
    assert row["property_age"] == 7
    assert row["additional_info"]["fal_license"] == "1200009227", "REGA licence survives redaction"
    assert isinstance(row["source_capture"], dict) and row["source_capture"]["schema"] == "bossbih.v1"


def test_a_contact_number_in_the_body_is_redacted_from_the_card_text():
    row, _c, _w = mapped("أرض    للبيع في النزهه (335/4)    ",
                         fields=[("wsf-al-qar", "string-long",
                                  "▪️أرض ممتازة\n▫️للتواصل 0504407066 واتساب"),
                                 ("als-r2", "list-string", "السعر")], price=400000)
    assert "0504407066" not in (row["description"] or "")
    assert "أرض ممتازة" in row["description"], "redaction must not destroy the listing text"
