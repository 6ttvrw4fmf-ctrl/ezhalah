"""حصاد الاقتصادية للعقارات (hasaadestate.com) barrier: a project page is a compound of UNIT
MODELS, a price range is not a price, «172 م2» is 172 and not 1722, and coming-soon / under-
construction / sold are skips.

Every assertion runs the SHIPPING functions — run.parse_project, run.map_units, run.first_int,
run.parse_price, run._signal_for, run.session, run.main — never a re-implementation. Only
to_catalog and find_district_in_text are stubbed (the barrier is offline).

PROVENANCE: PAGE_8404 is assembled from the live /projects/جوار-19/ page of 2026-09-24 (WordPress
post 8404), keeping byte-for-byte the blocks parse_project reads — the <body> tag, `.details`,
`.title_single`, the «17 وحدة سكنية» line, the `unit-modal-8625` area block, and three gallery <img>
tags (two from that page, one raw-Arabic path from /projects/شقق-جوار-21/). The three `.item` cards
are re-emitted through _item() — the live card markup with each card's live status, name, price,
spec chips and modal id verbatim; only the spec-chip icon URLs (never read) are replaced by the word
ICON and the indentation is not byte-identical. The SVG feature art, menus and scripts are omitted. RANGE_ITEM is the «نموذج A – مسكني 8» card's
price block from /projects/شقق-مسكني-8/ (post 8292); SOON_HEAD is the `.details` + `.title_single`
of /projects/جوار-23/ (post 9776). Nothing is constructed except where a test says SYNTHETIC.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.hasaad import run as R  # noqa: E402

_CATALOG = {"جدة": (5, 2), "الرياض": (3, 1)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: "حي السلامة" if text and "السلامة" in text else None

URL_8404 = "https://hasaadestate.com/projects/%d8%ac%d9%88%d8%a7%d8%b1-19/"


def _item(css, status, name, price, specs, uid):
    chips = "".join(f'''
                                                            <li class="list-inline-item">
                                                            <span><img src="ICON" /></span>
                                                            <span>{c}</span>
                                                        </li>''' for c in specs)
    return f'''<div class="item {css}">
                                        <div class="d-flex justify-content-start align-items-center top">
                                            <div class="image">
                                                <img src="" />
                                                <span class="status">{status}</span>
                                            </div>
                                            <div class="text">
                                                <h3>{name}</h3>
                                                <p>{price}</p>
                                            </div>
                                        </div>
                                        <div class="center_">
                                            <ul class="list-inline d-flex justify-content-start flex-wrap">{chips}
                                                                                                </ul>
                                        </div>
                                        <div class="btns d-flex justify-content-start align-items-stretch">
                                            <a href="#" data-name="{name}"
                                               data-toggle="modal"
                                               data-target="#unit-modal-{uid}"'''


HEAD_8404 = '''<body  class="rtl wp-singular projects-template-default single single-projects postid-8404 wp-theme-HASAAD"  itemscope="itemscope" itemtype="http://schema.org/WebPage">
<div class="details">
                                 <ul class="list-unstyled d-flex">
                                      <li class="d-flex align-items-center">
                                                                                                                                                                                          <p>متاح</p>
                                                                                                                                  </li>
                                      <li class="d-flex align-items-center">
                                         <p>عقار</p>
                                     </li>
                                 </ul>
                        </div>
                         <div class="title_single">
                                <h2>شقق جوار 19</h2>
                                <p>جدة - السلامة 2</p>
                        </div>
<span>جدة - السلامة 2</span> <span>172 - 289  م مربع</span> <span>17 وحدة سكنية</span>
<img src="https://i0.wp.com/hasaadestate.com/wp-content/uploads/2025/10/16-1.jpg" />
<img src="https://i0.wp.com/hasaadestate.com/wp-content/uploads/2025/10/15-1.jpg" />
<img src="https://hasaadestate.com/wp-content/uploads/2025/11/بروشور-جوار-21_pages-to-jpg-0012.jpg" />
<img src="https://hasaadestate.com/wp-content/uploads/2025/10/Artboard-1-1.png" />
'''
ITEMS_8404 = (
    _item("red", "مباع", "نموذج A – جوار 19", "980,000",
          ["3 غرف نوم ", "مجلس", "غرفة طعام", "غرفة معيشة", "مطبخ ", "3 دورات مياه", "غرفة خادمة"], 9067)
    + _item("green", "متاح", "نموذج B – جوار 19", "950,000 ريال",
            ["3 غرف نوم", "مجلس", "غرفة طعام", "غرفة معيشة", "مطبخ", "3 دورات مياه", "غرفة خادمة"], 8625)
    + _item("green", "متاح", "نموذج روف – جوار 19", "1,450,000 ريال",
            ["3 غرف نوم", "مجلس", "غرفة طعام", "غرفة معيشة", "مطبخ", "4 دورات مياه", "غرفة خادمة", "غرفة غسيل"], 8629)
)
MODAL_8625 = '''
<div class="modal fade" id="unit-modal-8625" tabindex="-1">
                                                                <div class="area_det">
                                                                    <h1>تفاصيل المساحة</h1>
                                                                            <div class="ar-item">
                                                                                <h2>المساحة الداخلية</h2>
                                                                                <p>172 م2</p>
                                                                            </div>
'''
PAGE_8404 = HEAD_8404 + ITEMS_8404 + MODAL_8625

RANGE_ITEM = _item("green", "متاح", "نموذج A &#8211; مسكني 8", "1,100,000 - 1,150,000",
                   ["3 غرف نوم", "صالون", "غرفة طعام", "صالة معيشة", "مطبخ", "4 دورات مياه", "غرفة خادمة", "غرفة غسيل"], 8519)
SOON_HEAD = '''<body  class="rtl wp-singular projects-template-default single single-projects postid-9776 wp-theme-HASAAD">
<div class="details">
                                 <ul class="list-unstyled d-flex">
                                      <li class="d-flex align-items-center">

                                             <p>غير متاح</p>
                                                                                 </li>
                                      <li class="d-flex align-items-center">
                                         <p>عقار</p>
                                     </li>
                                 </ul>
</div>
 <div class="title_single">
                                <h2>جوار 23 &#8211; (قريبا)</h2>
                                <p>جدة -  السلامة </p>
                        </div>
'''


# ── 1. THE PAGE IS READ AS THE SOURCE WROTE IT ──────────────────────────────────────────────────
def test_parse_project_reads_the_project_facts_and_every_unit_card():
    p = R.parse_project(PAGE_8404)
    assert p["post_id"] == "8404" and p["title"] == "شقق جوار 19" and p["status_chip"] == "متاح"
    assert p["city"] == "جدة" and p["district"] == "السلامة 2" and p["units_total"] == 17
    assert [(u["id"], u["css"], u["status"], u["price_raw"]) for u in p["units"]] == [
        ("9067", "red", "مباع", "980,000"), ("8625", "green", "متاح", "950,000 ريال"),
        ("8629", "green", "متاح", "1,450,000 ريال")]
    assert p["units"][1]["area_raw"] == "172 م2" and p["units"][0]["area_raw"] is None
    assert p["units"][2]["specs"][-1] == "غرفة غسيل"
    assert p["photos"] == [
        "https://i0.wp.com/hasaadestate.com/wp-content/uploads/2025/10/16-1.jpg",
        "https://i0.wp.com/hasaadestate.com/wp-content/uploads/2025/10/15-1.jpg",
        "https://hasaadestate.com/wp-content/uploads/2025/11/%D8%A8%D8%B1%D9%88%D8%B4%D9%88%D8%B1-%D8%AC%D9%88%D8%A7%D8%B1-21_pages-to-jpg-0012.jpg",
    ]                                                     # the PNG icon is not a photo; Arabic is encoded


def test_each_available_model_is_one_row_and_the_area_digit_is_not_folded_into_the_number():
    rows, skips = R.map_units(URL_8404, R.parse_project(PAGE_8404))
    assert skips == {"sold": 1}
    assert [r["ad_number"] for r in rows] == ["HSD8404U8625", "HSD8404U8629"]
    b, roof = rows
    assert b["listing_url"] == URL_8404 and b["transaction_type"] == "Buy" and b["property_type"] == "Apartment"
    assert b["price_total"] == 950000 and b["price_evidence"]["raw"] == "950,000 ريال"
    assert b["area_m2"] == 172                            # «172 م2» — NOT 1722
    assert b["bedrooms"] == 3 and b["bathrooms"] == 3 and roof["bathrooms"] == 4
    assert b["reception_rooms_majlis"] == 1 and b["halls"] == 1
    assert b["kitchen"] is True and b["maid_room"] is True
    assert "laundry_room" not in b and roof["laundry_room"] is True
    assert "elevator" not in b and "parking" not in b       # silent stays absent
    assert b["city_ar"] == "جدة" and b["city_id"] == 5 and b["district_ar"] == "حي السلامة"
    assert b["neighborhood"] == "السلامة 2"
    assert b["title"] == "نموذج B – جوار 19 – شقق جوار 19"
    assert len(b["photo_urls"]) == 3 and roof["area_m2"] is None
    assert b["additional_info"]["unit_post_id"] == "8625" and b["additional_info"]["project_units_total"] == 17


def test_first_int_and_parse_price_read_only_what_is_printed():
    assert R.first_int("172 م2") == 172 and R.first_int("150 2م") == 150 and R.first_int("٢٠٥ م2") == 205
    assert R.first_int("") is None and R.first_int(None) is None
    assert R.parse_price("950,000 ريال") == (950000, False)
    assert R.parse_price("1,130,000") == (1130000, False)
    assert R.parse_price("1,100,000 - 1,150,000") == (None, True)
    assert R.parse_price("990,000 -980,000") == (None, True)
    assert R.parse_price("") == (None, False)


# ── 2. A RANGE IS NOT A PRICE ───────────────────────────────────────────────────────────────────
def test_a_price_range_is_kept_verbatim_and_never_stored_as_a_figure():
    page = HEAD_8404.replace("postid-8404", "postid-8292").replace("<h2>شقق جوار 19</h2>", "<h2>شقق مسكني 8</h2>") + RANGE_ITEM
    rows, skips = R.map_units("https://hasaadestate.com/projects/x/", R.parse_project(page))
    assert skips == {} and len(rows) == 1
    r = rows[0]
    assert r["ad_number"] == "HSD8292U8519" and r["price_total"] is None
    assert r["price_evidence"]["raw"] == "1,100,000 - 1,150,000" and r["price_evidence"]["stored"] is None
    assert r["additional_info"]["price_range"] == "1,100,000 - 1,150,000"
    assert r["halls"] == 1 and r["reception_rooms_majlis"] is None     # «صالة معيشة» yes, «صالون» is not a مجلس


# ── 3. SKIP, NEVER GUESS ────────────────────────────────────────────────────────────────────────
def test_coming_soon_under_construction_untyped_and_unplaceable_projects_are_skipped():
    soon = R.parse_project(SOON_HEAD + ITEMS_8404)
    assert soon["status_chip"] == "غير متاح" and "(قريبا)" in soon["title"]
    assert R.map_units("u", soon) == ([], {"coming_soon": 3})
    # Each half of the gate on its own: a plain title with the «غير متاح» chip, and a «(قريبا)»
    # title with the «متاح» chip (SYNTHETIC — live جوار 23 carries both signals at once).
    chip_only = R.parse_project(HEAD_8404.replace("<p>متاح</p>", "<p>غير متاح</p>") + ITEMS_8404)
    assert chip_only["title"] == "شقق جوار 19" and R.map_units("u", chip_only) == ([], {"coming_soon": 3})
    title_only = R.parse_project(SOON_HEAD.replace("<p>غير متاح</p>", "<p>متاح</p>") + ITEMS_8404)
    assert title_only["status_chip"] == "متاح" and R.map_units("u", title_only) == ([], {"coming_soon": 3})
    uc = R.parse_project(HEAD_8404.replace("<h2>شقق جوار 19</h2>", "<h2>جوار 24 &#8211; مشروع تحت الإنشاء</h2>") + ITEMS_8404)
    assert R.map_units("u", uc) == ([], {"under_construction": 3})
    untyped = R.parse_project(HEAD_8404.replace("<h2>شقق جوار 19</h2>", "<h2>مشروع النخبة</h2>") + ITEMS_8404)
    assert R.map_units("u", untyped) == ([], {"type_unmapped": 3})
    lost = R.parse_project(HEAD_8404.replace("<p>جدة - السلامة 2</p>", "<p>بلدة مجهولة - السلامة 2</p>") + ITEMS_8404)
    assert R.map_units("u", lost) == ([], {"city_not_in_catalog": 3})
    assert R.map_units("u", R.parse_project(HEAD_8404)) == ([], {"no_units": 1})
    assert R.map_units("u", R.parse_project(ITEMS_8404)) == ([], {"no_post_id": 1})


def test_a_villa_project_maps_by_its_titles_own_word():
    villa = R.parse_project(HEAD_8404.replace("<h2>شقق جوار 19</h2>", "<h2>فلل كورتيارد هومز</h2>") + ITEMS_8404)
    rows, _ = R.map_units("u", villa)
    assert {r["property_type"] for r in rows} == {"Villa"}


# ── 4. THE REMOVAL ORACLE ───────────────────────────────────────────────────────────────────────
def test_the_signal_reads_the_unit_out_of_its_project_page():
    live = R._signal_for("8404", "8625")
    assert live(200, PAGE_8404, True) == "live"
    assert R._signal_for("8404", "9067")(200, PAGE_8404, True) == "gone"       # «مباع», red
    assert R._signal_for("8404", "9999")(200, PAGE_8404, True) == "gone"       # no longer on the page
    assert R._signal_for("8138", "8625")(200, PAGE_8404, True) is None         # another project's page
    # Only WordPress's own 404 template kills (measured: /?p=8000 → `class="rtl error404 …"`).
    assert live(404, '<body  class="rtl error404 wp-theme-HASAAD"><h1>الصفحة غير موجودة</h1>', False) == "gone"
    assert live(404, "<html>not found</html>", False) is None                # a WAF/CDN 404 says nothing
    assert live(200, "<html>maintenance</html>", False) is None
    assert live(403, PAGE_8404, False) is None
    assert R._verify_gone("HSD8404")[0] == "unknown"


def test_session_asks_for_arabic():
    assert R.session().headers.get("Accept-Language", "").startswith("ar")


# ── 5. THE RUN LEDGER ───────────────────────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


class _FakeSession:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, **_kw):
        return self.pages.get(url, _Resp(404, ""))


def test_the_skip_tally_reaches_end_run(monkeypatch):
    calls: dict = {}
    written: dict = {}
    pruned: list = []
    pages = {URL_8404: _Resp(200, PAGE_8404),
             "https://hasaadestate.com/projects/j23/": _Resp(200, SOON_HEAD + ITEMS_8404)}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "PAUSE", 0)
    monkeypatch.setattr(R, "session", lambda: _FakeSession(pages))
    monkeypatch.setattr(R, "fetch_project_urls", lambda s, limit=0: list(pages))
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: written.__setitem__(t, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen))) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 6 and calls["rows_upserted"] == 2
    assert "coming_soonx3" in calls["notes"] and "soldx1" in calls["notes"] and "pages=2/2" in calls["notes"]
    assert calls["check_tables"] == ["hasaad_residential_listings", "hasaad_commercial_listings"]
    assert [r["ad_number"] for r in written["hasaad_residential_listings"]] == ["HSD8404U8625", "HSD8404U8629"]
    assert ("hasaad_residential_listings", {"HSD8404U8625", "HSD8404U8629"}) in pruned


def test_a_page_that_did_not_load_blocks_the_prune(monkeypatch):
    pruned: list = []
    calls: dict = {}
    pages = {URL_8404: _Resp(200, PAGE_8404)}      # the second sitemap page 404s in the fake transport
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "PAUSE", 0)
    monkeypatch.setattr(R, "session", lambda: _FakeSession(pages))
    monkeypatch.setattr(R, "fetch_project_urls", lambda s, limit=0: [URL_8404, "https://hasaadestate.com/projects/missing/"])
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append(t) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)
    assert R.main() == 0
    assert pruned == [] and "http_404x1" in calls["notes"] and calls["rows_upserted"] == 2
