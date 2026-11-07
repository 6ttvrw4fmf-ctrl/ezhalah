"""aqargate.com moved from WordPress to a marketplace app (2026-11-05 ~21:00 UTC).

The WordPress REST route answers HTTP 500 on every page, so the 11-06 crawl saved 0 rows and the
liveness controls read 0/5, while the homepage answers 200 and the new public API serves 205 ads
(/api/public/listings, ad page /marketplace/<id>). These tests pin the new read path: the same row
keeps its AG<wp id> number when the ad was imported, the link is the page a customer opens, the pin
reaches the place the index view reads, PII never reaches the capture, PRICE = SOURCE on land, and
the oracle only kills on the site's own «Listing not found».

Run: python -m pytest scrapers/common/tests/test_aqargate_marketplace.py -v
"""
import json
import sys

sys.path.insert(0, ".")

import scrapers.aqargate.run as AG  # noqa: E402
from scrapers.common import db  # noqa: E402

AG.to_catalog = lambda city, region_hint=None: (None, None)  # catalogue lookup needs the DB

IMPORTED = {  # trimmed from the live record 675 (2026-11-06), contact values replaced
    "id": 675, "status": "published", "listingType": "sale", "propertyType": "apartment",
    "price": "760000.00", "area": "150.00", "bedrooms": 4, "bathrooms": 3,
    "city": "مكة المكرمة", "district": "الشوقية", "latitude": "21.384000", "longitude": "39.774000",
    "titleAr": "شقة للبيع", "descriptionAr": "شقة واسعة للتواصل 0551234567",
    "images": ["/uploads/a.webp", "https://aqargate.com/uploads/b.webp"],
    "adLicenseNumber": "7201004648", "contactName": "X", "contactPhone": "0551234567",
    "advertiserName": "Y", "advertiserMobile": "0551234567", "contactEmail": "a@b.co",
    "regaData": {"wp_id": 55898, "fave_property_id": "AG-55898", "region": "منطقة مكة المكرمة",
                 "PlatformCompliance": 'a:1:{s:7:"details";s:30:"{"advertiserName":"Y 0551234567"}";}'},
}
NATIVE = {"id": 907, "status": "published", "listingType": "rent", "propertyType": "office",
          "price": "3700.00", "area": "5000.00", "city": "الرياض", "district": "الدريهمية",
          "latitude": "0", "longitude": "0", "images": [], "regaData": {}}
LAND = {"id": 902, "status": "published", "listingType": "sale", "propertyType": "ارض",
        "price": "6500.00", "area": "284.51", "city": "جدة", "district": "أبحر الشمالية",
        "images": [], "regaData": {"landTotalPrice": "1849315"}}


def test_imported_ad_keeps_its_row_and_gets_the_new_link():
    row, cat = AG.map_marketplace(IMPORTED)
    assert cat == "residential"
    assert row["ad_number"] == "AG55898"                      # the row we already hold
    assert row["listing_url"] == "https://aqargate.com/marketplace/675"
    assert row["price_total"] == 760000 and row["transaction_type"] == "Buy"
    assert row["area_m2"] == 150 and row["bedrooms"] == 4 and row["bathrooms"] == 3
    assert row["photo_urls"] == ["https://aqargate.com/uploads/a.webp", "https://aqargate.com/uploads/b.webp"]
    loc = row["source_capture"]["property_meta"]["advertisement_response"]["location"]
    assert (loc["latitude"], loc["longitude"]) == ("21.384000", "39.774000")


def test_no_contact_or_advertiser_identity_in_the_capture():
    row, _ = AG.map_marketplace(IMPORTED)
    s = json.dumps(row["source_capture"], ensure_ascii=False)
    for bad in ("0551234567", "a@b.co", "advertiserName", "contactName", "PlatformCompliance"):
        assert bad not in s, bad
    assert "0551234567" not in (row["description"] or "")
    assert "7201004648" in s                                   # the REGA licence survives


def test_native_ad_gets_its_own_number_and_no_fake_pin():
    row, cat = AG.map_marketplace(NATIVE)
    assert row["ad_number"] == "AGM907" and cat == "commercial"
    assert row["transaction_type"] == "Rent" and row["price_annual"] == 3700 and row["price_total"] is None
    assert "latitude" not in row["source_capture"]["property_meta"]["advertisement_response"]["location"]


