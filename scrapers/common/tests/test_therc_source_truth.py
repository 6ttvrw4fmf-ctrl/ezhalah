"""THE RC (therc.aqar.digital): the four ways this parser could silently fabricate a source fact.

Fixtures are real page shapes captured live 2026-09-02 (AQ254001, AQ065801, AQ117801). Each test
pins a rule that a "helpful" refactor would break in the direction that has already burned this
codebase — a NULL turning into 0/false/annual, or a per-metre rate turning into a total.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.therc.run import map_listing

URL = "https://therc.aqar.digital/properties/x"


def _page(*, name, ref, price, period="", specs=(), rooms="null", area="251.00",
          locality="الرياض", district="حي طويق", badge="فيلا"):
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing", "name": name,
          "description": "…", "url": URL, "datePosted": "2026-08-01T10:00:00+03:00",
          "image": "https://pub-x.r2.dev/properties/950/main/a.webp",
          "offers": {"@type": "Offer", "price": price, "priceCurrency": "SAR"},
          "address": {"@type": "PostalAddress", "addressLocality": locality,
                      "addressRegion": district, "addressCountry": "SA"},
          "floorSize": {"@type": "QuantitativeValue", "value": area, "unitCode": "MTK"},
          "numberOfRooms": json.loads(rooms)}
    spec_html = "".join(
        f'<div class="text-sm text-gray-500">{k}</div>\n'
        f'<div class="font-bold text-gray-900">{v}</div>' for k, v in specs)
    return (
        '<script type="application/ld+json">{"@type":"RealEstateAgent","telephone":"+966500000000"}</script>'
        f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
        f'<span class="rounded-lg">{badge}</span>'
        f'<span class="bg-gray-100">رقم المرجع: {ref}</span>'
        f'<h1 class="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{name}</h1>'
        '<div class="text-3xl font-bold" style="color: var(--color-primary);">'
        f'{price} <span class="text-lg font-normal">ر.س</span>{period}</div>'
        f'<h2 class="text-xl font-bold text-gray-900 mb-6">المواصفات</h2>{spec_html}'
        '<h2 class="text-xl font-bold text-gray-900 mb-4">الوصف</h2>'
        '<div class="prose prose-sm">فيلا واسعة بحي طويق مع مسبح ومجلس وحديقة خاصة.</div>'
        # The similar-properties strip: another listing's price, period and type. Everything below
        # «عقارات مشابهة» must be invisible to the parser.
        'عقارات مشابهة'
        '<span class="bg-gray-100">رقم المرجع: AQ000000</span>'
        '<div class="text-3xl font-bold" style="color: var(--color-primary);">'
        '9,999,999 <span class="text-lg font-normal">ر.س</span>'
        '<span class="text-base font-normal text-gray-500">/ monthly</span></div>'
    )


_YEARLY = '<span class="text-base font-normal text-gray-500">/ yearly</span>'


def _row(**kw):
    row, _cat = map_listing(URL, _page(**kw), None)
    return row


def test_absent_bathroom_block_stays_null_never_zero():
    # AQ254001 publishes المساحة + «6 غرف» and NO حمام block at all. Absence is the source omitting
    # the whole block — it is not a statement that the villa has zero bathrooms.
    r = _row(name="فيلا للإيجار في شارع يزيد بن محمد, حي طويق, مدينة الرياض", ref="AQ254001",
             price="55000.00", period=_YEARLY, specs=(("المساحة", "251 م²"), ("غرف", "6")), rooms="6")
    assert r["bathrooms"] is None
    assert r["bedrooms"] == 6


def test_rent_period_comes_only_from_the_published_token():
    r = _row(name="فيلا للإيجار في شارع يزيد بن محمد, حي طويق, مدينة الرياض", ref="AQ254001",
             price="55000.00", period=_YEARLY, specs=(("المساحة", "251 م²"),))
    assert (r["rent_period"], r["price_annual"], r["price_total"]) == ("annual", 55000, None)


def test_rent_without_a_period_token_never_becomes_annual():
    # No «/ yearly» in the price block ⇒ the source stated no period. Inventing one (from the price
    # magnitude, the property type or "everything on this platform is yearly") is the exact
    # fabrication the 2026-08-11 rent-period audit removed fleet-wide.
    r = _row(name="فيلا للإيجار في شارع يزيد بن محمد, حي طويق, مدينة الرياض", ref="AQ254001",
             price="55000.00", specs=(("المساحة", "251 م²"),))
    assert r["rent_period"] is None
    assert r["price_total"] is None


def test_per_metre_rate_never_lands_in_price_total():
    r = _row(name="أرض للبيع في شارع الصالحية 159, حي الصالحية, مدينة جدة", ref="AQ902300",
             price="1200.00", period='<span class="text-base font-normal">/ م²</span>',
             specs=(("المساحة", "250 م²"),), locality="جدة", district="حي الصالحية", area="250.00")
    assert (r["price_per_meter"], r["price_total"], r["price_annual"]) == (1200, None, None)


def test_type_comes_from_the_title_not_the_coarse_badge():
    # The detail badge says «فيلا»; the listing is a «دور». Reading the badge would file this row
    # under the wrong canonical type on ~10% of the catalog.
    r = _row(name="دور للإيجار في شارع وادي نعام, حي ضاحية نمار, مدينة الرياض", ref="AQ117801",
             price="35000.00", period=_YEARLY, specs=(("المساحة", "475 م²"),), badge="فيلا")
    assert r["property_type"] == "Floor"
    assert r["transaction_type"] == "Rent"


def test_title_without_a_published_deal_is_dropped_never_defaulted_to_buy():
    # No «للبيع»/«للإيجار» anywhere in the title ⇒ the source published no deal. The old fallback
    # defaulted to «للبيع», which would file a RENT price into price_total. Drop the row instead.
    assert map_listing(URL, _page(name="شقة مميزة في شارع المعرض, حي المزرعة, مدينة الرياض",
                                  ref="AQ999001", price="55000.00", period=_YEARLY), None) is None


def test_unmapped_type_is_dropped_never_stored_as_other():
    # "Other" is not in the app taxonomy AND N.category_for_type("Other") == "Commercial", so the
    # old fallback filed an unmappable listing into the commercial table under a type no search can
    # ever match. Only the shared canonical vocabulary may name a type.
    assert map_listing(URL, _page(name="مبنى غريب للبيع في شارع تبراك, حي عرقة, مدينة الرياض",
                                  ref="AQ999002", price="1000000.00"), None) is None


def test_similar_properties_strip_cannot_leak_into_the_row():
    r = _row(name="شقة للبيع في شارع عبدالله بن أبي الهذيل, حي الرمال, مدينة الرياض", ref="AQ065801",
             price="680000.00", district="حي الرمال", area="64.00", rooms="3",
             specs=(("المساحة", "64 م²"), ("غرف", "3"), ("حمام", "3")))
    assert r["ad_number"] == "AQ065801"
    assert (r["price_total"], r["price_annual"], r["rent_period"]) == (680000, None, None)
    assert r["city"] == "Riyadh" and r["region"] == "Riyadh"
    assert r["neighborhood"] == "حي الرمال"
