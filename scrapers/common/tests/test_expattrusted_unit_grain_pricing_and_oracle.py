"""Offline barrier for scrapers/expattrusted/run.py — the traps this compound source actually sets.

Every fixture is REAL expattrustedhousingriyadh.com payload harvested on 2026-09-24: the property
dicts are verbatim slices of props.pageProps.property from the __NEXT_DATA__ of
/p/en/property/wadi-qortuba, /al-bustan-village, /antara-living-riyadh, /al-fakhriya-compound,
/andorra-village, /al-yasmin-compound, /flow-narjis and /al-hamra, trimmed to the keys the code
reads (descriptions cut to their first sentence). Only to_catalog / find_district_in_text are stubbed.

WHAT IT PINS
  1. GRAIN + PRICE: each residence (unit type) is one row keyed ETH-<compound slug>-<residence id>;
     a RANGE stores the printed low figure («SAR 194,000 + per year») with `high` archived, a flat
     price stores exactly itself, an empty pricing list («Contact for pricing») is NULL, and a
     non-SAR/Year entry is archived raw, never converted. duration "Year" → rent_period annual.
  2. NEIGHBOUR CONTAMINATION: pageProps.recommendations carries other compounds' residences and
     prices; a page whose own property has no residences yields NO row even though the HTML holds
     «"low":205000».
  3. SKIPS: a residence name without a type word («3 Bedroom», «Single Room Suite») → type_unmapped;
     a compound whose address and description name no city → city_not_stated; never a default.
  4. LOCATION: city from the address, else the description (andorra-village); the district is the
     address segment (not a ROAD), attested against THAT city's catalog — «Ar Rihab, Diriyah» stays
     NULL; an Arabic «حي الرفيعة» token is attested alone, the whole address is never sent.
  5. PII: propertyEmail / propertyPhoneNumber / propertyWhatsApp never reach the row; a phone in the
     description is redacted.
  6. ORACLE: HTTP 404 → gone; 200 with the residence id present → live; 200 with the id absent →
     gone; a 200 without page JSON or a 5xx → no verdict. A malformed ad_number → unknown.
  7. main() tallies every skip into end_run(notes=…) with inline check_tables.
"""
from __future__ import annotations

import json
import sys
import types

import pytest

_supabase_mod = types.ModuleType("supabase")


class _StubClient:  # pragma: no cover
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.expattrusted import run as R  # noqa: E402

