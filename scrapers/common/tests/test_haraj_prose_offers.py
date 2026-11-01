"""Haraj UNLICENSED offers (owner 2026-10-17: all real-estate offers): every fact from the seller's own words,
silent or ambiguous → NULL. Real phrasings from haraj.com.sa posts of 2026-10-16/17 (phones replaced)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.haraj import prose as X  # noqa: E402
from scrapers.haraj import run as R  # noqa: E402
from scrapers.haraj.classify import classify  # noqa: E402


def price(text, title=""):
    return X.asking_price(title, text)


# ── price: a figure tied to a price word, units scaled ─────────────────────────────────────────
@pytest.mark.parametrize("text,value,period", [
    ("شقه للاجار في حي العزيزيه ممتازه جداً الايجار 14الف دفعتين", 14000, "annual"),   # 11190684976
    ("السعر: 400,000 ريال", 400000, None),
    ("💰 السعر المطلوب: 850 الف", 850000, None),
    ("الايجار 2500 شهري", 2500, "monthly"),
    ("شقة للايجار 2,800 ريال شهريا", 2800, "monthly"),
    ("الايجار السنوي 40 الف", 40000, "annual"),
    ("بسعر 1.5 مليون", 1500000, None),
    ("السعر مليون ونص", 1500000, None),
    ("شقه في فيلا في حي ظهرة لبن ب3000", 3000, None),                                      # 11190682730 title
    ("للبيع بـ 250 الف ريال", 250000, None),
    ("العربون 5000 والايجار 30 الف سنوي", 30000, "annual"),                                  # the deposit is not it
    ("السعر ٤٥٠ ألف", 450000, None),                                                          # Arabic-Indic digits
])
def test_price_phrases(text, value, period):
    p = price(text)
    assert (p["price"], p["period"]) == (value, period), p


@pytest.mark.parametrize("text", [
    "السوم وصل 300 الف",                      # a bid is never a price
    "على السوم",
    "البيع على السوم والسوم وصل 1200000",
    "للتواصل 0551234567",                    # a phone number
    "السعر 0551234567",
    "فيلا بـ 3 غرف ودورتين مياه",             # a count after «بـ»
    "من 1000 الى 1500 ريال",                  # a range
    "السعر 900 الف او 950 الف",               # two figures
    "مخطط 1445 رقم القطعة 213",              # plan / plot numbers, no price word
    "تم البناء عام 1440 هـ",                  # a Hijri year
    "شقة 3 غرف وصالة",
])
def test_no_price(text):
    assert price(text)["price"] is None


def test_per_metre_figure_is_flagged():
    p = price("ارض 600م السعر 900 للمتر")
    assert p["price"] == 900 and p["per_meter"] is True


# ── area: only an area phrase ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,value", [
    ("مزرعة للإيجار مساحتها 30000م", 30000.0),                                                # 11190684047
    ("المساحة 600 م", 600.0), ("مساحة الارض: 450 متر", 450.0), ("600 متر مربع", 600.0), ("625 م٢", 625.0),
    ("للبيع ارض بصك الكتروني في الفريش مساحه 96 الف عند محطه مقبل", 96000.0),                # 18263173
    ("ارض مساحتها 12 ألف متر مربع", 12000.0),
])
def test_area_phrases(text, value):
    assert X.area_of("", text)["area"] == value


@pytest.mark.parametrize("text", [
    "2 دور", "شارع 15 م", "عرض الشارع 20 م", "من 205م2 إلى 233م2", "ارض 20×30", "مخطط 3680 قطعة 314",
    "المساحة 300 م ومسطح البناء 450 متر مربع",
    "حديقة بالحوش بجلسة خارجية حوش مساحتة 10في 8 خصم للحجز المبكر 10٪",                      # 18263149
    "ارض مساحتها 20 x 30",
])
def test_no_area(text):
    assert X.area_of("", text)["area"] is None


# ── type / deal ───────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("title,want", [
    ("شقه للاجار في حي العزيزيه", "Apartment"), ("شقه في فيلا للايجار", "Apartment"), ("ارض تجارية للبيع", "Commercial Land"),
    ("ارض للبيع بحي القادسيه", "أرض"), ("بيت شعبي للبيع", "Villa"), ("للايجار دبلكس ضاحيه الملك فهد", "Duplex"),
    ("شقة 4 غرف للايجار", "Apartment"), ("مزرعه للإيجار", "Farm"),
])
def test_type_from_title(title, want):
    assert X.type_of(title, "")[0] == want


@pytest.mark.parametrize("title", ["شقق للإيجار في حي سلطانة", "غرف مؤثثه للايجار الشهري", "للبيع شقق ارضيه حي المصيف",
                                   "ملحق للايجار"])
def test_catalogue_or_unknown_unit_is_not_a_type(title):
    assert X.type_of(title, "")[0] is None


def test_deal_both_is_unresolved():
    assert X.deal_of("دور للبيع او الايجار", "") is None
    assert X.deal_of("شقة للإيجار", "") == "Rent" and X.deal_of("فيلا للبيع", "") == "Buy"


# ── the whole post: stored only with type + deal + city; requests never ───────────────────────
@pytest.fixture
def catalog(monkeypatch):
    monkeypatch.setattr(R, "resolve", lambda city_ar, district_ar=None, region_hint=None: (
        {"city_id": 3, "region_id": 1} if city_ar == "الرياض" else
        {"city_id": 99, "region_id": 2} if city_ar == "الطائف" else {"city_id": None, "region_id": None}))
    monkeypatch.setattr(R, "catalog_district",
                        lambda cid, d: "حي العزيزية" if (cid, d.replace("ة", "ه")) == (3, "العزيزيه") else None)


def post(title, body="", city="الرياض"):
    ld = {"@type": "RealEstateListing", "name": title, "description": body, "url": "https://haraj.com.sa/1/x/",
          "address": {"addressLocality": city}, "image": ["https://img/a.jpg", "https://img/b.jpg"]}
    v, why = classify(title, body)
    return R.map_post("11190684976", ld, "", v, why)


def test_real_unlicensed_post_end_to_end(catalog):
    row, cat, skip, facts = post("شقه للاجار في حي العزيزيه ممتازه جداً الايجار 14الف دفعتين")
    assert skip == "" and cat == "residential"
    assert (row["property_type"], row["transaction_type"], row["rent_period"], row["price_annual"]) == (
        "Apartment", "Rent", "annual", 14000)
    # Owner 2026-10-18: the seller's prose («في حي العزيزيه») is never a district — only REGA's deed or Haraj's
    # own neighbourhood field is (test_haraj_district_precedence.py); this post carries neither → NULL.
    assert row["district_ar"] is None and row["license_number"] is None and row["photo_urls"] == [
        "https://img/a.jpg", "https://img/b.jpg"]
    assert row["additional_info"]["licensed"] is False


def test_silent_price_and_area_stay_null_and_the_post_is_still_stored(catalog):
    row, _, skip, _ = post("عمارة جاهزة للبيع")
    assert skip == "" and row["price_total"] is None and not row["area_m2"]


def test_an_area_the_words_no_longer_state_is_cleared_not_kept(catalog):
    # «10 في 8» is two sides: no area, and the 10 m² an older parser stored must be cleared (2026-10-17)
    from scrapers.common import db
    row, _, skip, _ = post("استراحة للإيجار اليومي", "حديقة بجلسة خارجية مساحتة 10في 8")
    assert skip == "" and row["area_m2"] is db.AUTHORITATIVE_NULL


def test_unresolved_city_or_request_is_never_stored(catalog):
    assert post("شقة للايجار", city="القصيم")[2] == "city_not_in_catalog"
    assert post("مطلوب شقة للايجار في الرياض")[2] == "not_offer_request"
    assert post("شقق للإيجار في حي سلطانة")[2] in ("catalogue", "not_offer_other")
    assert post("فيلا للبيع", city="الطايف")[2] == ""                      # Haraj's own spelling of الطائف


def test_phones_are_never_stored(catalog):
    row, *_ = post("شقة للايجار الايجار 2500 شهري", "للتواصل 0551234567 ابو محمد")
    assert "0551234567" not in (row["description"] or "") and row["price_annual"] == 2500 * 12
