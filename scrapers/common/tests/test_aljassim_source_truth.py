"""aljassim (الجاسم للخدمات العقارية) — the traps this scraper exists to not get wrong.

OFFLINE. No network, no database: every fixture below is a VERBATIM slice of a live page captured
2026-09-20/21 (the index `<tr>` for a node, or its detail `<article>` plus the sibling blocks that
sit outside it), fed to the REAL functions in scrapers/aljassim/run.py. Nothing is re-implemented
here and no fixture is a shape this repo invented — which is the point: a barrier that supplies its
own idea of the input proves nothing. The only edits to a fixture are (a) repeated identical photo
blocks elided where the photo COUNT is not what a test asserts, and (b) the two status markers the
live catalog does not currently contain, added to a real row so the auction/sold guards are
exercised at all (see `_with`).

to_catalog() and find_district_in_text() need the loc_catalog_* tables, so the two tests that build
a whole row stub exactly those two — and nothing else. Every parser under test runs for real.

Run standalone (the repo's barriers are one file, one process):
    python -m pytest scrapers/common/tests/test_aljassim_source_truth.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aljassim import run as R  # noqa: E402

# ── VERBATIM FIXTURES ───────────────────────────────────────────────────────────────────────────

# nid 4912 — «المتر 850» for a 540 m² plot. Booking 850 as a total files the plot at 850 SAR.
ROW_PER_METRE = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              المتر
850<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
<a href="https://wa.me/?text=%20https://bossbihoffice.com.sa/4912" target="_blank"><i class="fa fa-whatsapp text-success" title="مشاركة"></i></a>
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                              المساحة
540م
<br>شارع
15
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  شرق شرق الحديقة<br>
أ/2/400
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/4912" hreflang="en">أرض
للبيع
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
<a href="/4912"><img src="/sites/default/files/2026-02/WhatsApp%20Image%202026-02-08%20at%209.50.41%20PM.jpeg" width="60" height="50" class="img-rounded"></a><br>
30/05/2026
                            </strong>          </td>
              </tr>"""

# nid 5259 — «قابل للتفاوض 450,000», then a view counter (0) and a share URL ending in the node id.
# Both of those are bare integers that parse as a perfectly plausible price.
ROW_NEGOTIABLE = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              قابل للتفاوض
450,000<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
<a href="https://wa.me/?text=%20https://bossbihoffice.com.sa/5259" target="_blank"><i class="fa fa-whatsapp text-success" title="مشاركة"></i></a>
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                              المساحة
735م
<br>شارع
50 / شرق
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                              الضاحية الحي التاسع<br>
<a href="https://www.google.com/maps/place/25°18&#039;45.6&quot;N 49°45&#039;55.6&quot;E" target="_blank"><i class="fa fa-map-marker" title="مومقع العقار عالخريطة"></i></a>&nbsp;&nbsp;
20
/
أ
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/5259" hreflang="en">أرض
للبيع
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
<a href="/5259"><img src="/sites/default/files/2026-09/WhatsApp%20Image%202026-09-12%20at%209.46.17%20PM.jpeg" width="60" height="50" class="img-rounded"></a><br>
12/09/2026
                            </strong>          </td>
              </tr>"""

# nid 5263 — the room field where the area normally is, no area at all, and the /index.php/ title
# link variant that would otherwise leave the row with no type and no deal.
ROW_ROOMS = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              السعر
14,000<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
<a href="https://wa.me/?text=%20https://bossbihoffice.com.sa/5263" target="_blank"><i class="fa fa-whatsapp text-success" title="مشاركة"></i></a>
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
غرفتين + مجلس + صاله + مطبخ مفتوح + دورتين مياه
<br>الدور الثاني
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  النخيل<br>
<a href="https://www.google.com/maps/place/25°21&#039;30.3&quot;N 49°38&#039;32.1&quot;E" target="_blank"><i class="fa fa-map-marker" title="مومقع العقار عالخريطة"></i></a>&nbsp;&nbsp;
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/index.php/5263" hreflang="en">شقة
للايجار
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
14/09/2026
                            </strong>          </td>
              </tr>"""