_CITY = {"الرياض": (3, 1), "الدرعية": (664, 1), "جدة": (18, 2), "المدينة المنورة": (14, 3)}
_RIYADH_DISTRICTS = {"حي قرطبة", "حي الرمال", "حي الرفيعة", "حي العارض", "حي الياسمين", "حي غرناطة"}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    calls: list = []

    def _find(text, city_id):
        calls.append((text, city_id))
        return text if (city_id == 3 and text in _RIYADH_DISTRICTS) else None

    monkeypatch.setattr(R, "to_catalog", lambda city_ar, hint=None: _CITY.get(city_ar, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _find)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    return calls


# ── verbatim residences ──────────────────────────────────────────────────────────────────────────
RES_18 = {"id": 18, "bedrooms": "two", "fullBathrooms": "two", "halfBathrooms": None, "area": None,
          "areaUnit": None, "name": "2 Bedroom Apartment", "title": "2 Bedroom Apartment", "description": None,
          "pricing": [{"id": 17, "low": 194000, "high": 210000, "currency": "SAR", "name": "Year - SAR", "duration": "Year"}]}
RES_17 = {"id": 17, "bedrooms": "one", "fullBathrooms": "one", "halfBathrooms": None, "area": None,
          "areaUnit": None, "name": "1 Bedroom Apartment", "title": "1 Bedroom Apartment", "description": None, "pricing": []}
RES_4 = {"id": 4, "bedrooms": "one", "fullBathrooms": "one", "halfBathrooms": None, "area": None, "areaUnit": None,
         "name": "1 Bedroom Apartment", "title": "1 Bedroom Apartment", "description": None,
         "pricing": [{"id": 4, "low": 205000, "high": 205000, "currency": "SAR", "name": "Year - SAR", "duration": "Year"}]}
RES_32 = {"id": 32, "bedrooms": "one", "fullBathrooms": "one", "halfBathrooms": None, "area": None, "areaUnit": None,
          "name": "Studio Apartment", "title": "Studio Apartment", "description": None, "pricing": []}
RES_27 = {"id": 27, "bedrooms": None, "fullBathrooms": None, "halfBathrooms": None, "area": None, "areaUnit": None,
          "name": "3 Bedroom Luxury Villa", "title": "3 Bedroom Luxury Villa", "description": None, "pricing": []}
RES_6 = {"id": 6, "bedrooms": "one", "fullBathrooms": "one", "halfBathrooms": None, "area": 69, "areaUnit": "sqm",
         "name": "1 Bedroom Apartment", "title": "1 Bedroom Apartment", "description": None,
         "pricing": [{"id": 6, "low": 169300, "high": 181200, "currency": "SAR", "name": "Year - SAR", "duration": "Year"}]}
RES_2 = {"id": 2, "bedrooms": "three", "fullBathrooms": "two", "halfBathrooms": None, "area": None, "areaUnit": None,
         "name": "3 Bedroom", "title": "3 Bedroom", "description": None, "pricing": []}

# ── verbatim compounds (trimmed) ─────────────────────────────────────────────────────────────────
WADI = {"slug": "wadi-qortuba", "name": "Wadi Qortuba",
        "address": "3346 Abdallah Ibn Ibrahim Ibn Seif, 7563, Qurtubah, Riyadh 13248, Saudi Arabia",
        "latitude": 24.8299730927383, "longitude": 46.7374348122905,
        "propertyEmail": "administration@wadiqortuba.com", "propertyPhoneNumber": "966118349700", "propertyWhatsApp": None,
        "description": "Wadi Qortuba is a modern, low-rise residential compound in northeastern Riyadh, designed for a balance of urban convenience and natural tranquility.",
        "features": {"data": [{"id": 44, "attributes": {"name": "Swimming Pool", "featureType": "building"}},
                              {"id": 40, "attributes": {"name": "Terrace", "featureType": "home"}}]},
        "images": [{"image": {"data": {"attributes": {"url": "https://assetservices.imgix.net/cms/aerial1_2b451802f1.jpg"}}}}],
        "primaryCardPhoto": {"data": {"attributes": {"url": "https://assetservices.imgix.net/cms/ext1_39ebb5fdff.jpg"}}},
        "residences": [RES_18, RES_17]}
BUSTAN = {"slug": "al-bustan-village", "name": "Al-Bustan Village",
          "address": "Prince Saud Ibn Abdullah Ibn Jalawi، 3010 – Al Arid Unit No: 2, Riyadh Saudi Arabia",
          "propertyEmail": "Rentals@al-bustan.net.sa", "propertyPhoneNumber": "966112235192", "propertyWhatsApp": None,
          "description": "Welcome to Al-Bustan Village, a modern oasis nestled within lush, tree-lined avenues and charming neighborhood parks in the heart of Riyadh.",
          "features": {"data": [{"attributes": {"name": "Shaded Parking Area", "featureType": "building"}}]},
          "images": [], "primaryCardPhoto": {"data": {"attributes": {"url": "https://assetservices.imgix.net/cms/Al_Bustan_Poster_91d57ebb08.jpg"}}},
          "residences": [RES_32, RES_27, RES_4]}
ANTARA = {"slug": "antara-living-riyadh", "name": "Antara Living Riyadh",
          "address": "King Khalid Br Rd, Ar Rihab, Diriyah 13717, Saudi Arabia",
          "propertyEmail": "info@antaraliving.com,ndiab@antaraliving.com", "propertyPhoneNumber": "9660115125999", "propertyWhatsApp": "966540570738",
          "description": "Antara Living Riyadh offers a resort-style living experience in a peaceful yet well-connected Riyadh location.",
          "features": {"data": [{"attributes": {"name": "Air Conditioner", "featureType": "home"}},
                                {"attributes": {"name": "Fitness Center", "featureType": "building"}}]},
          "images": [], "primaryCardPhoto": {"data": None}, "residences": [RES_6]}
FAKHRIYA = {"slug": "al-fakhriya-compound", "name": "Al Fakhriya Compound",
            "address": "4817 وادي الليسن, حي الرفيعة،, 7912, Riyadh 12751, Saudi Arabia",
            "propertyEmail": None, "propertyPhoneNumber": "966555064351", "propertyWhatsApp": None,
            "description": "Al Fakhriya Compound stands as a beacon of luxury and privacy in the prestigious Al Nasiriyah district of west Riyadh.",
            "features": {"data": []}, "images": [], "primaryCardPhoto": {"data": None}, "residences": [RES_4]}
ANDORRA = {"slug": "andorra-village", "name": "Andorra Village",
           "address": "Al Janadriyyah Road 4535 – Al Rimal Dist 13454 – 6963 Saudi Arabia",
           "propertyEmail": None, "propertyPhoneNumber": None, "propertyWhatsApp": None,
           "description": "Andorra Village is a luxurious residential compound located in northeast Riyadh.",
           "features": {"data": []}, "images": [], "primaryCardPhoto": {"data": None}, "residences": [RES_4]}
YASMIN = {"slug": "al-yasmin-compound", "name": "Al Yasmin Compound",
          "address": "Prince Abdulaziz Ibn Musaid Ibn Jalawi St",
          "propertyEmail": "info@egodesigns.net", "propertyPhoneNumber": "966112462533 ,966549300549 ", "propertyWhatsApp": None,
          "description": "Al Yasmin Compound is a premium residential community featuring 93 uniquely designed villas, each offering a private backyard and contemporary architecture.",
          "features": {"data": []}, "images": [], "primaryCardPhoto": {"data": None}, "residences": [RES_4]}
FLOW_NARJIS = {"slug": "flow-narjis", "name": "Flow Narjis", "address": "13343, Riyadh 13343, Saudi Arabia",
               "propertyEmail": "anead@flow.life,vbarrero@flow.life", "propertyPhoneNumber": "+966-11-520-7100", "propertyWhatsApp": "+966-11-520-7100",
               "description": "A conscious community offering 2 and 3 bedroom homes located in Riyadh, Kingdom of Saudi Arabia.",
               "features": {"data": [{"attributes": {"name": "Furnished", "featureType": "home"}}]},
               "images": [], "primaryCardPhoto": {"data": None}, "residences": [RES_2]}
HAMRA = {"slug": "al-hamra", "name": "Al Hamra Oasis Village Compound", "address": "Ash Shuhada, Riyadh 13241, Saudi Arabia",
         "propertyEmail": "sales@alhamra.com.sa,ramibitar@alhamra.com.sa", "propertyPhoneNumber": "966112490440 EXT: 716", "propertyWhatsApp": "966507421795",
         "description": "Al Hamra Oasis Village offers a premium residential experience that perfectly balances comfort, convenience, and luxury for expatriates and professionals in Riyadh.",
         "features": {"data": [{"attributes": {"name": "Laundry Service", "featureType": "home"}},
                               {"attributes": {"name": "Housekeeping Services", "featureType": "home"}}]},
         "images": [], "primaryCardPhoto": {"data": None}, "residences": []}


def _page(prop, recommendations=None) -> str:
    """The __NEXT_DATA__ shape of a live compound page (pageProps.property + recommendations)."""
    pp = {"locale": "en", "property": prop}
    if recommendations is not None:
        pp["recommendations"] = recommendations
    return ('<html><body><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": pp}, "page": "/p/[locale]/property/[slug]"}, ensure_ascii=False)
            + '</script></body></html>')


WADI_URL = "https://expattrustedhousingriyadh.com/p/en/property/wadi-qortuba"


def _row(prop, res, url=WADI_URL):
    row, cat, why = R.map_listing(prop, res, url, R.location(prop["address"], prop["description"]))
    assert row is not None, why
    return row, cat


# 1 ── grain + price ──────────────────────────────────────────────────────────────────────────────
def test_range_price_is_the_printed_low_figure_and_high_is_archived():
    row, cat = _row(WADI, RES_18)
    assert row["ad_number"] == "ETH-wadi-qortuba-18" and row["listing_url"] == WADI_URL
    assert row["price_annual"] == 194000 and row["rent_period"] == "annual"
    assert row["additional_info"]["price_high_annual"] == 210000
    assert "price_total" not in row and row["transaction_type"] == "Rent"
    assert cat == "residential" and row["property_type"] == "Apartment"
    assert row["bedrooms"] == 2 and row["bathrooms"] == 2 and row["area_m2"] is None


def test_flat_price_stores_exactly_itself_and_contact_for_pricing_is_null():
    flat, _ = _row(BUSTAN, RES_4)
    assert flat["price_annual"] == 205000 and flat["rent_period"] == "annual"
    assert "price_high_annual" not in flat["additional_info"]
    unpriced, _ = _row(WADI, RES_17)
    assert unpriced["price_annual"] is None and unpriced["rent_period"] is None


def test_non_sar_year_pricing_is_archived_raw_never_converted():
    # RES_18's verbatim entry with ONE key changed — the shape a future source edit would take.
    monthly = {**RES_18, "pricing": [{**RES_18["pricing"][0], "duration": "Month"}]}
    assert R.price_from_pricing(monthly["pricing"]) == (None, None, {"pricing_raw": monthly["pricing"]})
    assert R.price_from_pricing([]) == (None, None, {})
    assert R.price_from_pricing(RES_6["pricing"]) == (169300, "annual", {"price_high_annual": 181200})


# 2 ── neighbour contamination ───────────────────────────────────────────────────────────────────
def test_recommendations_block_never_prices_this_compound():
    recs = {"properties": {"data": [{"id": 3, "attributes": {"slug": "al-bustan-village", "residences": [RES_4]}}]}}
    html = _page(HAMRA, recommendations=recs)
    assert '"low": 205000' in html                      # the trap is really on the page
    prop = R.property_from_html(html)
    assert prop["slug"] == "al-hamra" and prop["residences"] == []
    rows, skipped = R.map_compound(prop, "https://expattrustedhousingriyadh.com/p/en/property/al-hamra")
    assert rows == [] and skipped == {"compound_without_unit_types": 1}
    assert R.property_from_html("<html>no data</html>") is None


# 3 ── skips ─────────────────────────────────────────────────────────────────────────────────────
def test_type_word_missing_is_type_unmapped_and_studio_routes_by_the_shared_category():
    rows, skipped = R.map_compound(FLOW_NARJIS, "u")
    assert rows == [] and skipped == {"type_unmapped": 1}
    assert R.type_ar_for("Single Room Suite") is None and R.type_ar_for("2 Bedroom Bungalow") is None
    assert R.type_ar_for("3 Bedroom Townhouse") == "فيلا" and R.type_ar_for("Studio Apartment") == "استوديو"
    row, cat = _row(BUSTAN, RES_32)
    assert row["property_type"] == "Studio" and cat == "commercial"
    luxury, _ = _row(BUSTAN, RES_27)
    assert luxury["property_type"] == "Villa" and luxury["bedrooms"] is None and luxury["bathrooms"] is None


def test_compound_naming_no_city_is_skipped_not_defaulted():
    rows, skipped = R.map_compound(YASMIN, "u")
    assert rows == [] and skipped == {"city_not_stated": 1}
    assert R.location(YASMIN["address"], YASMIN["description"]) == {}


# 4 ── location ──────────────────────────────────────────────────────────────────────────────────
def test_city_from_address_district_from_the_segment_not_the_road(_catalog):
    loc = R.location(ANDORRA["address"], ANDORRA["description"])   # city only in the description
    assert (loc["city_ar"], loc["city_id"], loc["district_ar"]) == ("الرياض", 3, "حي الرمال")
    assert loc["neighborhood"] == "Al Rimal Dist 13454" and loc["zip_code"] == "13454"
    assert ("حي الجنادرية", 3) not in _catalog                       # the ROAD was never a candidate
    wadi = R.location(WADI["address"], WADI["description"])
    assert wadi["district_ar"] == "حي قرطبة" and wadi["zip_code"] == "13248"
    bustan = R.location(BUSTAN["address"], BUSTAN["description"])
    assert bustan["district_ar"] == "حي العارض"


def test_district_is_attested_against_the_compounds_own_city(_catalog):
    loc = R.location(ANTARA["address"], ANTARA["description"])
    assert loc["city_ar"] == "الدرعية" and loc["city_id"] == 664
    assert loc["district_ar"] is None and loc["neighborhood"] is None
    assert ("حي الرحاب", 664) in _catalog


def test_arabic_district_token_is_attested_alone_never_the_whole_address(_catalog):
    loc = R.location(FAKHRIYA["address"], FAKHRIYA["description"])
    assert loc["district_ar"] == "حي الرفيعة" and loc["neighborhood"] == "حي الرفيعة"
    assert _catalog == [("حي الرفيعة", 3)]


# 5 ── PII + amenities + photos ──────────────────────────────────────────────────────────────────
def test_contact_fields_never_reach_the_row_and_description_phone_is_redacted():
    # The compound's own verbatim WhatsApp number and e-mail injected into the description probe.
    leaky = {**ANTARA, "description": ANTARA["description"] + " WhatsApp 966540570738 or info@antaraliving.com"}
    row, _ = _row(leaky, RES_6)
    dump = json.dumps(row, ensure_ascii=False)
    for secret in ("9660115125999", "966540570738", "info@antaraliving.com", "ndiab", "propertyPhoneNumber"):
        assert secret not in dump
    assert row["description"].startswith("Antara Living Riyadh offers") and "[redacted]" in row["description"]


def test_home_features_become_columns_building_parking_is_shared_and_silence_stays_null():
    antara, _ = _row(ANTARA, RES_6)
    assert antara["air_conditioner"] is True and antara["area_m2"] == 69 and antara["city_ar"] == "الدرعية"
    assert "furnished" not in antara and "elevator" not in antara and "parking" not in antara
    assert antara["additional_info"]["compound_facilities_en"] == "Fitness Center"
    bustan, _ = _row(BUSTAN, RES_4)
    assert bustan["parking"] is True
    narjis_row, _, why = R.map_listing(FLOW_NARJIS, RES_4, "u", R.location(FLOW_NARJIS["address"], None))
    assert narjis_row["furnished"] is True and narjis_row["district_ar"] is None


def test_laundry_service_is_a_service_not_a_laundry_room():
    row, _, why = R.map_listing(HAMRA, RES_4, "u", R.location(HAMRA["address"], None))
    assert row and "laundry_room" not in row
    assert row["additional_info"]["home_features_en"] == "Laundry Service, Housekeeping Services"


def test_photos_primary_first_then_gallery():
    row, _ = _row(WADI, RES_18)
    assert row["photo_urls"] == ["https://assetservices.imgix.net/cms/ext1_39ebb5fdff.jpg",
                                 "https://assetservices.imgix.net/cms/aerial1_2b451802f1.jpg"]
    assert row["additional_info"]["latitude"] == 24.8299730927383
    assert R.photos(FAKHRIYA) is None


# 6 ── oracle ────────────────────────────────────────────────────────────────────────────────────
def test_oracle_404_is_gone_id_present_is_live_id_absent_is_gone_unreadable_is_no_verdict():
    sig = R._signal_for("18")
    assert sig(404, "", False) == "gone"
    assert sig(200, _page(WADI), False) == "live"
    assert sig(200, _page({**WADI, "residences": [RES_17]}), False) == "gone"
    assert sig(200, "<html><body>maintenance</body></html>", False) is None
    assert sig(503, _page(WADI), False) is None and sig(None, "", False) is None


def test_verify_gone_rejects_a_malformed_ad_number_and_builds_the_compound_url(monkeypatch):
    verify = R._make_verify_gone({"ad_number": "ETH-wadi-qortuba-18"})
    assert verify("CIN485")[0] == "unknown"
    seen = {}

    class _Resp:
        status_code, url = 200, WADI_URL
        text = _page(WADI)

    class _S:
        def get(self, url, **kw):
            seen.setdefault("urls", []).append(url)
            return _Resp()

    monkeypatch.setattr(R, "session", lambda: _S())
    verdict, why = verify("ETH-wadi-qortuba-17")
    assert verdict == "live" and seen["urls"][0] == WADI_URL
    assert verify("ETH-wadi-qortuba-99")[0] == "gone"       # canary (id 18) is live, so the kill stands


# 7 ── main() ────────────────────────────────────────────────────────────────────────────────────
_SITEMAP = ("<urlset><url><loc>expattrustedhousingriyadh.com/p/en/property/wadi-qortuba</loc></url>"
            "<url><loc>expattrustedhousingriyadh.com/p/de/property/wadi-qortuba</loc></url>"
            "<url><loc>expattrustedhousingriyadh.com/p/en/property/al-hamra</loc></url>"
            "<url><loc>expattrustedhousingriyadh.com/p/en/property/al-yasmin-compound</loc></url>"
            "<url><loc>expattrustedhousingriyadh.com/p/en/property/gone-compound</loc></url>"
            "<url><loc>expattrustedhousingriyadh.com/p/en/about-us</loc></url></urlset>")
_PAGES = {"wadi-qortuba": (200, _page(WADI)), "al-hamra": (200, _page(HAMRA)),
          "al-yasmin-compound": (200, _page(YASMIN)), "gone-compound": (404, "<html>404</html>")}


class _FakeSession:
    def get(self, url, **kw):
        r = types.SimpleNamespace(url=url)
        if url.endswith("/sitemap.xml"):
            r.status_code, r.text = 200, _SITEMAP
        else:
            r.status_code, r.text = _PAGES[url.rsplit("/", 1)[1]]
        return r


def test_main_tallies_every_skip_into_end_run_notes_and_prunes_only_a_complete_run(monkeypatch):
    calls: dict = {"batches": [], "pruned": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: _FakeSession())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls["pruned"].append((tbl, sorted(seen), source)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"] == [("expattrusted_residential_listings", ["ETH-wadi-qortuba-18", "ETH-wadi-qortuba-17"]),
                                ("expattrusted_commercial_listings", [])]
    assert calls["pruned"][0] == ("expattrusted_residential_listings", ["ETH-wadi-qortuba-17", "ETH-wadi-qortuba-18"], "Expat Trusted Housing")
    assert calls["end"]["rows_seen"] == 4 and calls["end"]["rows_upserted"] == 2
    for tok in ("compound_without_unit_typesx1", "city_not_statedx1", "http_404x1", "complete=True"):
        assert tok in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["expattrusted_residential_listings", "expattrusted_commercial_listings"]


def test_limit_run_never_prunes(monkeypatch):
    calls: dict = {"pruned": 0}
    monkeypatch.setattr(sys, "argv", ["run.py", "--limit", "1"])
    monkeypatch.setattr(R, "session", lambda: _FakeSession())
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: calls.__setitem__("pruned", 1))
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda *a, **k: calls.__setitem__("pruned", 1))
    assert R.main() == 0 and calls["pruned"] == 0


def test_partial_enumeration_writes_but_never_prunes(monkeypatch):
    """One compound unreachable → complete=False → the seen-set is incomplete → no prune."""
    calls: dict = {"pruned": 0, "batches": 0}

    class _Flaky(_FakeSession):
        def get(self, url, **kw):
            if url.endswith("/al-hamra"):
                raise ConnectionError("timeout")
            return super().get(url, **kw)

    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: _Flaky())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls.__setitem__("batches", calls["batches"] + 1))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: calls.__setitem__("pruned", 1))
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"] == 2 and calls["pruned"] == 0
    assert "complete=False" in calls["end"]["notes"] and "unreachablex1" in calls["end"]["notes"]
