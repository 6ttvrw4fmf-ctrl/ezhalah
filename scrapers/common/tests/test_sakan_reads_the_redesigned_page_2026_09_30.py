"""Sakan redesigned its listing page on 2026-09-30: the ld+json became a "RealEstateListing" whose
dwelling sits under `about` (typed Apartment / Accommodation / SingleFamilyResidence), `offers` is no
longer printed, and pages with the REGA panel print the price in a different span. The reader
required the old "SingleFamilyResidence" word, so every apartment, floor and office was a fetch miss
(2,019 of 2,971 on 2026-10-02), the prune guard tripped every run, and the daily direct check read
94% of the site as UNKNOWN. Shapes below are the live ones, measured 2026-10-02."""
from scrapers.common import normalize
from scrapers.sakan import run as K

URL = "https://sa.sakan.co/ar/property/details/93330-شقة"


def _page(dwelling="Apartment", price_span='<span class="f20 f20-700 f20-red me-1">540,000</span>'):
    return f'''<link rel="canonical" href="{URL}">
<script type='application/ld+json'>{{"@context": "https://schema.org/", "@type": "BreadcrumbList",
 "itemListElement": [{{"@type": "ListItem", "position": 2, "name": "x",
   "item": "https://sa.sakan.co/ar/buy/شقة/منطقة-مكة-المكرمة/جدة/الفيحاء"}}]}}</script>
<script type="application/ld+json">{{"@context": "https://schema.org", "@type": "RealEstateListing",
 "url": "{URL}", "about": {{"@type": "{dwelling}", "numberOfBedrooms": 4, "numberOfBathroomsTotal": 3}}}}</script>
<div class="aminities-box"> <div> <span class="fn fn--gray">الحالة</span> <div class=" icon-box"> <svg> <use xlink:href="#icon-checked-red-circle"></use> </svg> <span class="fn fn--b">فعال</span> </div> </div> </div>
<div class="price details__action--inner-section-1"> <span class="f16 ">سعر البيع</span> <div> {price_span} <span>ر.س</span> </div> </div>'''


def test_the_dwelling_under_about_is_read_whatever_its_type():
    for dwelling in ("Apartment", "Accommodation", "SingleFamilyResidence"):
        p = K.parse_page(URL, _page(dwelling))
        assert (p["bedrooms_raw"], p["bathrooms_raw"]) == ("4", "3"), dwelling
        assert p["deal"] == "Buy" and p["city_ar"] == "جدة"


def test_the_price_is_read_from_both_page_templates_now_that_offers_is_gone():
    assert normalize.to_int(K.parse_page(URL, _page())["price_shown"]) == 540000
    rega = K.parse_page(URL, _page(price_span='<span class="fb fb--h fb--red">1,250,000</span>'))
    assert normalize.to_int(rega["price_shown"]) == 1250000 and rega["price_ld"] is None


def test_an_apartment_page_is_a_listing_page_and_reads_live():
    assert K._is_listing(_page("Apartment")) and not K._is_listing("<html>BreadcrumbList only</html>")
    assert K._signal_for("93330")(200, _page("Apartment"), False) == "live"
    assert K._signal_for("11111")(200, _page("Apartment"), False) is None, "another ad's page is no verdict"