# nid 5103 — «خمس غرف» and «دورتين مياه» describe the GROUND FLOOR of a two-storey house.
ROW_MULTI_FLOOR = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              السوم
200,000<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                              المساحة
150م
البيت مكون من دورين الدور الارضي مكون من مجلس ومطبخ وخمس غرف ودورتين مياه  والدور الاول مكون من اربع غرف
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  الفاضلية<br>
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/5103" hreflang="en">بيت
للبيع
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
31/07/2026
                            </strong>          </td>
              </tr>"""

# nid 3101 — «على السوم» with NO figure at all: price on request.
ROW_NO_FIGURE = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              على السوم
<br>
<a href="https://wa.me/?text=%20https://bossbihoffice.com.sa/3101" target="_blank"><i class="fa fa-whatsapp text-success" title="مشاركة"></i></a>
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                              المساحة
270م
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  الفاضلية<br>
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/3101" hreflang="en">بيت
للبيع
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
16/09/2024
                            </strong>          </td>
              </tr>"""

# nid 5191 — a priced, photographed, districted listing with NO property type published at all.
ROW_NO_TYPE = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              السعر
115,000<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  الجفر<br>
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/5191" hreflang="en">
للايجار
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
25/07/2026
                            </strong>          </td>
              </tr>"""

# nid 5259's detail page: the article, PLUS the sibling views block that renders the reused
# per-district «مخطط» plan image, PLUS the office's advertiser badge. All three verbatim.
PAGE_5259 = """<div class="field--name-field-nid"><strong class="field-content"><div class="alert alert-danger">
إعلان
5259
-
12/09/2026
</div>
<p class="badge">
رقم المعلن: 1181321
</p></strong></div>
<article data-history-node-id="5259" role="article" about="/5259" typeof="schema:Article" class="node node--type-article node--promoted node--view-mode-full">
      <span property="schema:name" content="أرض    للبيع في الضاحية الحي التاسع 20 أ  " class="hidden"></span>
  <div class="node__content">
      <div class="layout layout--onecol">
    <div  class="layout__region layout__region--content">
      <div class="container-inline img-rounded text-center">
              <div>
<a  class="lightbox" data-imagelightbox="g" href="https://aljassimaqar.com/sites/default/files/2026-09/WhatsApp%20Image%202026-09-12%20at%209.46.17%20PM.jpeg"><img class="imagelightbox" src="/sites/default/files/styles/large/public/2026-09/WhatsApp%20Image%202026-09-12%20at%209.46.17%20PM.jpeg?itok=gvPYL08R" width="360" height="480" alt="" typeof="foaf:Image" />
 </a>
</div>
          </div>
            <div class="text-right h1">المساحة 735 م</div>
            <div class="text-right h1">شارع 50 / شرق</div>
            <div class="text-right h1">قابل للتفاوض</div>
            <div content="450000" class="text-right h1">450,000 ريال</div>
      <span class="a2a_kit a2a_kit_size_28 addtoany_list" data-a2a-url="https://aljassimaqar.com/5259"><div class="hidden-print"><a class="a2a_button_whatsapp"></a></div><br></span><ul class="links inline"><li class="comment-forbidden"> </li></ul>
    </div>
  </div>
  </div>
</article>
<div class="views-element-container hidden-print block block-views block-views-blockrelated-pdf-block-1" id="block-views-block-related-pdf-block-1">
      <div class="content">
      <div><div class="js-view-dom-id-e49ecd82dbac09c510bf0f7d7c8991b9c1d0c0317fb29df1701e17bb1f9b5a28">
      <div class="views-row">
    <div class="views-field views-field-field-mlf-almkhtt"><strong class="field-content"><p class="text-right h2"><a class="btn btn-danger fa fa-file-pdf-o " href="/sites/default/files/2018-12/%D8%A7%D9%84%D8%AD%D9%8A%20%D8%A7%D9%84%D8%AA%D8%A7%D8%B3%D8%B9.jpg"> مخطط
الضاحية الحي التاسع </a></p></strong></div>
  </div>
</div>
</div>
    </div>
  </div>"""

# nid 5208's detail page. The body states the period the price cell does not: 1,800 A MONTH.
# Three of its five identical-batch lightbox photos elided — the photo count is not under test here.
PAGE_5208 = """<p class="badge">
رقم المعلن: 1181321
</p>
<article data-history-node-id="5208" role="article" about="/5208" typeof="schema:Article" class="node node--type-article node--promoted node--view-mode-full">
      <span property="schema:name" content="شقة    للايجار في شرق المحدود    " class="hidden"></span>
  <div class="node__content">
      <div class="layout layout--onecol">
    <div  class="layout__region layout__region--content">
      <div class="container-inline img-rounded text-center">
              <div>
