"""عقار الرياض (aqaralriyadh.com) barrier: the labelled block is the record, the period is the
source's own word, and a WordPress 404 is the only death.

Every assertion runs the SHIPPING functions — run.map_listing, run.labelled_fields, run.count,
run.yes_no, run._signal / run._url_for, run.session, run.main — never a re-implementation. Only
to_catalog and find_district_in_text are stubbed (the barrier is offline).

PROVENANCE: the three post payloads are copied VERBATIM from
`GET https://aqaralriyadh.com/wp-json/wp/v2/posts?_fields=id,link,title,content,status,categories`
on 2026-09-24 (posts 332, 326, 312), trimmed to the keys map_listing reads. The 333 payload carries
the live values of post 333 that day (price 40,000, 92 m², «غرفتان», حي الحائر) in the identical
block template every post uses — it is the one post that writes the dual «غرفتان», the word-numeral
trap this file exists to pin. Two variations are SYNTHETIC and say so: a price cell without its
period word, and a phone number in the prose. Neither shape exists live; both pin a rule.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqaralriyadh import run as R  # noqa: E402

_CATALOG = {"الرياض": (3, 1), "جدة": (5, 2)}
R.to_catalog = lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None))
R.find_district_in_text = lambda text, city_id: (text or "").strip() or None

CATS = {1: "الكل", 175: "شقق للإيجار", 174: "شقق للبيع", 187: "شقق مفروشة",
        191: "عقارات استثمارية للبيع", 177: "فلل للإيجار"}

POST_332 = {"id": 332, "link": "https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%ac%d9%86%d8%a7%d8%af%d8%b1%d9%8a%d8%a9-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/", "status": "publish", "categories": [1, 175], "title": {"rendered": "شقة للإيجار في حي الجنادرية – الرياض"}, "content": {"rendered": "\n<p class=\"wp-block-paragraph\"><strong>المدينة:</strong> الرياض<br><strong>الحي:</strong> حي الجنادرية<br><strong>السعر:</strong> 52,000 ريال سنويًا<br><strong>المساحة:</strong> 134 م²<br><strong>عدد الغرف:</strong> 3 غرف<br><strong>الصالات:</strong> صالة<br><strong>دورات المياه:</strong> 3</p>\n\n\n\n<p class=\"wp-block-paragraph\">شقة للإيجار في حي الجنادرية توفر مساحة مناسبة للعائلات، وتقع في موقع يسهل الوصول منه إلى مختلف الخدمات.</p>\n", "protected": False}}
POST_326 = {"id": 326, "link": "https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%aa%d8%b9%d8%a7%d9%88%d9%86-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/", "status": "publish", "categories": [1, 175], "title": {"rendered": "شقة للإيجار في حي التعاون – الرياض"}, "content": {"rendered": "\n<p class=\"wp-block-paragraph\"><strong>المدينة:</strong> الرياض<br><strong>الحي:</strong> حي التعاون<br><strong>السعر:</strong> 69,000 ريال سنويًا<br><strong>المساحة:</strong> 189 م²<br><strong>عدد الغرف:</strong> 5 غرف<br><strong>الصالات:</strong> صالتان<br><strong>دورات المياه:</strong> 4</p>\n\n\n\n<p class=\"wp-block-paragraph\">شقة واسعة للإيجار في حي التعاون بالقرب من المراكز التجارية والمطاعم والخدمات، وتتميز بجودة التشطيب واتساع المساحات.</p>\n", "protected": False}}
POST_312 = {"id": 312, "link": "https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d8%b4%d8%a8%d9%8a%d9%84%d9%8a%d8%a9-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/", "status": "publish", "categories": [1, 175], "title": {"rendered": "شقة للإيجار في حي اشبيلية – الرياض"}, "content": {"rendered": "\n<p class=\"wp-block-paragraph\"><strong>المدينة:</strong> الرياض<br><strong>الحي:</strong> حي اشبيلية<br><strong>السعر:</strong> 73,000 ريال سنويًا<br><strong>المساحة:</strong> 210 م²<br><strong>عدد الغرف:</strong> 5 غرف<br><strong>الصالات:</strong> صالتان<br><strong>دورات المياه:</strong> 4<br><strong>المطبخ:</strong> مجهز بالكامل<br><strong>الدور:</strong> الثالث<br><strong>المصعد:</strong> متوفر<br><strong>موقف سيارة:</strong> خاص</p>\n\n\n\n<p class=\"wp-block-paragraph\">شقة واسعة للإيجار في حي اشبيلية، تتميز بقربها من المدارس والمراكز التجارية والخدمات، مع تشطيبات راقية ومساحات داخلية مريحة تناسب العائلات الكبيرة.</p>\n", "protected": False}}
POST_333 = {"id": 333, "link": "https://aqaralriyadh.com/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%ad%d9%8a-%d8%a7%d9%84%d8%ad%d8%a7%d8%a6%d8%b1-%d8%a7%d9%84%d8%b1%d9%8a%d8%a7%d8%b6/", "status": "publish", "categories": [1, 175], "title": {"rendered": "شقة للإيجار في حي الحائر – الرياض"}, "content": {"rendered": "\n<p class=\"wp-block-paragraph\"><strong>المدينة:</strong> الرياض<br><strong>الحي:</strong> حي الحائر<br><strong>السعر:</strong> 40,000 ريال سنويًا<br><strong>المساحة:</strong> 92 م²<br><strong>عدد الغرف:</strong> غرفتان<br><strong>الصالات:</strong> صالة<br><strong>دورات المياه:</strong> 2</p>\n\n\n\n<p class=\"wp-block-paragraph\">شقة اقتصادية للإيجار في حي الحائر، مناسبة للأسر الصغيرة، وتتميز بقربها من الخدمات الأساسية وسهولة التنقل.</p>\n", "protected": False}}


def _row(post, cats=CATS):
    row, cat, why = R.map_listing(post, cats)
    assert row is not None, why
    return row, cat


def _with_content(post, html):
    return {**post, "content": {"rendered": html}}


# ── 1. PRICE + PERIOD = the source's own words ──────────────────────────────────────────────────
def test_the_price_and_its_annual_period_come_from_the_labelled_block():
    row, cat = _row(POST_332)
    assert row["ad_number"] == "AQR332" and row["listing_url"] == POST_332["link"]
    assert row["transaction_type"] == "Rent" and row["property_type"] == "Apartment"
    assert cat == "residential"
    assert row["price_annual"] == 52000 and row["rent_period"] == "annual"
    assert "price_total" not in row
    assert row["price_evidence"]["raw"] == "52,000 ريال سنويًا" and row["price_evidence"]["stored"] == 52000
    assert row["city_ar"] == "الرياض" and row["city_id"] == 3 and row["region_id"] == 1
    assert row["district_ar"] == "حي الجنادرية" and row["neighborhood"] == "حي الجنادرية"
    assert row["area_m2"] == 134 and row["bedrooms"] == 3 and row["halls"] == 1 and row["bathrooms"] == 3
    assert row["photo_urls"] is None                    # source-does-not-publish
    assert row["description"].startswith("شقة للإيجار في حي الجنادرية")


def test_a_price_without_its_period_word_stays_period_null_and_unconverted():
    """SYNTHETIC: post 332's own block with «سنويًا» removed. Silent → NULL, never a default."""
    html = POST_332["content"]["rendered"].replace("52,000 ريال سنويًا", "52,000 ريال")
    row, _ = _row(_with_content(POST_332, html))
    assert row["price_annual"] == 52000 and "rent_period" not in row


