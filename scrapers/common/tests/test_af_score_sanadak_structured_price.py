"""sanadak: the listing object's own structured `price` is read, not only the description's prose (🆕 2026-11-09).

25845975 (score run 42568334721): the object says price 4200 / rentTypeText «شهر» (we store and show 4,200, PRICE = SOURCE);
its description says «4300 ريال شهرياً (شامل الكهرباء والماء والإنترنت)». The reader emitted only the prose, so our
structured figure scored MISMATCH."""
from scrapers.common import af_score
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing

OBJ = {"title": "شقة للإيجار في الرياض الملقا 1 غرفة 1 حمام", "price": 4200, "rentTypeText": "شهر", "lotSize": 100,
       "description": "خدمة تنظيف أسبوعية 4300 ريال شهرياً (شامل الكهرباء والماء والإنترنت)"}


def _page(obj=OBJ):
    return af_score.sanadak_page("https://sanadak.sa/property-details/x-1", fetch=lambda u: [obj])


def test_the_objects_own_price_matches():
    assert compare_listing({"price_total": 4200}, _page())["price"] == MATCH


def test_a_price_the_object_never_states_is_still_wrong():
    assert compare_listing({"price_total": 3900}, _page())["price"] == MISMATCH


def test_no_structured_price_adds_no_line():
    page = _page({**OBJ, "price": None})
    assert not any(x.startswith("السعر ") for x in page["evidence_lines"])