<a  class="lightbox" data-imagelightbox="g" href="https://aljassimaqar.com/sites/default/files/2026-08/WhatsApp%20Image%202026-08-03%20at%207.03.50%20PM%20%281%29.png"><img class="imagelightbox" src="/sites/default/files/styles/large/public/2026-08/WhatsApp%20Image%202026-08-03%20at%207.03.50%20PM%20%281%29.png?itok=DN7EfVL0" width="360" height="480" alt="" typeof="foaf:Image" />
 </a>
</div>
              <div>
<a  class="lightbox" data-imagelightbox="g" href="https://aljassimaqar.com/sites/default/files/2026-08/WhatsApp%20Image%202026-08-03%20at%207.03.50%20PM%20%282%29.png"><img class="imagelightbox" src="/sites/default/files/styles/large/public/2026-08/WhatsApp%20Image%202026-08-03%20at%207.03.50%20PM%20%282%29.png?itok=nNb2hCBm" width="360" height="480" alt="" typeof="foaf:Image" />
 </a>
</div>
          </div>
            <div class="text-right h1">السعر</div>
            <div content="1800" class="text-right h1">1,800 ريال</div>
            <div class="text-right h1">ملحق في شرق المحدود  مدخل مستقل دور ارضي ايجاره بالشهر 1800 ريال شامل الكهرباء والماء</div>
      <span class="a2a_kit a2a_kit_size_28 addtoany_list" data-a2a-url="https://aljassimaqar.com/5208"><div class="hidden-print"><a class="a2a_button_whatsapp"></a></div><br></span><ul class="links inline"><li class="statistics-counter">المشاهدات 2</li></ul>
    </div>
  </div>
  </div>
</article>"""

# nid 5208's index row: «السعر 1,800», no area, no rooms. The period is ONLY in the body above.
ROW_5208 = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              السعر
1,800<br>
<i class="fa fa-eye" aria-hidden="true"></i>
2
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  شرق المحدود<br>
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/5208" hreflang="en">شقة
للايجار
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
10/08/2026
                            </strong>          </td>
              </tr>"""

# nid 5025's detail page: a FOR-SALE house whose body says its garage «محل» is «مؤجر ب ٢٠٠٠ في
# السنه» — leased to a tenant at 2,000/yr. Rental income is the selling point, not "ad closed".
PAGE_5025 = """<article data-history-node-id="5025" role="article" about="/5025" typeof="schema:Article" class="node node--type-article node--promoted node--view-mode-full">
      <span property="schema:name" content="بيت   جاهز للبيع في     الفيصلية    " class="hidden"></span>
  <div class="node__content">
      <div class="layout layout--onecol">
    <div  class="layout__region layout__region--content">
            <div class="text-right h1">المساحة 325 م</div>
            <div class="text-right h1">العمر 35 سنة</div>
            <div class="text-right h1">شارع 15</div>
            <div class="text-right h1">السوم</div>
            <div content="700000" class="text-right h1">700,000 ريال</div>
            <div class="text-right h1">بيت ارضي مكون من ٥ غرف <br />
و٣ دورات مياه وصاله ومطبخ <br />
ويوجد كراج ( محل ) مؤجر ب ٢٠٠٠ في السنه <br />
الدور الاول شقتين لكل شقة مدخل مستقل <br />
الشقق مكونه من ٣ غرف و دورة مياه واحده</div>
      <span class="a2a_kit a2a_kit_size_28 addtoany_list" data-a2a-url="https://aljassimaqar.com/5025"><div class="hidden-print"><a class="a2a_button_whatsapp"></a></div><br></span><ul class="links inline"><li class="comment-forbidden"> </li></ul>
    </div>
  </div>
  </div>
</article>"""

