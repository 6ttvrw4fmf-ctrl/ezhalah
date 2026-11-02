"""Sanadak, Aqargate and Manzo publish the ad's own prose, and we stored none of it (2026-10-30).

Measured in production that day: `description` was empty on 710/710 sanadak residential, 160/160 sanadak
commercial, 107/107 aqargate and 708/708 manzo active rows, while the SAME source record — already fetched
and kept in `source_capture` — carried it: sanadak's RSC object `description` (403 of 710 non-empty, the
page's «الوصف»), aqargate's WordPress `content.rendered`, manzo's detail-API `description` (the page's
«المميزات» paragraph). The AI facts reader reads title + description, so those ads were invisible to it.

Each mapper must now store that prose verbatim, contact details redacted (PDPL), and keep silence NULL.
Every test drives the real map function on a stub record; no network, no database.
"""
import pytest

import scrapers.aqargate.run as AG
import scrapers.manzo.run as MZ
import scrapers.sanadak.run as SN

PROSE = "شقة للبيع في حي النور مساحة ٢٤٣ م ٣ غرف نوم عمر العقار ١٣ سنة للتواصل 0551234567"


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    for mod in (AG, MZ, SN):
        monkeypatch.setattr(mod, "to_catalog", lambda c, region_hint=None: (1, 1) if c else (None, None))


def _sanadak(**kw):
    o = {"advertisementNumber": "7100242240", "isPublished": True, "propertyType": "Apartment",
         "propertyTypeText": "شقة", "listingType": "Sale", "city": "مكة المكرمة", "district": "المحمدية",
         "price": 900000, "lotSize": 200, "title": "شقة للبيع في مكة المكرمة"}
    o.update(kw)
    row, _ = SN.map_listing(o, "", "https://sanadak.sa/property-details/x-7100242240")
    return row


def _aqargate(content):
    p = {"id": 1, "link": "https://aqargate.com/property/x/", "title": {"rendered": "دور للبيع"},
         "property_type_text": ["دور"], "property_status_text": ["بيع"], "content": content,
         "property_meta": {"fave_property_id": ["AG1"], "advertisement_response": {
             "propertyPrice": 850000, "location": {"city": "مكة المكرمة", "region": "مكة المكرمة"}}}}
    row, _ = AG.map_listing(p, None)
    return row


def _manzo(**kw):
    d = {"display_status": "available", "property_type": "long_term_rent", "property_category": "Apartment",
         "slug": "long_term_rent-60m2-a6kmmME1", "property_id": 1, "price": "36000.00", "area": "60.00",
         "pricing_options": [{"price": 36000.0, "period": "annual", "primary": True}], "city": "جدة",
         "title_ar": "شقة للإيجار في جدة"}
    d.update(kw)
    (row, _), why = MZ.map_property(d)
    assert why == ""
    return row


def test_sanadak_stores_the_published_prose_with_the_phone_redacted():
    desc = _sanadak(description=PROSE)["description"]
    assert desc and desc.startswith("شقة للبيع في حي النور") and "عمر العقار ١٣ سنة" in desc
    assert "0551234567" not in desc


def test_aqargate_stores_the_post_body_as_text_with_the_phone_redacted():
    desc = _aqargate({"rendered": "<p>🏠 دور للبيع<br /> 📐 المساحة: 312 متر مربع</p>"
                                  "<p>* 5 غرف &amp; 3 دورات مياه<br /> 📱 للتواصل: 0551234567</p>"})["description"]
    assert desc and "<" not in desc and "&amp;" not in desc
    assert "دور للبيع" in desc and "5 غرف & 3 دورات مياه" in desc
    assert "0551234567" not in desc


def test_manzo_stores_the_listers_prose_with_the_phone_redacted():
    desc = _manzo(description=PROSE)["description"]
    assert desc and "عمر العقار ١٣ سنة" in desc and "0551234567" not in desc


@pytest.mark.parametrize("silent", [None, "", "   "])
def test_silence_stays_null_never_an_empty_string(silent):
    assert _sanadak(description=silent)["description"] is None
    assert _manzo(description=silent)["description"] is None
    assert _aqargate({"rendered": silent} if silent is not None else None)["description"] is None
    assert _aqargate({"rendered": "<p> </p>"})["description"] is None