def test_a_monthly_word_is_honoured_as_monthly_x12_and_a_daily_one_is_no_period_at_all():
    """SYNTHETIC period words on the real block: the shared reader decides, the scraper obeys."""
    monthly = POST_332["content"]["rendered"].replace("52,000 ريال سنويًا", "4,500 ريال شهري")
    row, _ = _row(_with_content(POST_332, monthly))
    assert row["rent_period"] == "monthly" and row["price_annual"] == 54000
    daily = POST_332["content"]["rendered"].replace("52,000 ريال سنويًا", "300 ريال يومي")
    row, _ = _row(_with_content(POST_332, daily))
    assert row["price_annual"] is None and "rent_period" not in row


# ── 2. ARABIC NOTATION PARITY: digits, duals and word numerals ──────────────────────────────────
def test_the_dual_and_word_numeral_room_counts_are_read():
    row, _ = _row(POST_326)
    assert row["bedrooms"] == 5 and row["halls"] == 2          # «5 غرف», «صالتان»
    row, _ = _row(POST_333)
    assert row["bedrooms"] == 2 and row["halls"] == 1          # «غرفتان», «صالة»
    assert R.count("ثلاث غرف") == 3 and R.count("٤ غرف") == 4 and R.count("صالة كبيرة") == 1
    assert R.count("صالة واحدة") == 1 and R.count("غرفتين") == 2
    assert R.count("لا يوجد") is None and R.count("") is None and R.count(None) is None
    assert R.count("0") is None and R.count("45 غرفة") is None     # a zero or an absurd count is not a room count