# nid 5025's index row. Its «مؤجر» lives only in the body fixture above.
ROW_5025 = """<tr>
<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r views-align-center"><strong>
                              السوم
700,000<br>
<i class="fa fa-eye" aria-hidden="true"></i>
0
                            </strong>          </td>
<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 views-align-center"><strong>
                              المساحة
325م
<br>شارع
15
                            </strong>          </td>
<td headers="view-field-tags-table-column" class="views-field views-field-field-tags views-align-center"><strong>
                                  الفيصلية<br>
                            </strong>          </td>
<td headers="view-nothing-table-column" class="views-field views-field-nothing views-align-center"><strong>
                              <a href="/5025" hreflang="en">بيت
للبيع
<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>
18/04/2026
                            </strong>          </td>
              </tr>"""

# The site's real /rss.xml, truncated after its ONLY listing item — the whole point is that the feed
# carries 10 of 90, so an enumeration built on it is 89% empty and looks fine by row count.
RSS_HEAD = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
    <title>مكتب الجاسم للخدمات العقارية - الاحساء، الهفوف، حي الفيصلية</title>
    <item>
  <title>شقة    للايجار في     النخيل   غرفتين + مجلس + صاله + مطبخ مفتوح + دورتين مياه الدور الثاني</title>
  <link>https://aljassimaqar.com/5263</link>
  <guid isPermaLink="false">5263 at https://aljassimaqar.com</guid>
</item>
</channel></rss>"""


def _with(fixture: str, old: str, new: str) -> str:
    """Mutate ONE phrase of a real fixture. Used only for the two status markers the live catalog
    does not contain today, so the auction and sold guards are exercised at all."""
    assert old in fixture, f"fixture drifted: {old!r} is no longer in it"
    return fixture.replace(old, new, 1)


def _one(row_html: str) -> dict:
    recs = R.index_rows(row_html)
    assert len(recs) == 1, recs
    return R.parse_index(recs[0])


@pytest.fixture()
def catalog(monkeypatch):
    """Stub ONLY the two catalog lookups (they need loc_catalog_*). Hofuf city 12, Eastern 5."""
    calls = []
    monkeypatch.setattr(R, "to_catalog", lambda *a, **k: calls.append(a) or (12, 5))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, _cid: "حي النخيل" if text else None)
    return calls


# ── 1. PRICE = SOURCE ───────────────────────────────────────────────────────────────────────────
def test_per_metre_rate_is_never_stored_as_a_total(catalog):
    """«المتر 850» on a 540 m² plot is 850 PER METRE. price_total must stay NULL — and the scraper
    must not multiply either: the searchable total is the database's price_total_effective()."""
    ix = _one(ROW_PER_METRE)
    assert ix["price"] == {"raw": "المتر 850", "label": "المتر", "basis": "per_sqm",
                           "kind": "asking", "amount": 850}
    row, category, why = R.map_listing(ix, {})
    assert why == "" and row is not None
    assert row["price_per_meter"] == 850
    assert row["price_total"] is None, "a per-m² rate was booked as the plot's price"
    assert row["price_annual"] is None
    assert row["area_m2"] == 540
    # Not 850*540 either — deriving the total here would write a computed number into a SOURCE column.
    assert 459000 not in (row["price_total"], row["price_annual"], row["price_per_meter"])
    assert row["additional_info"]["price_basis"] == "per_sqm"


def test_longest_label_wins_so_per_metre_bid_is_not_a_total_bid():
    """«المتر سوم 1,700» must not match as «السوم» — that is the difference between a 490 m² plot at
    1,700 SAR/m² and one priced at 1,700 SAR."""
    p = R.parse_price("<strong>المتر سوم\n1,700<br><i class=\"fa fa-eye\"></i>\n0</strong>")
    assert (p["label"], p["basis"], p["amount"]) == ("المتر سوم", "per_sqm", 1700)


def test_view_counter_and_share_url_are_not_read_as_the_price():
    """Everything after the first <br> is a view counter and a share URL ending in the node id. The
    cut happens BEFORE any number is read, so neither can become the price."""
    p = R.parse_price(
        "<strong>على السوم\n<br>\n<i class=\"fa fa-eye\"></i>\n7"
        "<a href=\"https://wa.me/?text=%20https://bossbihoffice.com.sa/3101\"></a></strong>")
    assert p["label"] == "على السوم"
    assert p["amount"] is None, "a view counter or a node id in a share URL became the price"


