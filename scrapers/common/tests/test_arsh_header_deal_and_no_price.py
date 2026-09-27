"""Arsh: type/district/plan/block come from the page's HEADER line, never the prose; only an explicit
deal PHRASE counts (owner 2026-09-27: otherwise the land is for sale); the site publishes no price."""
import pytest

import scrapers.arsh.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (31, 5) if c else (None, None))
    monkeypatch.setattr(R, "stated_city", lambda t: ("الخبر", 31, 5) if "مدينة الخبر" in (t or "") else (None, None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t if t in ("حي الصدفة", "حي القصور") else None)


def _d(content, slug="الخبر-الصدفة-بلك-23"):
    return {"slug": slug, "content": content, "lat": "26.36", "lng": "50.22", "image": None}


BLOCK = ("أراضي سكنية حي الصدفة ( المهندسين ) مخطط رقم ش د 985 بلك رقم 23 نبذة عن المخطط يقع مخطط "
         "المهندسين شمال مدينة الخبر، مخطط سكني تجاري على مساحة 881,600 متر مربع")


def test_the_header_is_the_listing_and_the_prose_is_not():
    (row, cat), why = R.map_page(_d(BLOCK))
    assert why == "" and row["property_type"] == "Residential Land" and cat == "residential"
    assert row["district_ar"] == "حي الصدفة" and row["plan_parcel"] == "ش د 985 / بلك 23"
    assert "area_m2" not in row          # the PLAN's 881,600 m² is never the listing's area


def test_a_commercial_word_in_the_prose_never_retypes_the_header():
    (row, _), _ = R.map_page(_d("مخطط رقم ش د 5 بلك رقم 2 نبذة عن المخطط يضم أرض تجارية ومحلات على الطريق"))
    assert row["property_type"] == "Residential Land"


def test_a_bracketed_district_is_read():
    (row, _), _ = R.map_page(_d("أراضي سكنية حي الظهران ( القصور ) مخطط الصقعبي رقم 113/1 بلك رقم 22 نبذة عن المخطط"))
    assert row["district_ar"] == "حي القصور"


def test_prose_about_selling_or_leasing_later_is_not_this_listings_deal():
    text = BLOCK + " تَسهُل عليك عمليات البيع والتأجير فينمو استثمارك للتواصل مع فريق المبيعات"
    (row, _), _ = R.map_page(_d(text))
    assert row["transaction_type"] == "Buy"                   # owner rule, not «التأجير» → Rent


def test_an_explicit_lease_phrase_is_never_forced_to_sale():
    assert R.map_page(_d(BLOCK + " الأرض للتأجير"))[0][0]["transaction_type"] == "Rent"
    assert R.map_page(_d(BLOCK + " للبيع أو للتأجير")) == (None, "deal_ambiguous_sale_and_lease")


def test_no_price_is_ever_stored_and_an_empty_page_is_skipped():
    (row, _), _ = R.map_page(_d(BLOCK))
    assert row["price_total"] is None
    assert R.map_page(_d("أرض")) == (None, "empty_page")