def test_the_area_cell_is_read_as_its_first_number_only():
    """SYNTHETIC: post 332's «134 م²» respelled «134 م2» (an ASCII unit digit). to_int would fold it
    into 1342; the cell's FIRST number is the figure."""
    row, _ = _row(_with_content(POST_332, POST_332["content"]["rendered"].replace("134 م²", "134 م2")))
    assert row["area_m2"] == 134
    assert R.first_int("134 م2") == 134 and R.first_int("١٣٤ م٢") == 134 and R.first_int("") is None


# ── 3. TRI-STATE AMENITY CELLS ──────────────────────────────────────────────────────────────────
def test_labelled_amenity_cells_reach_real_columns_and_silence_stays_absent():
    row, _ = _row(POST_312)
    assert row["kitchen"] is True and row["elevator"] is True and row["parking"] is True
    assert row["floor_number"] == 3
    row, _ = _row(POST_332)
    for col in ("kitchen", "elevator", "parking"):
        assert col not in row, f"{col} must stay NULL when the block does not name it"
    assert row["floor_number"] is None
    assert R.yes_no("لا يوجد") is False and R.yes_no("غير متوفر") is False and R.yes_no("بدون") is False
    assert R.yes_no("مجهز") is True and R.yes_no("راكب") is True
    assert R.yes_no("ربما") is None and R.yes_no("") is None


# ── 4. SKIP, NEVER GUESS ────────────────────────────────────────────────────────────────────────
def test_category_gates():
    assert R.map_listing({**POST_332, "categories": [1]}, CATS)[2] == "no_category"
    assert R.map_listing({**POST_332, "categories": [1, 175, 177]}, CATS)[2] == "category_ambiguous"
    assert R.map_listing({**POST_332, "categories": [1, 187]}, CATS)[2] == "category_unmapped"   # «شقق مفروشة»: no deal stated
    assert R.map_listing({**POST_332, "categories": [1, 191]}, CATS)[2] == "type_unmapped"       # investment deals are out of scope
    row, _, why = R.map_listing({**POST_332, "categories": [1, 174]}, CATS)                       # «شقق للبيع»
    assert why == "" and row["transaction_type"] == "Buy" and row["price_total"] == 52000 and "price_annual" not in row


def test_status_id_link_and_city_gates():
    assert R.map_listing({**POST_332, "status": "draft"}, CATS)[2] == "status_draft"
    assert R.map_listing({**POST_332, "id": None}, CATS)[2] == "no_id"
    assert R.map_listing({**POST_332, "link": ""}, CATS)[2] == "no_link"
    html = POST_332["content"]["rendered"].replace("<strong>المدينة:</strong> الرياض", "<strong>المدينة:</strong> بلدة لا يعرفها الكتالوج")
    assert R.map_listing(_with_content(POST_332, html), CATS)[2] == "city_not_in_catalog"
    html = POST_332["content"]["rendered"].replace("<strong>المدينة:</strong> الرياض<br>", "")
    assert R.map_listing(_with_content(POST_332, html), CATS)[2] == "no_city"