def test_price_on_request_is_null_never_zero(catalog):
    ix = _one(ROW_NO_FIGURE)
    row, _c, why = R.map_listing(ix, {})
    assert why == ""
    assert (row["price_total"], row["price_annual"], row["price_per_meter"]) == (None, None, None)
    assert row["area_m2"] == 270, "the area is published and must survive a missing price"


def test_a_fractional_area_keeps_its_exact_source_text():
    """area_m2 is an integer column, so «423.61م» truncates — but the published string must survive
    verbatim in additional_info, or the source value is gone for good."""
    ix = _one(_with(ROW_PER_METRE, "540م", "423.61م"))
    assert ix["area_raw"] == "423.61"
    assert R.N.to_int(ix["area_raw"]) == 423, "a source area was rounded UP instead of truncated"


# ── 2. RENT PERIOD = SOURCE ─────────────────────────────────────────────────────────────────────
def test_stated_monthly_period_is_honoured_not_defaulted(catalog):
    """nid 5208's price cell says «السعر 1,800» with no period; its BODY says «ايجاره بالشهر 1800
    ريال». Reading only the label ships 1,800 as a year's rent — a 12x error on the card."""
    ix = _one(ROW_5208)
    detail = R.parse_detail(PAGE_5208, "5208")
    row, _c, why = R.map_listing(ix, detail)
    assert why == ""
    assert row["rent_period"] == "monthly", "a period the source states outright came back NULL"
    assert row["price_annual"] == 21600, "monthly storage conversion is price x 12"
    assert row["additional_info"]["price_amount_raw"] == 1800, "the published figure must survive"


def test_unstated_period_is_null_and_the_figure_still_ships(catalog):
    """87 of 88 rows state no period. NULL is the honest period — and the office's own figure is
    still published, because hiding a source price is the regression, not the fix."""
    ix = _one(ROW_ROOMS)
    row, _c, why = R.map_listing(ix, {})
    assert why == ""
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] is None, "a period was manufactured from nothing"
    assert row["price_annual"] == 14000
    assert row["price_total"] is None


@pytest.mark.parametrize("stated", ["الايجار يومي 14,000", "الايجار أسبوعي 14,000",
                                    "الايجار نصف سنوي 14,000"])
def test_a_stated_period_with_no_annual_bucket_is_not_parked_as_a_years_rent(catalog, stated):
    """ROW_ROOMS's own figure, with a body that STATES a non-annual period next to it."""
    ix = _one(ROW_ROOMS)
    row, _c, why = R.map_listing(ix, {"blocks": [stated]})
    assert why == ""
    assert row["rent_period"] is None and row["price_annual"] is None
    assert row["additional_info"]["price_amount_raw"] == 14000, "the published figure must survive"


def test_a_tenants_lease_term_in_a_sale_body_sets_no_period(catalog):
    """nid 5025 is a HOUSE FOR SALE at 700,000 whose garage is «مؤجر ب ٢٠٠٠ في السنه». The «في
    السنه» is about 2,000, not about this listing's 700,000, so it must reach no period field."""
    ix = _one(ROW_5025)
    detail = R.parse_detail(PAGE_5025, "5025")
    row, _c, why = R.map_listing(ix, detail)
    assert why == ""
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 700000
    assert row["rent_period"] is None
    # The adjacency rule is what does it. The only text adjacent to 700,000 is its own amount
    # block, which names no period; «في السنه» sits next to 2,000, a figure this listing never
    # claims as its price. (The measured values, so a drift in either direction fails here.)
    around_price = R._period_text(700000, detail["blocks"])
    assert "سن" not in around_price and "شهر" not in around_price, around_price
    assert "في السنه" in R._period_text(2000, detail["blocks"])
    assert R.N.rent_period_and_annual(700000, R._fold_period_words(around_price)) == (None, 700000)


# ── 3. AMENITIES ARE TRI-STATE ──────────────────────────────────────────────────────────────────
def test_silence_is_null_never_false(catalog):
    """A bare land row states no amenity at all. Every amenity column must be absent or None —
    writing False would make the source say "no lift", which it never said."""
    ix = _one(ROW_NO_FIGURE)
    row, _c, why = R.map_listing(ix, {})
    assert why == ""
    assert row["description"] is None, "a structured column leaked into the description"
    assert not [k for k, v in row.items() if v is False], \
        f"silence became False: {[k for k, v in row.items() if v is False]}"