def test_land_rate_is_a_rate_not_a_total():
    row, _ = AG.map_marketplace(LAND)
    assert row["property_type"] == "Residential Land"
    assert row["price_total"] is db.AUTHORITATIVE_NULL and row["price_per_meter"] == 6500


def test_unpublished_or_untyped_records_are_skipped():
    assert AG.map_marketplace({**NATIVE, "status": "rejected"})[0] is None
    assert AG.map_marketplace({**NATIVE, "propertyType": "spaceship"})[0] is None


def test_oracle_kills_only_on_the_sites_own_not_found():
    v = lambda st, body: (AG._market_verdict(st, body, 907) or (None,))[0]
    assert v(404, {"error": "Listing not found"}) == "gone"
    assert v(404, {"error": "Unauthorized"}) == "unknown"
    assert v(404, None) == "unknown"
    assert v(500, None) is None and v(403, None) is None and v(None, None) is None
    assert v(200, {"id": 907, "status": "published"}) == "live"
    assert v(200, {"id": 1, "status": "published"}) == "unknown"
    assert v(200, {"id": 907, "status": "expired"}) == "unknown"
    assert v(200, None) == "unknown"


class _Stub:
    def __init__(self, seq):
        self.seq, self.urls = list(seq), []

    def get(self, url, timeout=None):
        self.urls.append(url)
        st, body = self.seq.pop(0)

        class R:
            status_code = st

            def json(_s):
                if body is None:
                    raise ValueError("not json")
                return body
        return R()


def test_oracle_routes_by_ad_number(monkeypatch):
    monkeypatch.setattr(AG, "_throttle", lambda: None)
    monkeypatch.setattr(AG.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(AG, "_stored_market_id", lambda ad: None)
    stub = _Stub([(404, {"error": "Listing not found"})])
    monkeypatch.setattr(AG, "_oracle_session", lambda: stub)
    assert AG.verify_gone_any("AGM907")[0] == "gone"
    assert stub.urls == ["https://aqargate.com/api/public/listings/907"]
    # a WordPress-era row the new site never listed: only the old route is left, and it is dead (500)
    stub2 = _Stub([(500, None), (500, None)])
    monkeypatch.setattr(AG, "_oracle_session", lambda: stub2)
    assert AG.verify_gone_any("AG51111")[0] == "unknown"
    assert all("/wp-json/" in u for u in stub2.urls)
    # an imported ad read this run is checked on its marketplace id
    AG._MARKET_IDS["AG55898"] = 675
    stub3 = _Stub([(200, {"id": 675, "status": "published"})])
    monkeypatch.setattr(AG, "_oracle_session", lambda: stub3)
    assert AG.verify_gone_any("AG55898")[0] == "live"


def test_an_unread_page_is_not_an_empty_page(monkeypatch):
    monkeypatch.setattr(AG, "_throttle", lambda: None)
    monkeypatch.setattr(AG.time, "sleep", lambda *_a, **_k: None)
    data, pages, total = AG.fetch_market_page(_Stub([(500, None)] * 3), 3)
    assert data is None and pages == 0 and total == 0


def test_a_reposted_ad_without_its_import_tag_keeps_its_row_by_licence():
    rec = {**NATIVE, "id": 41, "adLicenseNumber": "7200801814"}
    stored = [("AG52707", "7200801814"), ("AG55898", "7201004648"), ("AG1", "7000000001"), ("AG2", "7000000001")]
    legacy = AG.legacy_licence_map(stored, [rec, IMPORTED])
    assert legacy == {"7200801814": "AG52707"}           # AG55898 is claimed by its wp_id; 700…1 is ambiguous
    assert AG.map_marketplace(rec, legacy)[0]["ad_number"] == "AG52707"
    # two marketplace records with one licence are two ads: neither inherits the row
    twin = {**rec, "id": 42}
    assert AG.legacy_licence_map(stored, [rec, twin]) == {}


def test_an_imported_land_ad_without_landTotalPrice_is_still_a_rate():
    rec = {**LAND, "id": 648, "price": "40.00", "area": "106474.00",
           "regaData": {"wp_id": 52441}}                  # AG52441, live 2026-11-06: no landTotalPrice
    row, _ = AG.map_marketplace(rec)
    assert row["ad_number"] == "AG52441"
    assert row["price_total"] is db.AUTHORITATIVE_NULL and row["price_per_meter"] == 40
