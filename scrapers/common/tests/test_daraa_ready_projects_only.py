"""Dara: only an unsold project the site itself calls ready («جاهزة للإفراغ») is a listing; sold,
off-plan and register-interest (still being built) are counted skips. No price is ever published or
invented, the city is set only from the page's own Makkah-Haram field, and contact data never lands."""
import json

import pytest

import scrapers.daraa.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (6, 2) if c == "مكة المكرمة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t if t == "حي بطحاء قريش" else None)


def _card(sold=False, info=("شقق", "جاهزة للإفراغ"), pid="205054"):
    return {"image": f"https://api.daraa.sa/content/products/{pid}/{pid}.webp", "title": "دارا لاكجري-37 ",
            "subtitle": "…", "link": f"/projects/{pid}", "isSoldOut": sold, "extraInfo": list(info)}


def _detail(tags=("شقق", "جاهزة للإفراغ"), desc="مشروع لاكجري-37 بطحاء قريش ضمانات المشروع 20 سنة على الإنشاءات",
            specs=None, amen=None):
    return {"tags": list(tags), "title": "دارا لاكجري-37", "description": desc,
            "specs": specs if specs is not None else {"الفئة": "شقة", "المسافة إلى الحرم المكي": "6 إلى 9 كم", "الحي": "بطحاء قريش"},
            "amenities": amen if amen is not None else {"مصعد": "متوفره", "مواقف": "موقف خاص", "مسجد": "قريب من المسجد"},
            "images": ["https://api.daraa.sa/content/products/205054/205054.webp",
                       "https://api.daraa.sa/content/products/205054/2050541.webp"]}


def test_only_ready_unsold_projects_pass_the_list_gate():
    assert R.card_verdict(_card()) == ""
    assert R.card_verdict(_card(sold=True, info=())) == "sold"
    assert R.card_verdict(_card(info=("بيع على الخارطة", "رقم الترخيص 1133"))) == "off_plan"
    assert R.card_verdict(_card(info=("شقق", "سجل إهتمامك"))) == "not_ready_register_interest"
    assert R.card_verdict(_card(info=("شقق",))) == "not_ready_شقق"
    # a sold card is never rescued by a ready word
    assert R.map_project(_card(sold=True), _detail()) == (None, "sold")


def test_a_ready_project_is_one_buy_listing_with_no_price():
    (row, cat), why = R.map_project(_card(), _detail())
    assert why == "" and cat == "residential"
    assert row["ad_number"] == "DRA205054" and row["listing_url"] == "https://daraa.sa/projects/205054"
    assert row["property_type"] == "Apartment" and row["transaction_type"] == "Buy"
    assert row["price_total"] is None and "price_annual" not in row and "rent_period" not in row
    assert row["price_evidence"]["authoritative_absent"] is True and row["price_evidence"]["raw"] is None
    assert (row["city_id"], row["district_ar"], row["neighborhood"]) == (6, "حي بطحاء قريش", "بطحاء قريش")
    assert row["elevator"] is True and row["parking"] is True
    assert row["photo_urls"][0].endswith("/205054.webp") and len(row["photo_urls"]) == 2


def test_the_detail_page_must_agree_and_a_printed_price_is_never_ignored():
    assert R.map_project(_card(), _detail(tags=("شقق", "مُباع"))) == (None, "detail_status_disagrees")
    assert R.map_project(_card(), _detail(desc="شقق تبدأ من 650,000 ريال")) == (None, "unit_prices_unparsed")


def test_city_only_from_the_pages_own_haram_field_and_type_never_guessed():
    no_haram = {"الفئة": "شقة", "الحي": "بطحاء قريش"}
    assert R.map_project(_card(), _detail(specs=no_haram)) == (None, "city_unstated")
    villa_complex = {"الفئة": "مجمع", "المسافة إلى الحرم المكي": "3 إلى 5 كم", "الحي": "بطحاء قريش"}
    assert R.map_project(_card(), _detail(specs=villa_complex)) == (None, "type_unmapped_مجمع")


def test_no_contact_detail_is_stored():
    card = {**_card(), "subtitle": "مشروع جاهز للتواصل واتساب 0501234567 ..."}   # the list card is captured too
    (row, _), _ = R.map_project(card, _detail(desc="مشروع جاهز للتواصل 0501234567 أو info@daraa.sa",
                                              amen={"التواصل": "اتصل 0501234567"}))
    dump = json.dumps(row, ensure_ascii=False)
    assert "0501234567" not in dump and "info@daraa.sa" not in dump


def test_the_description_rsc_text_row_is_read_by_byte_length():
    html_desc = "<p>مشروع لاكجري-37 بطحاء قريش</p><p>ضمان 20 سنة</p>"
    rsc = ('20:["$","span","1",{"className":"bg-accent text-background px-4","children":"جاهزة للإفراغ"}]\n'
           '21:["$","h1",null,{"className":"text-6xl","children":"دارا لاكجري-37 "}]\n'
           '22:[["$","span",null,{"className":"text-xs","children":"الفئة"}],["$","span",null,{"className":"text-lg font-bold text-foreground","children":"شقة"}]]\n'
           '23:["$","div",null,{"dangerouslySetInnerHTML":{"__html":"$29"}}]\n'
           f'29:T{len(html_desc.encode()):x},')
    pushes = [json.dumps(rsc, ensure_ascii=False)[1:-1], json.dumps(html_desc + "2a:null\n", ensure_ascii=False)[1:-1]]
    page = "".join(f'<script>self.__next_f.push([1,"{p}"])</script>' for p in pushes)
    d = R.parse_detail(page)
    assert d["description"] == "مشروع لاكجري-37 بطحاء قريش ضمان 20 سنة"      # stops exactly at the row's end
    assert d["title"] == "دارا لاكجري-37" and d["tags"] == ["جاهزة للإفراغ"] and d["specs"] == {"الفئة": "شقة"}