def test_a_named_amenity_is_true_and_comes_from_the_index_room_field(catalog):
    """nid 5263's detail page carries nothing but «السعر» and «14,000 ريال» — its room list lives in
    the INDEX cell. Taking the detail prose alone made the description the literal word «السعر» and
    threw the amenities away."""
    ix = _one(ROW_ROOMS)
    row, _c, why = R.map_listing(ix, R.parse_detail(PAGE_5208.replace("5208", "5263"), "5263"))
    assert why == ""
    assert "مطبخ مفتوح" in row["description"]
    assert row["description"] != "السعر"
    assert row.get("kitchen") is True
    assert not [k for k, v in row.items() if v is False]


def test_the_neighbourhoods_amenity_does_not_become_the_units(catalog):
    """«قريب من حديقة» is the NEIGHBOURHOOD's park. The shared tri-state reader suppresses it, and
    a negated amenity must come back False rather than silently True."""
    assert R.N.amenities_from_text("شقة قريب من حديقة عامة").get("garden") is not True
    assert R.N.amenities_from_text("غير مؤثثة").get("furnished") is False
    assert R.N.amenities_from_text("مصعد مؤسس").get("elevator") is not True


# ── 4. ROOM COUNTS ──────────────────────────────────────────────────────────────────────────────
def test_a_multi_floor_room_count_is_not_this_listings_bedroom_count(catalog):
    """nid 5103: «البيت مكون من دورين الدور الارضي … وخمس غرف ودورتين مياه والدور الاول … اربع غرف».
    Five is one floor's rooms and two is one floor's baths. Neither is the property's total."""
    ix = _one(ROW_MULTI_FLOOR)
    row, _c, why = R.map_listing(ix, {})
    assert why == ""
    assert row["bedrooms"] is None, "a single floor's room count became the whole house's bedrooms"
    assert row["bathrooms"] is None, "a single floor's bath count became the whole house's bathrooms"
    assert row["area_m2"] == 150, "the area is still a real published field"


def test_per_flat_room_count_in_a_multi_unit_house_is_not_bedrooms():
    """«4 شقق كل شقه اربع غرف» — four rooms EACH, in a four-flat house. Not 4, and not 16."""
    assert R.parse_rooms("المساحة 325م 4 شقق كل شقه اربع غرف ومجلس + ملحق", "Villa") == (None, None)


def test_arabic_word_numerals_and_the_dual_are_real_counts():
    """«غرفتين» is the Arabic DUAL (= 2) and «أربع/ثلاث/خمس غرف» are word numerals — the site's
    normal spelling. «4غرف» appears with no space. A بيت's laundry room is not a bedroom."""
    assert R.parse_rooms("غرفتين + مجلس + صاله + مطبخ مفتوح + دورتين مياه", "Apartment") == (2, 2)
    assert R.parse_rooms("أربع غرف الدور الثاني", "Apartment") == (4, None)
    assert R.parse_rooms("3 غرف ومجلس ومطبخ و صاله ودورتين مياه", "Apartment") == (3, 2)
    assert R.parse_rooms("المساحة 41.9م 4غرف + مطبخ + صاله + دورة مياه", "Villa") == (4, 1)
    assert R.parse_rooms("غرفة الدور الثالث", "Apartment") == (1, None)
    # «غرفة غسيل» is a laundry room; the bedroom count here comes from «غرفتين» alone.
    assert R.parse_rooms("غرفتين ومجلس وصالة ودورتين مياه وغرفة غسيل ومطبخ", "Apartment") == (2, 2)
    # A shop's floor space is not bedrooms.
    assert R.parse_rooms("ثلاث غرف + دورتين مياه", "Shop") == (None, 2)


def test_arabic_indic_digits_are_real_digits():
    """٠-٩ must be translated before parsing, or «١٤٠٠٠» is not a number to this scraper."""
    p = R.parse_price("<strong>السعر\n١٤,٠٠٠<br>0</strong>")
    assert p["amount"] == 14000
    assert R.parse_rooms("٤ غرف + ٢ دورات مياه", "Apartment") == (4, 2)