# ── 5. PDPL ─────────────────────────────────────────────────────────────────────────────────────
def test_a_phone_number_in_the_prose_never_reaches_the_description():
    """SYNTHETIC: a contact line appended to post 332's prose."""
    html = POST_332["content"]["rendered"].replace("مختلف الخدمات.", "مختلف الخدمات. للتواصل 0551234567")
    row, _ = _row(_with_content(POST_332, html))
    assert "0551234567" not in row["description"]
    assert "0551234567" not in str(row["additional_info"])


def test_a_phone_number_in_a_labelled_cell_never_reaches_additional_info():
    """SYNTHETIC: a «للتواصل:» cell added to post 332's own labelled block — the block is stored
    verbatim in additional_info.labelled_fields, so the redaction must happen where it is read."""
    html = POST_332["content"]["rendered"].replace(
        "<strong>دورات المياه:</strong> 3", "<strong>دورات المياه:</strong> 3<br><strong>للتواصل:</strong> 0551234567")
    facts, _ = R.labelled_fields(html)
    assert "0551234567" not in facts["للتواصل"] and facts["دورات المياه"] == "3"
    row, _ = _row(_with_content(POST_332, html))
    assert "0551234567" not in json.dumps(row, ensure_ascii=False, default=str)
    assert row["bathrooms"] == 3 and row["price_annual"] == 52000            # redaction touches nothing else


# ── 6. THE REMOVAL ORACLE ───────────────────────────────────────────────────────────────────────
def test_the_wordpress_signal_kills_only_on_rest_post_invalid_id():
    assert R._signal(404, '{"code":"rest_post_invalid_id","message":"Invalid post ID.","data":{"status":404}}', False) == "gone"
    assert R._signal(200, '{"id":332,"status":"publish","type":"post"}', False) == "live"
    assert R._signal(200, '{"id":332,"status":"draft"}', False) is None
    assert R._signal(404, "<html>not found</html>", False) is None          # a 404 without the REST code says nothing
    assert R._signal(403, '{"code":"rest_forbidden"}', False) is None       # about US, never a death
    assert R._signal(200, "not json", False) is None
    assert R._url_for("AQR332") == "https://aqaralriyadh.com/wp-json/wp/v2/posts/332"
    assert R._url_for("XYZ332") is None


def test_session_asks_for_arabic():
    s = R.session()
    assert s.headers.get("Accept-Language", "").startswith("ar")


# ── 7. THE RUN LEDGER ───────────────────────────────────────────────────────────────────────────
def test_the_skip_tally_reaches_end_run(monkeypatch):
    """Runs the REAL main(): every skip reason lands in scrape_runs.notes, and prune only runs after
    a complete enumeration."""
    calls: dict = {}
    written: dict = {}
    pruned: list = []
    posts = [POST_332, {**POST_326, "categories": [1, 191]}, {**POST_312, "status": "draft"}]
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_categories", lambda s: CATS)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: (posts, len(posts)))
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: written.__setitem__(t, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen))) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 3 and calls["rows_upserted"] == 1
    assert "type_unmappedx1" in calls["notes"] and "status_draftx1" in calls["notes"]
    assert calls["check_tables"] == ["aqaralriyadh_residential_listings", "aqaralriyadh_commercial_listings"]
    assert [r["ad_number"] for r in written["aqaralriyadh_residential_listings"]] == ["AQR332"]
    assert ("aqaralriyadh_residential_listings", {"AQR332"}) in pruned


def test_an_incomplete_enumeration_never_prunes(monkeypatch):
    calls: dict = {}
    pruned: list = []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_categories", lambda s: CATS)
    monkeypatch.setattr(R, "fetch_posts", lambda s, limit=0: ([POST_332], 14))   # site says 14, we got 1
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append(t) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)
    assert R.main() == 0
    assert pruned == [] and calls["rows_upserted"] == 1
