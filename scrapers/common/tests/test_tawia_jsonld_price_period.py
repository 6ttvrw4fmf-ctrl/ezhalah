"""Tawia: the listing is its JSON-LD + RSC gallery props; the rent period comes only from the ad's own
words (the site prints a bare «20,500 ريال»), alternative payment plans never replace offers.price,
the office phone/FAL never land in the row, and the site's «دور (شقة ضمن فيلا)» label maps via «دور»."""
import json

import pytest

import scrapers.tawia.run as R

PID = "090411ab-6c43-4c1a-a499-fb739eaf4f3e"
OPTIONS = "خيارات الإيجار: 20,500 ريال سعودي دفعة واحدة، أو 11,250 ريال كل 6 أشهر. مبلغ التأمين 1,000 ريال"


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (113, 5) if c == "الجبيل" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t if t == "حي المرقاب" else None)


def _page(label="شقة", title="شقة عوائل للإيجار - حي المرقاب، شمال مستشفى الجبيل العام", desc=OPTIONS,
          price="20500", fn="LeaseOut", avail="InStock", purpose="rent", details=""):
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing", "name": f"{label} - {title}",
          "description": desc, "datePosted": "2026-09-20T14:24:18Z",
          "address": {"@type": "PostalAddress", "streetAddress": "شمال مستشفى الجبيل العام، حي المرقاب",
                      "addressLocality": "المرقاب", "addressRegion": "الجبيل", "addressCountry": "SA"},
          "numberOfBedroomsTotal": 2, "numberOfBathroomsTotal": 1,
          "offers": {"@type": "Offer", "price": price, "priceCurrency": "SAR",
                     "availability": f"https://schema.org/{avail}",
                     "businessFunction": f"http://purl.org/goodrelations/v1#{fn}"},
          "seller": {"@type": "RealEstateAgent", "name": "مكتب طوية للعقار", "telephone": "+966557007419"}}
    agent = {"@type": "RealEstateAgent", "telephone": "+966557007419", "email": "info@tawia.sa"}
    rsc = ('2a:["$","$L27",null,{"images":[{"id":"a","publicUrl":"https://x.supabase.co/p/2.jpg","isCover":false},'
           '{"id":"b","publicUrl":"https://x.supabase.co/p/1.jpg","isCover":true}],"propertyName":'
           + json.dumps(title, ensure_ascii=False) + ',"isInvestmentOpportunity":false,"listingPurpose":"' + purpose
           + '"}]\n2b:["$","span",null,{"children":[" ","الدور 3"]}]\n')
    push = json.dumps(rsc, ensure_ascii=False)[1:-1]
    return (f'<html><head><script type="application/ld+json">{json.dumps(agent, ensure_ascii=False)}</script>'
            f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script></head><body>'
            f'رخصة فال للوساطة والتسويق: 1200002826 966557007419+ info@tawia.sa {details}'
            f'<script>self.__next_f.push([1,"{push}"])</script></body></html>')


def _map(**kw):
    return R.map_page(R.parse_page(PID, _page(**kw)))


def test_payment_options_never_become_the_price_and_no_period_is_invented():
    (row, cat), why = _map()
    assert why == "" and cat == "residential"
    assert row["price_annual"] == 20500            # offers.price verbatim — not 11,250, not 2×11,250
    assert row["rent_period"] is None               # «دفعة واحدة / كل 6 أشهر» names no period → NULL, never annual
    assert row["additional_info"]["price_options_text"].startswith("خيارات الإيجار: 20,500")
    assert row["price_evidence"]["raw"] == "20500" and row["price_evidence"]["origin"] == "structured"


def test_the_ads_own_period_word_sets_the_period():
    (row, _), _ = _map(desc="الإيجار السنوي 22,000 ريال بالإضافة إلى رسوم اشتراك مياه 500 ريال", price="22000")
    assert (row["rent_period"], row["price_annual"]) == ("annual", 22000)
    (row, _), _ = _map(desc="الإيجار 2,500 ريال", price="2500")
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 30000)   # ≤10,000 looks monthly, ×12


def test_a_sale_is_price_total_and_never_a_rent():
    (row, _), _ = _map(label="فيلا", title="فيلا دبلكس للبيع - حي الحمراء", desc="سعر الطلب 1,100,000 ريال",
                       price="1100000", fn="Sell", purpose="sale")
    assert row["transaction_type"] == "Buy" and row["price_total"] == 1100000
    assert "price_annual" not in row and "rent_period" not in row


def test_sold_let_and_disagreeing_deals_are_counted_skips():
    assert _map(avail="SoldOut") == (None, "availability_SoldOut")
    assert _map(title="شقة عوائل - تم التأجير") == (None, "not_ready_تم التأجير")
    assert _map(purpose="sale") == (None, "deal_mismatch_sale")


def test_type_comes_from_the_sites_own_label():
    (row, _), _ = _map(label="دور (شقة ضمن فيلا)")
    assert row["property_type"] == "Floor"                       # the label's type word is «دور»
    assert _map(label="روف") == (None, "type_unmapped_روف")       # never guessed into Apartment


def test_no_phone_email_or_fal_number_is_ever_stored_as_contact_or_ad_licence():
    (row, _), _ = _map(desc=OPTIONS + " للتواصل 0557007419 ترخيص فال رقم 1200002826")
    dump = json.dumps(row, ensure_ascii=False)
    assert "557007419" not in dump and "info@tawia.sa" not in dump
    assert row["license_number"] is None                          # the office FAL is not a REGA ad licence
    assert row["additional_info"]["fal_licence"] == "1200002826"


def test_structured_facts_and_photos_cover_first():
    (row, _), _ = _map(details="<dl><dt>نظام التكييف</dt><dd>سبليت</dd></dl>")
    assert row["photo_urls"] == ["https://x.supabase.co/p/1.jpg", "https://x.supabase.co/p/2.jpg"]
    assert row["floor_number"] == 3 and row["bedrooms"] == 2 and row["bathrooms"] == 1
    assert row["city_id"] == 113 and row["district_ar"] == "حي المرقاب" and row["neighborhood"] == "المرقاب"
    assert row["air_conditioner"] is True
