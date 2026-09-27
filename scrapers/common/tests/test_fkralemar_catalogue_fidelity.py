"""OFFLINE barrier for scrapers/fkralemar/run.py — the real functions, fed real fkralemar.com markup.

No network, no database. FX holds verbatim fragments captured 2026-09-24 (svg/style/data-* noise
removed, tags and text untouched): two store-front cards (product 6a0e437bdb866 «للبيع» and
6874de87b6a99 «مباع»), the «حي الروضة» category tile, the product page of 6a0e437bdb866 (JSON-LD,
breadcrumb, product-container, description, og:image), the description of the hidden product
/offers/villa-for-sale (Arabic-Indic area, a phone number, a licence, «تأسيس مصعد») and the
«حي النعيم» category's meta description. to_catalog / city_ar_for / find_district_in_text are the
only things patched; CATALOG is what production returned for those strings on 2026-09-24.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.fkralemar import run as R  # noqa: E402

FX = json.loads(r"""{"store_cards": ["<div class=\"box-theme-3a e-p-box\" data-show-add-to-cart=\"0\" data-has-ribbon=\"1\"><div class=\"e-commerce-product-box product-data-obj preview-highlighter\" data-unique-id=\"6a0e437bdb866\" data-module=\"112\" data-module-type-num=\"112\" data-item-is-hidden=\"\" data-has-options=\"0\"><div class=\"box-primary s123-box-shadow stractureDefault stractureButtonsFlying detailsSideBySide\"><div class=\"imagePart\"><figure class=\"product product-transition\"><div class=\"product-img-wrap\"><div class=\"product-image\"><a href=\"/offers/three-room-apartment-to-own\" class=\"first-image product-image s123-image-ratio-3-4 bgLazyload s123-fast-page-load\" aria-label=\"شقه 3 غرف ( 124م)\" data-bg=\"https://files.cdn-files-a.com/uploads/7951564/800_6a0e40d41b772.png\"></a></div><div class=\"product-image second-image\"><a href=\"/offers/three-room-apartment-to-own\" class=\"second-image product-image s123-image-ratio-3-4 bgLazyload s123-fast-page-load\" data-bg=\"https://files.cdn-files-a.com/uploads/7951564/800_6a0e43148ab39.png\"></a></div></div></figure><div class=\"quick-view-container\"><a href=\"/offers/three-room-apartment-to-own\" data-rel=\"popupScreen\" class=\"quick-view-link \" aria-label=\"استعراض سريع\">استعراض سريع</a></div><div class=\"ribbonsLabels\"><a href=\"/offers/three-room-apartment-to-own\" class=\"background-primary-color product-ribbon-banner s123-fast-page-load\">للبيع</a></div><div class=\"w-l-continaer\"></div></div><div class=\"detailPart\"><div class=\"top\"><h4 class=\"product-title\"><a class=\"box-text-primary s123-fast-page-load\" href=\"/offers/three-room-apartment-to-own\">شقه 3 غرف ( 124م)</a></h4><div class=\"prices\"><span class=\"product-price\"><span class=\"normal-price\"><a class=\"primary-color s123-fast-page-load\" href=\"/offers/three-room-apartment-to-own\"><span data-rel=\"multiCurrency\"><span data-type=\"symbol\">&#65020;</span><span data-type=\"price\">7000000</span><", "<div class=\"box-theme-3a e-p-box\" data-show-add-to-cart=\"0\" data-has-ribbon=\"1\"><div class=\"e-commerce-product-box product-data-obj preview-highlighter\" data-unique-id=\"6874de87b6a99\" data-module=\"112\" data-module-type-num=\"112\" data-item-is-hidden=\"\" data-has-options=\"0\"><div class=\"box-primary s123-box-shadow stractureDefault stractureButtonsFlying detailsSideBySide\"><div class=\"imagePart\"><figure class=\"product product-transition\"><div class=\"product-img-wrap\"><div class=\"product-image\"><a href=\"/offers/5rooftop-apartment-for-sale\" class=\"first-image product-image s123-image-ratio-3-4 bgLazyload s123-fast-page-load\" aria-label=\"شقه روف 5 غرف ( 215م )\" data-bg=\"https://files.cdn-files-a.com/uploads/7951564/800_6874de6e8997c.jpg\"></a></div><div class=\"product-image second-image\"><a href=\"/offers/5rooftop-apartment-for-sale\" class=\"second-image product-image s123-image-ratio-3-4 bgLazyload s123-fast-page-load\" data-bg=\"https://files.cdn-files-a.com/uploads/7951564/800_6874de6e89e35.jpg\"></a></div></div></figure><div class=\"quick-view-container\"><a href=\"/offers/5rooftop-apartment-for-sale\" data-rel=\"popupScreen\" class=\"quick-view-link \" aria-label=\"استعراض سريع\">استعراض سريع</a></div><div class=\"ribbonsLabels\"><a href=\"/offers/5rooftop-apartment-for-sale\" class=\"background-primary-color product-ribbon-banner s123-fast-page-load\">مباع</a></div><div class=\"w-l-continaer\"></div></div><div class=\"detailPart\"><div class=\"top\"><h4 class=\"product-title\"><a class=\"box-text-primary s123-fast-page-load\" href=\"/offers/5rooftop-apartment-for-sale\">شقه روف 5 غرف ( 215م )</a></h4><div class=\"prices\"><span class=\"product-price\"><span class=\"normal-price\"><a class=\"primary-color s123-fast-page-load\" href=\"/offers/5rooftop-apartment-for-sale\"><span data-rel=\"multiCurrency\"><span data-type=\"symbol\">&#65020;</span><span data-type=\"price\">970000</span><"], "tile": "<div class=\"e-c-box\" data-unique-id=\"5c178ca5cac7b\" data-module-type-num=\"113\"><div class=\"preview-highlighter\"><div class=\"box c-box-layout-1\"><a href=\"/offers/apartments-for-sale-in-jeddah\" class=\"image-container s123-fast-page-load\"><div class=\"collection-image s123-image-ratio-1-1 bgLazyload\" data-bg=\"https://images.cdn-files-a.com/uploads/7951564/800_6564895ec5af4.png\" aria-label=\"حي الروضة\"></div><div class=\"title-container t-c-opacity\"><span class=\"count \"><span class=\"count-amount\">0</span><span class=\"count-txt\"> المنتجات</span></span><span class=\"shopNow \">تسوق الآن</span></div><div class=\"bottom-title-container\"><h4 class=\"title box-text-primary box-primary\" date-upper=\"1\">حي الروضة</h4></div></a>", "product": "<script type=\"application/ld+json\">    {\"@context\":\"https://schema.org\",\"@type\":\"Product\",\"name\":\"\\u0634\\u0642\\u0647 3 \\u063a\\u0631\\u0641 ( 124\\u0645)\",\"image\":[\"https://files.cdn-files-a.com/uploads/7951564/normal_6a0e40d41b772.png\"],\"offers\":{\"@type\":\"Offer\",\"url\":\"www.fkralemar.com/offers/three-room-apartment-to-own\",\"price\":\"7000000\",\"priceCurrency\":\"SAR\",\"availability\":\"https://schema.org/InStock\",\"itemCondition\":\"https://schema.org/NewCondition\"},\"description\":\"* \\u062a\\u0641\\u0627\\u0635\\u064a\\u0644 \\u0627\\u0644\\u0639\\u0631\\u0636 :\\r\\n3 \\u063a\\u0631\\u0641 + 2 \\u062f\\u0648\\u0631\\u0627\\u062a \\u0645\\u064a\\u0627\\u0647 + \\u0645\\u0637\\u0628\\u062e + \\u0635\\u0627\\u0644\\u0647\\r\\n( \\u0627\\u0644\\u0645\\u0633\\u0627\\u062d\\u0629 : 124\\u0645 )\\r\\n\\r\\n\\u062e\\u062f\\u0645\\u0627\\u062a \\u0648\\u0636\\u0645\\u0627\\u0646\\u0627\\u062a \\u0627\\u0644\\u0634\\u0642\\u0647 \\u2705 :\\r\\n\\u062e\\u0632\\u0627\\u0646\\u064a\\u0646 \\u0639\\u0644\\u0648\\u064a \\u0648\\u0633\\u0641\\u0644\\u064a + \\u0639\\u062f\\u0627\\u062f \\u0645\\u0633\\u062a\\u0642\\u0644 + \\u0645\\u0648\\u0642\\u0641 \\u062e\\u0627\\u0635 \\u0645\\u0638\\u0644\\u0644 + \\u0627\\u062a\\u062d\\u0627\\u062f \\u0645\\u0644\\u0627\\u0643\\r\\n\\u062a\\u0648\\u062c\\u062f \\u0636\\u0645\\u0627\\u0646\\u0627\\u062a \\u0639\\u0644\\u0649 \\u0627\\u0644\\u0623\\u0633\\u0627\\u0633 \\u0648\\u0627\\u0644\\u0647\\u064a\\u0643\\u0644 \\u0627\\u0644\\u062e\\u0631\\u0633\\u0627\\u0646\\u064a\\r\\n\\u0636\\u0645\\u0627\\u0646 \\u0639\\u0644\\u0649 \\u0627\\u0644\\u0633\\u0628\\u0627\\u0643\\u0647 \\u0648\\u0627\\u0644\\u0643\\u0647\\u0631\\u0628\\u0627\\u0621\"}</script><ol class=\"breadcrumb container\" ><li><a class=\"homepageMenu s123-fast-page-load\" href=\"/\"><span class=\"txt-container\">الرئيسية</span></a></li><li><a data-module-id=\"112\" href=\"/offers\">Offers</a></li><li><a href=\"/offers/apartments-for-sale-in-jeddah\">حي الروضة</a></li><li class=\"active\">شقه 3 غرف ( 124م)</li></ol><div class=\"row product-container product-data-obj\" data-unique-id=\"6a0e437bdb866\" data-module=\"112\" data-module-type-num=\"112\"><p class=\"description\">* تفاصيل العرض :\n3 غرف + 2 دورات مياه + مطبخ + صاله\n( المساحة : 124م )\n\nخدمات وضمانات الشقه ✅ :\nخزانين علوي وسفلي + عداد مستقل + موقف خاص مظلل + اتحاد ملاك\nتوجد ضمانات على الأساس والهيكل الخرساني\nضمان على السباكه والكهرباء</p><meta property=\"og:image\" content=\"https://files.cdn-files-a.com/uploads/7951564/800_6a122b80c8f7b.png\"", "villa_desc": "<p class=\"description\">فيلا دبلكس للبيع فاخرة درج داخلي 🏡\nشغل فاخر وجودة عالية 👌🏼\nمساحة ٢٣١ م .\n\nالدورالارضي :\nمجلس رجال ومجلس نساء صالة  مطبخ  و ٣ دورة مياه وغرفة خادمة\n\nالدور الأول :\n١ غرف نوم ماستر كبيرة و ٢ غرف نوم مع جلسة خارجية و٢ دورات مياه وسيرفس وصالة كبيرة ،  .\n\nالملحق :\n٢ غرفة ودورة مياه  وصالة وسطح .\n\nغرفة سائق - مدخل سيارة \n\n( تأسيس مصعد ) \n\nشبابيك كبيرة \n\nالسعر = ١ مليون و ٧٠٠ الف\n\n\nللتواصل : \n0551134384\nترخيص : \n 7100066271</p>", "cat_meta": "<meta name=\"description\" content=\"تصفح عروض فكر الإعمار في حي النعيم جدة، شقق سكنية حديثة بمواقع مميزة وتشطيبات عالية الجودة وأسعار تنافسية\""}""")
LIVE_CARD, SOLD_CARD = FX["store_cards"]
CATALOG = {"جدة": (18, 2), "الرياض": (3, 1)}   # «الروضة», «النعيم», «حي», «عروض», «فكر» … resolve to nothing
DISTRICTS = {("حي الروضة", 18): "حي الروضة", ("حي النعيم", 18): "حي النعيم"}
NAEEM_TEXT = "تصفح عروض فكر الإعمار في حي النعيم جدة، شقق سكنية حديثة بمواقع مميزة وتشطيبات عالية الجودة وأسعار تنافسية"


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda s, hint=None: CATALOG.get((s or "").strip(), (None, None)))
    monkeypatch.setattr(R, "city_ar_for", lambda cid: {18: "جدة"}.get(cid))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, cid: DISTRICTS.get(((text or "").strip(), cid)))


def _cards():
    return R.parse_cards(FX["tile"] + LIVE_CARD + SOLD_CARD)


# ── enumeration ───────────────────────────────────────────────────────────────────────────────────

def test_cards_are_anchored_on_the_product_box_not_on_any_unique_id():
    """The category tile («e-c-box») carries data-unique-id="5c178ca5cac7b" too. Anchoring on the id
    alone made the tile the first "product" and pointed its href at the category page."""
    cards = _cards()
    assert [c["uid"] for c in cards] == ["6a0e437bdb866", "6874de87b6a99"]
    assert cards[0]["href"] == "/offers/three-room-apartment-to-own" and cards[0]["ribbon"] == "للبيع"
    assert cards[1]["ribbon"] == "مباع" and cards[0]["price_raw"] == "7000000"
    assert R.parse_categories(FX["tile"]) == [("/offers/apartments-for-sale-in-jeddah", "حي الروضة")]


def test_a_page_that_hides_products_behind_pagination_aborts():
    with pytest.raises(RuntimeError):
        R.parse_cards(LIVE_CARD.replace("</h4>", "</h4>") + '<div data-pagination-products-left="3">')


def test_the_category_meta_description_names_the_city():
    assert R.category_city_text(FX["cat_meta"]) == NAEEM_TEXT


# ── map_listing ───────────────────────────────────────────────────────────────────────────────────

def test_sold_ribbon_is_skipped_and_counted():
    row, _, why = R.map_listing(_cards()[1], R.parse_product(FX["product"]), "حي الروضة", NAEEM_TEXT)
    assert row is None and why == "sold"


def test_price_is_stored_exactly_as_printed_even_when_it_looks_like_a_typo():
    """«شقه 3 غرف ( 124م)» is priced 7000000 on the card AND in JSON-LD. 700000 would be a guess."""
    card, product = _cards()[0], R.parse_product(FX["product"])
    row, cat, why = R.map_listing(card, product, "حي الروضة", NAEEM_TEXT)
    assert why == "" and cat == "residential" and row["price_total"] == 7000000
    assert row["transaction_type"] == "Buy" and "price_annual" not in row
    assert row["ad_number"] == "FKR6a0e437bdb866"
    assert row["listing_url"] == "https://www.fkralemar.com/offers/three-room-apartment-to-own"


def test_a_card_price_that_disagrees_with_the_pages_json_ld_is_refused():
    product = dict(R.parse_product(FX["product"]), ld_price="700000")
    row, _, why = R.map_listing(_cards()[0], product, "حي الروضة", NAEEM_TEXT)
    assert row is None and why == "price_conflict"


def test_city_comes_from_the_category_text_and_survives_the_arabic_comma():
    """«جدة،» — the Arabic comma U+060C sits INSIDE the Arabic Unicode block, so a block-range word
    regex captured «جدة،» and to_catalog missed every Naeem product (6 skips, measured)."""
    assert R.resolve_city(NAEEM_TEXT) == (18, 2, "جدة")
    assert R.resolve_city("اكتشف أفضل عروض الشقق السكنية في حي الروضة") == (None, None, None)
    assert R.resolve_city("عروض الرياض في حي الروضة جدة") == (18, 2, "جدة"), "anchored on «حي X <city>», never a free scan"
    assert R.resolve_city("عروض في حي الروضة بجدة") == (18, 2, "جدة")
    row, _, why = R.map_listing(_cards()[0], R.parse_product(FX["product"]), "حي الروضة", "")
    assert row is None and why == "city_not_in_catalog"


def test_prose_facts_land_in_real_columns():
    row, _, _ = R.map_listing(_cards()[0], R.parse_product(FX["product"]), "حي الروضة", NAEEM_TEXT)
    assert row["bedrooms"] == 3 and row["bathrooms"] == 2 and row["area_m2"] == 124
    assert row["kitchen"] is True and row["parking"] is True and row["halls"] == 1
    assert row["district_ar"] == "حي الروضة" and row["neighborhood"] == "حي الروضة"
    assert "elevator" not in row and "furnished" not in row, "silence stays NULL"
    assert row["photo_urls"] and all(u.startswith("https://files.cdn-files-a.com/") for u in row["photo_urls"])


def test_halls_and_area_are_read_only_where_the_source_states_them():
    product = R.parse_product(FX["product"])
    assert "( المساحة : 124م )" in product["description"] and "صاله" in product["description"]
    # the title's own «( 124م)» is the area when the prose has none
    no_area = dict(product, description=product["description"].replace("( المساحة : 124م )", ""))
    row, _, _ = R.map_listing(_cards()[0], no_area, "حي الروضة", NAEEM_TEXT)
    assert row["area_m2"] == 124 and "( 124م)" in row["title"]
    # a prose that names no hall stays NULL; «صالتين» is two; «3 صالات» is three
    no_hall = dict(product, description=product["description"].replace("صاله", "مجلس"))
    row, _, _ = R.map_listing(_cards()[0], no_hall, "حي الروضة", NAEEM_TEXT)
    assert "halls" not in row
    two = dict(product, description=product["description"].replace("صاله", "صالتين"))
    assert R.map_listing(_cards()[0], two, "حي الروضة", NAEEM_TEXT)[0]["halls"] == 2
    three = dict(product, description=product["description"].replace("صاله", "3 صالات"))
    assert R.map_listing(_cards()[0], three, "حي الروضة", NAEEM_TEXT)[0]["halls"] == 3


def test_villa_prose_traps():
    """Arabic-Indic area, a phone number, an ad licence, and «تأسيس مصعد» (a prepared shaft)."""
    card = {"uid": "6655f88697798", "href": "/offers/villa-for-sale", "ribbon": "للبيع",
            "title": "فيلا دبلكس للبيع", "price_raw": "1700000"}
    product = R.parse_product(FX["villa_desc"])
    row, _, why = R.map_listing(card, product, None, NAEEM_TEXT)
    assert why == "" and row["property_type"] == "Villa"
    assert row["area_m2"] == 231
    assert row["license_number"] == "7100066271"
    assert "0551134384" not in row["description"]
    assert "elevator" not in row, "«تأسيس مصعد» is prepared, not present"
    assert row["maid_room"] is True and row["driver_room"] is True


def test_a_title_leading_with_a_bare_roof_word_is_unmapped():
    card = dict(_cards()[0], title="روف 5 غرف (145م)")
    row, _, why = R.map_listing(card, R.parse_product(FX["product"]), "حي الروضة", NAEEM_TEXT)
    assert row is None and why == "type_unmapped[روف]"


def test_a_building_keeps_its_aggregate_count_out_of_bedrooms_bathrooms():
    """Reviewer finding: a whole-building ad's room COUNT is not one dwelling's bedrooms/bathrooms.
    «عمارة 8 غرف» + «6 دورات مياه» in prose must land in additional_info, not the real columns."""
    card = dict(_cards()[0], uid="7100000000001", href="/offers/building-for-sale",
                title="عمارة 8 غرف ( 500م )", price_raw="3000000")
    product = dict(R.parse_product(FX["product"]), ld_price=None,
                    description="8 غرف + 6 دورات مياه + مطبخ\n( المساحة : 500م )")
    row, cat, why = R.map_listing(card, product, "حي الروضة", NAEEM_TEXT)
    assert why == "" and row["property_type"] == "Building" and cat == "residential"
    assert row["bedrooms"] is None and row["bathrooms"] is None
    assert row["additional_info"]["bedrooms_raw"] == 8 and row["additional_info"]["bathrooms_raw"] == 6
    # a dwelling (Apartment) keeps them in the real columns, unaffected
    dwelling_row, _, _ = R.map_listing(_cards()[0], R.parse_product(FX["product"]), "حي الروضة", NAEEM_TEXT)
    assert dwelling_row["bedrooms"] == 3 and dwelling_row["bathrooms"] == 2
    assert "bedrooms_raw" not in dwelling_row["additional_info"]


# ── removal oracle ────────────────────────────────────────────────────────────────────────────────

def test_liveness_signal_reads_the_measured_shapes():
    sig = R._signal_for("6a0e437bdb866", {"6a0e437bdb866": "للبيع"})
    assert sig(404, "<title>404 - لم يتم العثور على الصفحة</title>", False) == "gone"
    assert sig(200, FX["product"], False) == "live"
    assert sig(200, FX["product"].replace("6a0e437bdb866", "ffffffffffff0"), False) is None
    assert sig(403, "blocked", False) is None
    sold = R._signal_for("6874de87b6a99", {"6874de87b6a99": "مباع"})
    assert sold(200, FX["product"], False) == "gone", "this run's own catalogue read says «مباع»"


# ── main(): the tally reaches end_run ─────────────────────────────────────────────────────────────

def _pages():
    return {
        R.STORE: FX["tile"] + LIVE_CARD + SOLD_CARD,
        R.BASE + "/offers/apartments-for-sale-in-jeddah": FX["cat_meta"].replace("حي النعيم", "حي الروضة") + LIVE_CARD + SOLD_CARD,
        R.BASE + "/offers/three-room-apartment-to-own": FX["product"],
    }


def test_main_writes_both_tables_and_reports_the_skip_tally(monkeypatch):
    calls = {}
    pages = _pages()
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch", lambda s, url: pages[url])
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    db = types.SimpleNamespace(
        begin_run=lambda slug: calls.setdefault("begin", slug) or 3,
        _wasalt_batch=lambda table, rows: calls.setdefault("batches", []).append((table, [r["ad_number"] for r in rows])),
        retire_superseded_siblings=lambda **kw: calls.setdefault("retire", kw) and 0,
        prune_unseen=lambda table, seen, source=None, verify_gone=None: calls.setdefault("prune", []).append((table, sorted(seen), verify_gone)) or 0,
        end_run=lambda run_id, **kw: calls.setdefault("end", kw) or True,
    )
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 0
    assert calls["begin"] == "fkralemar"
    assert ("fkralemar_residential_listings", ["FKR6a0e437bdb866"]) in calls["batches"]
    assert ("fkralemar_commercial_listings", []) in calls["batches"]
    assert calls["retire"]["source"] == R.SOURCE
    assert calls["prune"][0][:2] == ("fkralemar_residential_listings", ["FKR6a0e437bdb866"])
    # The oracle must REACH a sold product: a prune candidate is never a mapped row, so the URL map
    # has to cover every catalogue card — the «مباع» ribbon is the only status the source publishes.
    verify_gone = calls["prune"][0][2]
    fetched = []
    fake = types.SimpleNamespace(get=lambda url, **kw: fetched.append(url) or types.SimpleNamespace(
        status_code=200, text=FX["product"], url=url))
    monkeypatch.setattr(R, "session", lambda: fake)
    verdict, why = verify_gone("FKR6874de87b6a99")
    assert verdict == "gone" and fetched == [R.BASE + _cards()[1]["href"]], (verdict, why, fetched)
    assert verify_gone("FKRffffffffffff0")[0] == "unknown" and len(fetched) == 1, "an id on no catalogue page is never fetched"
    end = calls["end"]
    assert end["check_tables"] == ["fkralemar_residential_listings", "fkralemar_commercial_listings"]
    assert end["rows_seen"] == 2 and end["rows_upserted"] == 1 and "soldx1" in end["notes"]


def test_main_with_an_empty_catalogue_fails_closed(monkeypatch):
    calls = {}
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch", lambda s, url: "<html><body>maintenance</body></html>")
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    db = types.SimpleNamespace(begin_run=lambda slug: 3, _wasalt_batch=lambda t, r: None,
                               retire_superseded_siblings=lambda **kw: 0,
                               prune_unseen=lambda *a, **kw: calls.setdefault("prune", True) or 0,
                               end_run=lambda run_id, **kw: calls.setdefault("end", kw) or True)
    monkeypatch.setattr(R, "db", db)
    monkeypatch.setattr(sys, "argv", ["run"])
    assert R.main() == 1 and "prune" not in calls and calls["end"]["ok"] is False