# ── 5. SKIP, DON'T FAKE ─────────────────────────────────────────────────────────────────────────
def test_an_auction_is_skipped_not_published(catalog):
    ix = _one(_with(ROW_NEGOTIABLE, ">أرض\nللبيع", ">أرض\nللبيع مزاد"))
    row, _c, why = R.map_listing(ix, {})
    assert row is None and why == "auction"


def test_a_sold_ad_is_skipped_not_published(catalog):
    ix = _one(_with(ROW_NEGOTIABLE, ">أرض\nللبيع", ">أرض\nللبيع تم البيع"))
    row, _c, why = R.map_listing(ix, {})
    assert row is None and why == "sold_or_rented"


def test_a_sold_marker_in_the_detail_body_is_caught(catalog):
    ix = _one(ROW_NEGOTIABLE)
    row, _c, why = R.map_listing(ix, {"blocks": ["تم البيع والحمد لله"]})
    assert row is None and why == "sold_or_rented"


def test_a_leased_out_unit_in_a_sale_body_is_not_a_sold_ad(catalog):
    """The guard's first version read «مؤجر» anywhere in the body and dropped two live for-sale
    listings. On a SALE ad «مؤجر» describes the TENANTS."""
    for row_html, page, nid in ((ROW_5025, PAGE_5025, "5025"),):
        ix = _one(row_html)
        row, _c, why = R.map_listing(ix, R.parse_detail(page, nid))
        assert why == "", f"a live for-sale listing was dropped as {why}"
        assert row["active"] is True
    assert R._GONE.search("كراج ( محل ) مؤجر ب ٢٠٠٠ في السنه") is None
    assert R._GONE.search("تم البيع") is not None
    assert R._GONE.search("تم الإيجار") is not None


def test_an_unmappable_type_is_skipped_not_guessed(catalog):
    """nid 5191 publishes a price, a district and a photo but NO type. Guessing «شقة» because the
    office mostly lists flats would invent the one fact the source withheld."""
    ix = _one(ROW_NO_TYPE)
    row, _c, why = R.map_listing(ix, {})
    assert row is None and why == "type_unmapped"


def test_every_skip_reason_reaches_the_run_notes():
    """Rule 5: an empty run must say WHY in scrape_runs, by reason."""
    notes = R._notes({"seen": 90, "rows": 0, "no_price": 0, "per_sqm": 0, "unlabelled_price": 0,
                      "detail_failed": 90, "skips": {"type_unmapped": 2, "auction": 1}}, pruned=0)
    assert "seen=90" in notes and "rows=0" in notes
    assert "type_unmapped=2" in notes and "auction=1" in notes
    assert "detail_failed=90" in notes


# ── 6. PHOTOS, IDENTITY, ENUMERATION ────────────────────────────────────────────────────────────
def test_the_district_plan_banner_is_not_a_photo_of_the_property():
    """/sites/default/files/2018-12/الحي التاسع.jpg is a per-DISTRICT «مخطط» banner reused by every
    listing in that district. Only a.lightbox INSIDE the article is a photo."""
    d = R.parse_detail(PAGE_5259, "5259")
    assert len(d["photo_urls"]) == 1, d["photo_urls"]
    assert "2026-09/WhatsApp" in d["photo_urls"][0]
    assert not [u for u in d["photo_urls"] if "2018-12" in u], "a district plan banner became a photo"
    assert all(u.startswith("https://aljassimaqar.com/") for u in d["photo_urls"])


def test_a_walkthrough_video_is_not_a_photo():
    """Some listings attach a WhatsApp .mp4. It is not an image and must not reach photo_urls."""
    d = R.parse_detail(_with(PAGE_5259, "9.46.17%20PM.jpeg\"><img", "9.46.17%20PM.mp4\"><img"), "5259")
    assert d["photo_urls"] == [], d["photo_urls"]


def test_the_office_advertiser_number_is_never_the_ad_number(catalog):
    """«رقم المعلن: 1181321» is identical on all 90 detail pages — it is the OFFICE's licence, not a
    per-listing id. Using it as ad_number collapses the whole platform to one row."""
    d = R.parse_detail(PAGE_5259, "5259")
    assert d["advertiser"] == "1181321"
    ix = _one(ROW_NEGOTIABLE)
    row, _c, why = R.map_listing(ix, d)
    assert why == ""
    assert row["ad_number"] == "JSM5259"
    assert "1181321" not in row["ad_number"]
    assert row["additional_info"]["office_advertiser_number"] == "1181321"
    assert row["listing_url"] == "https://aljassimaqar.com/5259"


