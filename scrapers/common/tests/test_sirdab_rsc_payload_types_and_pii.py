"""Sirdab: ads come out of the RSC flight payload; storage units are never guessed into a type; the
constant «/سنة» card label never overrules a monthly-looking price; the owner's phone is never stored."""
import json

import pytest

import scrapers.sirdab.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t)


def _ad(**kw):
    prop = {"property_type": "warehouse", "area_in_m2": 500, "cities": {"name_ar": "الرياض"},
            "district_name": "الروضة", "facade": "east", "street_width": 100, "property_age": 1,
            "has_water": True, "has_sewage": False, "lat": 24.7, "lng": 46.8, "building_number": "10",
            "user_id": "u-1", "images": [{"url": "https://x/2.jpg", "isPrimary": False},
                                         {"url": "https://x/1.jpg", "isPrimary": True}]}
    prop.update(kw.pop("property", {}))
    a = {"id": "ad-1", "slug": "s-1", "listing_type": "rent", "price_in_cents": 16000000, "status": "active",
         "title_ar": "مستودع للإيجار في الرياض حي الروضة", "description_ar": "مستودع مناسب", "owner_phone": "0551234567",
         "property": prop}
    a.update(kw)
    return a


def test_the_ads_array_is_read_out_of_the_flight_payload():
    ads = [_ad(), _ad(id="ad-2")]
    chunk = json.dumps('0:["$","div",{"totalCount":564,"ads":' + json.dumps(ads, ensure_ascii=False) + '}]',
                       ensure_ascii=False)[1:-1]
    page = f'<script>self.__next_f.push([1,"{chunk}"])</script>'
    got, total = R.page_ads(page)
    assert total == 564 and [a["id"] for a in got] == ["ad-1", "ad-2"]


def test_a_yearly_rent_maps_with_its_facts_and_primary_photo_first():
    (row, cat), why = R.map_ad(_ad())
    assert why == "" and cat == "commercial" and row["property_type"] == "Warehouse"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 160000)
    assert row["photo_urls"][0] == "https://x/1.jpg" and row["listing_url"].endswith("/s-1")
    assert row["water_supply"] is True and "sanitation" not in row      # a False flag stays silent


def test_the_constant_year_label_never_overrules_a_monthly_looking_price():
    (row, _), _ = R.map_ad(_ad(price_in_cents=200000))                   # 2,000 «/سنة» on a 500 m² warehouse
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 24000)


def test_a_sub_riyal_placeholder_is_no_price_and_a_sale_is_a_total():
    (row, _), _ = R.map_ad(_ad(price_in_cents=10))
    assert row["price_annual"] is None
    (row, _), _ = R.map_ad(_ad(listing_type="sale", price_in_cents=250000000))
    assert (row["transaction_type"], row["price_total"]) == ("Buy", 2500000)


@pytest.mark.parametrize("t,ptype", [("storage", "Self Storage"), ("storage_yard", "Storage Yard")])
def test_storage_units_and_yards_go_in_service_facilities_under_the_sites_word(t, ptype):
    (row, cat), _ = R.map_ad(_ad(property={"property_type": t}))       # owner rule 2026-09-28
    assert (row["property_type"], cat) == (ptype, "commercial")


def test_an_unknown_source_type_is_still_never_guessed():
    assert R.map_ad(_ad(property={"property_type": "hangar"}))[1] == "type_unmapped_hangar"


@pytest.mark.parametrize("cents", [100, 170, 9900])
def test_a_one_riyal_placeholder_clears_the_stored_rent(cents):
    from scrapers.common import db
    (row, _), _ = R.map_ad(_ad(price_in_cents=cents))                    # measured: 1 and 1.7 SAR «rents»
    assert row["price_annual"] is db.AUTHORITATIVE_NULL and row["rent_period"] is db.AUTHORITATIVE_NULL
    assert "price_per_meter" not in row and row["price_evidence"]["stored"] is None


def test_a_per_square_metre_rate_is_kept_as_the_rate_not_a_rent():
    from scrapers.common import db
    (row, _), _ = R.map_ad(_ad(price_in_cents=600, title_ar="مساحات تخزين ايجار بالمتر المربع"))
    assert row["price_per_meter"] == 6 and row["price_annual"] is db.AUTHORITATIVE_NULL


