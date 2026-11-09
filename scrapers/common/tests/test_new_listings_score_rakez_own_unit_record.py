"""rakez: a unit is scored from its OWN REST record, not from its project page's partial unit table (🆕 2026-11-09).

The 11-09 05:35 score capped rakez at 75 % on one ad: 25491881 (RKZ…, stored 622,000 · 185 m² · 2 bedrooms) was read
against project 66463's printed rows «588,000 / 708,000 / 643,000 …» (re-read run 42578333590) — other units of the
same project. The record shape below is the unit API's (scrapers/rakez/run.py docstring: acf.price, area,
private_area, rooms_count, unit_status)."""
from scrapers.common import new_listings_score as S

URL = "https://rakez.sa/ar/project/66463/"


def _rec(**acf):
    base = {"unit_status": "available", "price": "622000", "area": "150", "private_area": "35", "rooms_count": "2"}
    base.update(acf)
    return {"id": 70001, "title": {"rendered": "وحدة A-12"}, "acf": base}


def _page(rec, ad="RKZ70001"):
    return S.rakez_page(URL, ad, fetch=lambda uid: rec)


def test_the_units_own_record_states_price_area_and_rooms():
    page = _page(_rec())
    r = S.compare_listing({"price_total": 622000, "area_m2": 185, "bedrooms": 2}, page)
    assert r["price"] == S.MATCH and r["area"] == S.MATCH and r["bedrooms"] == S.MATCH, r


def test_a_different_stored_price_is_still_a_mismatch():
    r = S.compare_listing({"price_total": 588000}, _page(_rec()))
    assert r["price"] == S.MISMATCH, r


def test_the_project_page_alone_misreads_the_unit():
    # the old path: the project page's other units are read as this unit's price
    page = S.page_evidence("<div>588,000 ريال 3</div><div>133.18 م²</div><div>708,000 ريال 3</div>")
    assert S.compare_listing({"price_total": 622000}, page)["price"] == S.MISMATCH


def test_another_units_record_is_unknown_not_wrong():
    assert _page(_rec(), ad="RKZ70002") is None


def test_a_sold_unit_is_unknown_not_wrong():
    assert _page(_rec(unit_status="sold")) is None


def test_an_unreadable_record_is_unknown():
    assert _page(None) is None
    assert S.rakez_page(URL, "RKZ70001", fetch=lambda uid: (_ for _ in ()).throw(RuntimeError("down"))) is None