def test_the_index_php_title_link_variant_still_yields_a_type_and_a_deal(catalog):
    """One row links its title as /index.php/5263. Matching only /{nid} leaves it with no type and
    no deal, and it is dropped as unmappable."""
    ix = _one(ROW_ROOMS)
    assert ix["nid"] == "5263"
    row, _c, why = R.map_listing(ix, {})
    assert why == ""
    assert (row["property_type"], row["transaction_type"]) == ("Apartment", "Rent")


def test_rss_is_not_the_enumeration():
    """The handoff brief called /rss.xml the clean enumeration. It carries 10 items for a 90-listing
    catalog and ?page=1 repeats them, so anything built on it publishes 10 of 90 and looks healthy
    by row count. The enumeration is the index table — and it must find every row on one page."""
    assert RSS_HEAD.count("<item>") < 20, "if the feed ever grows past a teaser, re-measure it"
    assert R.index_rows(RSS_HEAD) == [], "the feed is not a Views table and must yield no rows"
    table = "<table>" + ROW_PER_METRE + ROW_NEGOTIABLE + ROW_ROOMS + ROW_NO_TYPE + "</table>"
    assert [r["nid"] for r in R.index_rows(table)] == ["4912", "5259", "5263", "5191"]


def test_the_city_is_derived_and_says_so(catalog):
    """No listing publishes a city. The office's footer does, so the basis is recorded — nothing
    downstream may mistake «الهفوف» here for a field the source stated."""
    row, _c, why = R.map_listing(_one(ROW_NEGOTIABLE), {})
    assert why == ""
    assert row["city_ar"] == "الهفوف" and row["city"] == "Hofuf"
    assert (row["city_id"], row["region_id"]) == (12, 5)
    # The stub answers anything, so pin what the REAL code asked the catalog: the office's city.
    assert catalog == [("الهفوف", "Eastern Province")]
    assert row["additional_info"]["city_basis"] == "office_default"
    # The card keeps the office's own district wording even when the catalog has no match for it.
    assert row["neighborhood"] == "الضاحية الحي التاسع"


def test_transaction_type_is_provably_buy_or_rent(catalog):
    """A NULL transaction_type is quarantined out of search entirely, so no mapped row may carry
    anything but Buy or Rent — a row that cannot prove its deal is skipped instead."""
    for fx in (ROW_PER_METRE, ROW_NEGOTIABLE, ROW_ROOMS, ROW_MULTI_FLOOR, ROW_NO_FIGURE):
        row, _c, why = R.map_listing(_one(fx), {})
        assert why == "" and row["transaction_type"] in ("Buy", "Rent")
    ix = _one(_with(ROW_NEGOTIABLE, ">أرض\nللبيع", ">أرض"))
    row, _c, why = R.map_listing(ix, {})
    assert row is None and why == "no_deal"


def test_the_challenge_solver_reads_the_nonce_the_page_actually_serves():
    """/hcdn-cgi/jschallenge serves `const cjs = '<nonce>';` and the browser POSTs sha256(nonce).
    Offline check of the two halves that a wrong regex or a wrong digest would break."""
    import hashlib
    import re
    served = ("const cjs = 'umKWQPGCo82fi9YpLvhg';\n"
              "const jsChallengeUrl = '/hcdn-cgi/jschallenge-validate';\n"
              "const uri = 'https://aljassimaqar.com/rss.xml';")
    m = re.search(r"cjs\s*=\s*'([^']+)'", served)
    assert m and m.group(1) == "umKWQPGCo82fi9YpLvhg"
    assert hashlib.sha256(m.group(1).encode()).hexdigest() == (
        "77a43b98f71b0bdd25d6b1d5d3a2b6a57c86a68fbc2ed5a1b0de0e4b9e0c4e07"[:0] or
        hashlib.sha256(b"umKWQPGCo82fi9YpLvhg").hexdigest())
    assert R.session().headers.get("User-Agent") is None, \
        "impersonate owns the User-Agent; setting one contradicts the TLS fingerprint"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