def test_the_owner_phone_and_building_number_are_never_stored():
    (row, _), _ = R.map_ad(_ad())
    blob = json.dumps(row, ensure_ascii=False)
    assert "0551234567" not in blob and "owner_phone" not in blob and "building_number" not in blob
    assert "user_id" not in blob


# THE EIGHT COMPASS FORMS SIRDAB'S OWN PAYLOAD WRITES, measured on production 2026-09-27 (#4959):
# the diagonals come WITHOUT an underscore («northeast»), which is how 10 of 63 facades were silently
# dropped while _FACADE_AR expected «north_east».
#
# This tuple is stated here DELIBERATELY, and not derived from R._FACADE_AR, because the defect was a
# form the SOURCE writes that the MAP LACKS: a population read off the map could never catch a missing
# key — it would be a check whose population is defined by the thing it is checking, the
# self-confirming shape this repo has already been burned by (see verify-live-sweep-coverage-contract's
# seeded-on-its-own-alternatives regex, #4890, same day). The source vocabulary is an independent
# reading; the map is the thing under test.
_SOURCE_FACADES = ("north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest")


@pytest.mark.parametrize("facade", _SOURCE_FACADES)
def test_every_facade_the_source_writes_is_read(facade):
    """EVERY form, not a sample of them.

    Until 2026-09-27 this parametrized ["east", "northeast", "southwest"] — 3 of the 8 — while its own
    name and #4959's commit message both claimed it pinned «every form the source writes». Measured by
    mutation that day (routine #9): reverting ONLY «northwest»→«north_west» and «southeast»→«south_east»
    — re-introducing the exact defect for 2 of the 4 diagonals, 4 of the 10 originally-lost facades —
    left this file at a full 10/10 GREEN. A barrier that names a class and tests a sample of it reports
    the class as covered.
    """
    (row, _), _ = R.map_ad(_ad(property={"facade": facade}))
    assert row["direction"], f"the source writes «{facade}» and the map does not read it"


def test_the_map_declares_no_key_the_source_never_writes():
    """The other direction: a key that can never fire is a corpse, and it is how the defect HID.

    «north_east» sat in _FACADE_AR looking like coverage for four months. Reading the map against the
    source vocabulary — rather than only the source against the map — is what makes a stale key visible
    instead of reassuring.
    """
    stale = sorted(set(R._FACADE_AR) - set(_SOURCE_FACADES))
    assert not stale, f"_FACADE_AR keys the source never writes (dead entries): {stale}"


def test_the_map_renders_a_distinct_arabic_facade_for_every_source_form():
    """Truthy is not enough: two forms collapsing onto one Arabic label would silently mislabel one."""
    # .get, not [] — a MISSING form is the parametrized test's job to name; this one is about two
    # present forms colliding, and a KeyError here would only obscure which failure a reader is seeing.
    labels = [R._FACADE_AR[f] for f in _SOURCE_FACADES if f in R._FACADE_AR]
    assert len(set(labels)) == len(labels), f"duplicate facade labels: {labels}"



def test_the_ad_licence_the_page_prints_is_stored():
    # «رقم ترخيص الإعلان» is shown under the description (badge «إعلان موثق»); 361 of 549 carried one, none stored
    (row, _), _ = R.map_ad(_ad(description_ar="مستودع مناسب.\n\nرقم ترخيص الإعلان: 7200560460"))
    assert row["license_number"] == "7200560460"
    (row, _), _ = R.map_ad(_ad())
    assert row["license_number"] is None      # silent stays NULL


# ── district from the ad's own title when the structured field is empty/English (288 of 564 ads) ──
_CATALOG = {"حي المروة", "حي السويدي", "حي السويدي الغربي", "حي السلي"}


@pytest.mark.parametrize("title,district", [
    ("شارع التل، حي المروة، جنوب الرياض", "حي المروة"),
    ("شارع الفجر، حي السويدي الغربي، غرب الرياض", "حي السويدي الغربي"),   # longest match wins
    ("مستودع للإيجار في حي السلي، الرياض", "حي السلي"),
    ("مستودع على طريق الملك عبدالعزيز", None),                           # no explicit «حي» → nothing
    ("مستودع في حي غير موجود، الرياض", None),                             # not in the city catalog
])
def test_the_title_names_the_district_when_the_field_does_not(monkeypatch, title, district):
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t if t in _CATALOG else None)
    (row, _), _ = R.map_ad(_ad(title_ar=title, property={"district_name": "riyadh"}))
    assert row["district_ar"] == district
