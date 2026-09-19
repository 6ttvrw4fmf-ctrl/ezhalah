"""ksaaqar: the price is the AD'S OWN, never the sidebar's.

WHY THIS FILE EXISTS. On 2026-09-19 every ksaaqar price in production was wrong. The parser
searched the whole flattened detail page for the first "...SAR" string. Two facts about this theme
made that catastrophic rather than merely fragile:

  1. Every detail page renders a STATIC sidebar of five unrelated ads in `.price-box`, and it is
     byte-identical on every page of the site.
  2. The ad's OWN price is printed in Arabic riyals, so "SAR" never matched it at all.

The parser therefore could not read a real price even in principle: it copied one neighbour's
figure onto 685 of 720 priced rows (159 listings all "13,370", 231 all "250,000"), and stamped that
same number onto ads whose own card says the price is on request and which have NO published price.
PRICE = SOURCE forbids exactly this.

The old tests were GREEN throughout, because they fed parse_price a hand-typed "50,000.00SAR"
string. A test that writes its own input cannot catch a bug about WHICH element to read. Every
fixture below is markup captured verbatim from live ksaaqar.com pages, sidebar included, so the
neighbour's price is physically present in the input and a regression has something to grab.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_price_is_the_ads_own_not_the_sidebars.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.ksaaqar.run import own_price  # noqa: E402

SELF_URL = "https://ksaaqar.com/ad/%d8%a3%d8%b1%d8%a7%d8%b6%d9%8a-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/"
REQ_URL = ("https://ksaaqar.com/ad/%d8%a7%d8%b1%d8%b6-%d9%83%d8%a8%d9%8a%d8%b1%d8%a9"
           "-%d8%a8%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d9%85%d8%b3%d8%aa%d9%88%d8%af%d8%b9%d8%a7%d8%aa/")

# Captured verbatim from SELF_URL: the ad's own published price is 3,200.00 riyal, and it sits
# AFTER the site-wide sidebar whose first entry is 13,370.00SAR -- the value 159 live listings were
# wrongly given.
PAGE_WITH_OWN_PRICE = """<div class="price-box">
                                            <strong>13,370.00SAR <small>(Negotiable)</small></strong>                                                                                        <a href="javascript:void(0);"
                                               data-adid="28401"
                                               class="favourite ad_to_fav"
                                               data-toggle="tooltip"
                                               data-placement="top"
                                               title="انقر لجعله مفضلا"
                                               aria-label="انقر لجعله مفضلا">
                                                <i class="far fa-heart"></i>
                                            </a>
                                        </div><div class="price-box">
                                            <strong>200.00SAR <small>(Negotiable)</small></strong>                                                                                        <a href="javascript:void(0);"
                                               data-adid="28248"
                                               class="favourite ad_to_fav"
                                               data-toggle="tooltip"
                                               data-placement="top"
                                               title="انقر لجعله مفضلا"
                                               aria-label="انقر لجعله مفضلا">
                                                <i class="far fa-heart"></i>
                                            </a>
                                        </div><div class="recent-ads-container">
                                <div class="recent-ads-list-image">
									                                </div>
                                <div class="recent-ads-list-content">
                                    <h3 class="recent-ads-list-title"><a
                                                href="https://ksaaqar.com/ad/%d8%a3%d8%b1%d8%a7%d8%b6%d9%8a-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/">أراضي للبيع</a></h3>
                                    <div class="recent-ads-list-price"><h3>3,200.00ريال </h3><span class="negotiable">&nbsp;(مُثَبَّت)</span></div>
                                    <p>Unnamed Road Unnamed Road, الرياض 13532  للبيع قطعة ارض سكني  في حي القيروان غرب  طريق الخير وشمال  طريق المالك سلمان  مساحة ٤٥٠م  شارع ٢٠ غربي  الاطوال ١٥×٣٠   سوم ٣١٠٠ريال بدون الضريبة  مباشر من المالك...</div>
                            </div>
                        </div>
                    </div>"""

# Captured verbatim from REQ_URL: its own card says the price is on request, i.e. NO
# published price. The old parser gave it 13,370 -- a price we invented outright.
PAGE_PRICE_ON_REQUEST = """<div class="price-box">
                                            <strong>13,370.00SAR <small>(Negotiable)</small></strong>                                                                                        <a href="javascript:void(0);"
                                               data-adid="28401"
                                               class="favourite ad_to_fav"
                                               data-toggle="tooltip"
                                               data-placement="top"
                                               title="انقر لجعله مفضلا"
                                               aria-label="انقر لجعله مفضلا">
                                                <i class="far fa-heart"></i>
                                            </a>
                                        </div><div class="price-box">
                                            <strong>200.00SAR <small>(Negotiable)</small></strong>                                                                                        <a href="javascript:void(0);"
                                               data-adid="28248"
                                               class="favourite ad_to_fav"
                                               data-toggle="tooltip"
                                               data-placement="top"
                                               title="انقر لجعله مفضلا"
                                               aria-label="انقر لجعله مفضلا">
                                                <i class="far fa-heart"></i>
                                            </a>
                                        </div><div class="recent-ads-container">
                                <div class="recent-ads-list-image">
									                                </div>
                                <div class="recent-ads-list-content">
                                    <h3 class="recent-ads-list-title"><a
                                                href="https://ksaaqar.com/ad/%d8%a7%d8%b1%d8%b6-%d9%83%d8%a8%d9%8a%d8%b1%d8%a9-%d8%a8%d9%85%d9%86%d8%b7%d9%82%d8%a9-%d9%85%d8%b3%d8%aa%d9%88%d8%af%d8%b9%d8%a7%d8%aa/">ارض كبيرة بمنطقة مستودعات</a></h3>
                                    <div class="recent-ads-list-price">السعر عند الطلب</div>
                                    <p>ارض بالحذيفات بين طريق مكة القديم والجديد خلف مستشفى الحرس بجدة. مساحة 14000م. مسورة وفيها بير وغرفتين. بوثيقة. بدون كهرباء. منطقة مستودعات..كل الجيران عندهم كهرباء 0564171144التواصل عالواتس فقط...</div>
                            </div>
                        </div>
                    </div>"""


def test_the_ads_own_price_is_read_not_the_first_number_on_the_page():
    assert own_price(PAGE_WITH_OWN_PRICE, SELF_URL) == 3200


def test_the_sidebars_price_is_never_borrowed():
    # 13,370 is physically present in the fixture, ahead of the real price, in the exact element
    # the old parser read. This is the regression, stated as an inequality.
    assert "13,370.00SAR" in PAGE_WITH_OWN_PRICE, "fixture must still contain the neighbour's price"
    assert own_price(PAGE_WITH_OWN_PRICE, SELF_URL) != 13370


def test_price_on_request_is_absence_never_a_neighbours_figure():
    assert "13,370.00SAR" in PAGE_PRICE_ON_REQUEST
    assert own_price(PAGE_PRICE_ON_REQUEST, REQ_URL) is None, \
        "a price-on-request ad published no price; inventing one is what PRICE = SOURCE bans"


def test_a_card_for_a_DIFFERENT_ad_is_not_this_ads_price():
    # The card is matched on the ad's own href. Ask for a different listing and the answer is None,
    # never whichever card happens to be on the page.
    assert own_price(PAGE_WITH_OWN_PRICE, "https://ksaaqar.com/ad/some-other-ad/") is None


def test_percent_encoded_and_decoded_links_are_the_same_ad():
    # The REST API's link and the rendered href do not always agree on encoding; they are one ad.
    decoded = "https://ksaaqar.com/ad/\u0623\u0631\u0627\u0636\u064a-\u0644\u0644\u0628\u064a\u0639/"
    assert own_price(PAGE_WITH_OWN_PRICE, decoded) == 3200


def test_no_card_at_all_is_None_not_a_fallback_scan():
    assert own_price("<html><body>1,250,000.00SAR</body></html>", SELF_URL) is None, \
        "with no own-card there is no price -- falling back to a page scan is the bug itself"
