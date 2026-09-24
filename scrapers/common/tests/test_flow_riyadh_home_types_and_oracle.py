"""Offline barrier for scrapers/flow/run.py — the traps this Riyadh-only compound source sets.

Every fixture is REAL flow.life payload harvested on 2026-09-24: the floorplan dicts are verbatim
slices of props.pageProps.floorplans from the __NEXT_DATA__ of
/en/properties/riyadh-granada/available-homes (fids C1ThyDRn8cT7nzvDUHcF «2 Bedroom» and
IQAMWrxvlLwiGnJFiSSZ «Wadi 3 Bedroom») and /riyadh-olaya/available-homes (phBbGPeQ0IJVMZJQxsdo
«B2 Standard 2-bedroom with wraparound balcony»), trimmed to the keys the code reads; the sitemap
lines are verbatim <loc> entries. Only to_catalog / find_district_in_text are stubbed.

WHAT IT PINS
  1. PRICE = the printed «starting at SAR 152,000 / year»: startingAtPrice exactly, annual ONLY
     because the interval word is "year"; the furnished figure and the range top are archived,
     never blended; a "month" interval is monthly ×12; any other interval → NULL + raw archived.
  2. FURNISHED stays NULL although homeAmenities says «Furnished Units Available» — the same home
     type is priced both ways; the other amenities still map (air_conditioner, balcony_terrace).
  3. bathrooms 2.5 → NULL + bathrooms_exact; area 89.84 → 89 + area_exact.
  4. SKIPS: a property whose region is not Riyadh → city_not_mapped; status ≠ available →
     not_available; a floorplan with no fid → floorplan_without_fid.
  5. listing_url is the sitemap's own per-fid page (fallback: slugified title); ad_number carries
     the property slug so the oracle can rebuild that page.
  6. PII: property.phoneNumber / countryCode never reach the row.
  7. ORACLE: 200 with externalRefId == fid → live; a readable 200 without it (the redirect to the
     list page) → gone; no page JSON / non-200 → no verdict; malformed ad_number → unknown.
  8. main() tallies the 404-shell property into end_run(notes=…) with inline check_tables and
     prunes only a complete run.
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

from scrapers.flow import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, hint=None: ((3, 1) if city_ar == "الرياض" else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda text, city_id: text if (city_id == 3 and text in ("حي غرناطة", "حي العليا")) else None)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)


GRANADA = {"data": {"id": 13, "attributes": {
    "name": "Flow Granada", "title": "Flow Granada", "slug": "riyadh-granada", "locale": "en",
    "phoneNumber": "115207100", "countryCode": "966", "region": "Riyadh",
    "description": "Just a 10-minute walk from Granada Metro Station, Flow Granada is where life, learning, and leisure come together. Flow Granada offers luxury 2- to 3-bedroom apartments"}}}
OLAYA = {"data": {"id": 15, "attributes": {
    "name": "Flow Olaya", "slug": "riyadh-olaya", "phoneNumber": "115207100", "countryCode": "966", "region": "Riyadh",
    "description": "Where life and leisure come together. Flow Olaya offers luxury 1- to 2-bedroom apartments"}}}

FP_2BR = {
    "floorplan": {"fid": "C1ThyDRn8cT7nzvDUHcF", "name": "Samhan 2 Bedroom", "unitCount": 58,
                  "minPrice": {"currency": "SAR", "basePrice": 152000, "pricePeriod": "P12M", "leaseDuration": "P12M", "furnishedPrice": 176000},
                  "maxPrice": {"currency": "SAR", "basePrice": 176000, "pricePeriod": "P12M", "leaseDuration": "P12M", "furnishedPrice": 204000},
                  "minFloorArea": {"units": "SQ_ME", "value": 107}, "maxFloorArea": {"units": "SQ_ME", "value": 141}},
    "status": "available", "title": "2 Bedroom",
    "description": "Located in Flow Granada, Riyadh. A 114 m², 2-bedroom and 3-bath intended to cultivate wellness and creativity of a life in Flow.",
    "startingAtPrice": 152000, "startingAtPriceInterval": "year", "startingAtCurrency": "SAR",
    "bedrooms": 2, "bathrooms": 3, "furnishedAvailable": True, "area": 107, "areaUnit": "sqm",
    "externalRefId": "C1ThyDRn8cT7nzvDUHcF", "externalRefType": "fid", "startingAtFurnishedPrice": 176000,
    "homeAmenities": "Terrace, Furnished Units Available, Refrigerator, Microwave, Oven, Electric Cooktop, Built-In Oven, Air Conditioner, Dishwasher, Combination Washer/Dryer, Built-In Closets",
    "propertyAmenities": "Pool, Hot Tub, Sauna, Steam Room, Expansive Gym, Restaurant, Coffee Shop",
    "newConstruction": False, "property": GRANADA,
    "poster": {"data": {"attributes": {"url": "https://flowhouse.imgix.net/cms/DRS_Hssq0_Jbix_Uik7_O6z_J_c2d9451ef5.png"}}}}
FP_WADI = {**FP_2BR, "title": "Wadi 3 Bedroom", "startingAtPrice": 163000, "startingAtFurnishedPrice": 189000,
           "bedrooms": 3, "bathrooms": 2.5, "area": 114, "externalRefId": "IQAMWrxvlLwiGnJFiSSZ", "newConstruction": None,
           "floorplan": {**FP_2BR["floorplan"], "fid": "IQAMWrxvlLwiGnJFiSSZ", "unitCount": 82,
                         "maxPrice": {"currency": "SAR", "basePrice": 163000, "pricePeriod": "P12M", "leaseDuration": "P12M", "furnishedPrice": 189000}},
           "poster": {"data": None}}
FP_B2 = {**FP_2BR, "title": "B2 Standard 2-bedroom with wraparound balcony", "startingAtPrice": 226999,
         "startingAtFurnishedPrice": 227000, "bedrooms": 2, "bathrooms": 2, "area": 89.84,
         "externalRefId": "phBbGPeQ0IJVMZJQxsdo", "property": OLAYA,
         "homeAmenities": "Furnished Units, Microwave, Built-in Oven, Electric Cooktop, Refrigerator, Air Conditioner, Laundry room/Storage Room, Combination Washer, Built-in Closets, Walk-in Closet in Master Bedroom, Balcony",
         "floorplan": {**FP_2BR["floorplan"], "fid": "phBbGPeQ0IJVMZJQxsdo", "unitCount": 42,
                       "maxPrice": {"currency": "SAR", "basePrice": 226999, "pricePeriod": "P12M", "leaseDuration": "P12M", "furnishedPrice": 227000}},
         "poster": {"data": {"attributes": {"url": "https://flowhouse.imgix.net/cms/Level_01_Unit_B2_01_a5c3bf2f3d.png"}}}}

URL_2BR = "https://flow.life/en/properties/riyadh-granada/available-homes/2-bedroom/fid/C1ThyDRn8cT7nzvDUHcF"
URL_BY_FID = {"C1ThyDRn8cT7nzvDUHcF": URL_2BR}


def _page(pp: dict) -> str:
    return ('<html><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": pp}}, ensure_ascii=False) + '</script></html>')


def _row(fp, prop_slug="riyadh-granada", by_fid=URL_BY_FID):
    row, cat, why = R.map_listing(fp, prop_slug, by_fid)
    assert row is not None, why
    return row, cat


# 1 ── price ─────────────────────────────────────────────────────────────────────────────────────
def test_starting_price_is_stored_exactly_annual_only_from_the_year_word():
    row, cat = _row(FP_2BR)
    assert row["price_annual"] == 152000 and row["rent_period"] == "annual"
    assert row["additional_info"]["furnished_starting_price"] == 176000
    assert row["additional_info"]["price_high"] == 176000 and row["additional_info"]["lease_duration"] == "P12M"
    assert "price_total" not in row and row["transaction_type"] == "Rent"
    assert cat == "residential" and row["property_type"] == "Apartment"
    assert row["title"] == "Flow Granada – 2 Bedroom" and row["city_ar"] == "الرياض" and row["district_ar"] == "حي غرناطة"
    assert row["neighborhood"] == "Granada" and row["bedrooms"] == 2 and row["bathrooms"] == 3 and row["area_m2"] == 107


def test_other_intervals_are_never_parked_as_annual():
    # FP_2BR's verbatim price block with ONE key changed — the shape a future source edit would take.
    assert R.price_from_floorplan({**FP_2BR, "startingAtPriceInterval": "month"})[:2] == (152000 * 12, "monthly")
    nightly = R.price_from_floorplan({**FP_2BR, "startingAtPriceInterval": "night"})
    assert nightly[:2] == (None, None) and nightly[2]["starting_price_raw"]["price"] == 152000
    usd = R.price_from_floorplan({**FP_2BR, "startingAtCurrency": "USD"})
    assert usd[:2] == (None, None) and usd[2]["starting_price_raw"]["currency"] == "USD"
    assert R.price_from_floorplan({**FP_2BR, "startingAtPrice": None}) == (None, None, {})
    wadi = R.price_from_floorplan(FP_WADI)
    assert wadi[0] == 163000 and "price_high" not in wadi[2]


# 2/3 ── furnished tri-state, fractional counts ───────────────────────────────────────────────────
def test_furnished_stays_null_while_the_other_amenities_still_map():
    row, _ = _row(FP_2BR)
    assert "furnished" not in row
    assert row["air_conditioner"] is True and row["balcony_terrace"] is True
    assert "elevator" not in row and "parking" not in row
    assert row["additional_info"]["home_amenities_en"].startswith("Terrace, Furnished Units Available")
    b2, _ = _row(FP_B2, "riyadh-olaya")
    assert "furnished" not in b2 and b2["laundry_room"] is True


def test_half_bathroom_and_fractional_area_keep_the_exact_figure():
    wadi, _ = _row(FP_WADI)
    assert wadi["bathrooms"] is None and wadi["additional_info"]["bathrooms_exact"] == "2.5"
    assert wadi["area_m2"] == 114 and "area_exact" not in wadi["additional_info"]
    assert wadi["photo_urls"] is None and "new_construction" not in wadi["additional_info"]
    b2, _ = _row(FP_B2, "riyadh-olaya")
    assert b2["area_m2"] == 89 and b2["additional_info"]["area_exact"] == "89.84" and b2["bathrooms"] == 2
    assert b2["district_ar"] == "حي العليا" and b2["price_annual"] == 226999


# 4 ── skips ─────────────────────────────────────────────────────────────────────────────────────
def test_non_riyadh_unavailable_and_fidless_floorplans_are_skipped():
    miami = {**FP_2BR, "property": {"data": {"attributes": {**GRANADA["data"]["attributes"], "region": "Miami"}}}}
    assert R.map_listing(miami, "riyadh-granada", {}) == (None, None, "city_not_mapped")
    assert R.map_listing({**FP_2BR, "status": "unavailable"}, "riyadh-granada", {}) == (None, None, "not_available")
    assert R.map_listing({**FP_2BR, "externalRefId": None, "floorplan": {}}, "riyadh-granada", {}) == (None, None, "floorplan_without_fid")
    no_word = {**FP_2BR, "property": {"data": {"attributes": {**GRANADA["data"]["attributes"], "description": "A community."}}}}
    assert R.map_listing(no_word, "riyadh-granada", {})[2] == "type_unmapped"
    assert R.map_listing({**no_word, "title": "Studio"}, "riyadh-granada", {})[1] == "commercial"


# 5/6 ── url, identity, PII ──────────────────────────────────────────────────────────────────────
def test_listing_url_is_the_sitemaps_own_fid_page_with_a_slugified_fallback():
    row, _ = _row(FP_2BR)
    assert row["listing_url"] == URL_2BR and row["ad_number"] == "FLW-riyadh-granada-fid-C1ThyDRn8cT7nzvDUHcF"
    b2, _ = _row(FP_B2, "riyadh-olaya", {})
    assert b2["listing_url"] == ("https://flow.life/en/properties/riyadh-olaya/available-homes/"
                                 "b2-standard-2-bedroom-with-wraparound-balcony/fid/phBbGPeQ0IJVMZJQxsdo")
    assert "None" not in b2["listing_url"]
    dump = json.dumps(row, ensure_ascii=False)
    assert "115207100" not in dump and "countryCode" not in dump
    assert row["photo_urls"] == ["https://flowhouse.imgix.net/cms/DRS_Hssq0_Jbix_Uik7_O6z_J_c2d9451ef5.png"]


# 7 ── oracle ────────────────────────────────────────────────────────────────────────────────────
def test_oracle_fid_echo_is_live_readable_page_without_it_is_gone():
    sig = R._signal_for("C1ThyDRn8cT7nzvDUHcF")
    assert sig(200, _page({"externalRefId": "C1ThyDRn8cT7nzvDUHcF", "floorplans": [FP_2BR]}), False) == "live"
    assert sig(200, _page({"externalRefId": None, "floorplans": [FP_2BR, FP_WADI]}), True) == "gone"
    assert sig(200, _page({"floorplans": None}), True) == "gone"          # /missing
    assert sig(200, "<html>Oops! Looks like you are a little lost.</html>", False) is None
    assert sig(404, _page({}), False) is None and sig(None, "", False) is None


def test_verify_gone_rebuilds_the_fid_page_from_the_ad_number(monkeypatch):
    verify = R._make_verify_gone({"ad_number": "FLW-riyadh-granada-fid-C1ThyDRn8cT7nzvDUHcF"})
    assert verify("ETH-wadi-qortuba-18")[0] == "unknown"
    assert verify("FLW-miami-fid-abc")[0] == "unknown"
    seen: list = []

    class _S:
        def get(self, url, **kw):
            seen.append(url)
            fid = url.rsplit("/", 1)[1]
            live = fid == "C1ThyDRn8cT7nzvDUHcF"
            return types.SimpleNamespace(status_code=200, url=url if live else url.rsplit("/home/", 1)[0],
                                         text=_page({"externalRefId": fid if live else None, "floorplans": [FP_2BR]}))

    monkeypatch.setattr(R, "session", lambda: _S())
    assert verify("FLW-riyadh-granada-fid-C1ThyDRn8cT7nzvDUHcF")[0] == "live"
    assert seen[0] == "https://flow.life/en/properties/riyadh-granada/available-homes/home/fid/C1ThyDRn8cT7nzvDUHcF"
    assert verify("FLW-riyadh-granada-fid-NOPE12345")[0] == "gone"     # canary live → the kill stands


# 8 ── main() ────────────────────────────────────────────────────────────────────────────────────
_SITEMAP = ("<urlset><url><loc>https://flow.life/en/properties/riyadh-granada/available-homes</loc></url>"
            "<url><loc>https://flow.life/en/properties/riyadh-granada/available-homes/*</loc></url>"
            "<url><loc>https://flow.life/en/properties/riyadh-granada/available-homes/2-bedroom/fid/C1ThyDRn8cT7nzvDUHcF</loc></url>"
            "<url><loc>https://flow.life/en/properties/riyadh-science-park/available-homes</loc></url>"
            "<url><loc>https://flow.life/en/properties/riyadh-science-park/available-homes/studio/fid/fid_floorplan_riyadh-science-park_studio</loc></url>"
            "<url><loc>https://flow.life/en/properties/miami-brickell/available-homes</loc></url>"
            "<url><loc>https://flow.life/en/regions/riyadh</loc></url></urlset>")
_PAGES = {"riyadh-granada": _page({"propertySlug": "riyadh-granada", "floorplans": [FP_2BR, FP_WADI]}),
          "riyadh-science-park": _page({"propertySlug": None, "floorplans": None})}


class _FakeSession:
    def get(self, url, **kw):
        if url.endswith("/sitemap.xml"):
            return types.SimpleNamespace(status_code=200, text=_SITEMAP, url=url)
        return types.SimpleNamespace(status_code=200, text=_PAGES[url.split("/properties/")[1].split("/")[0]], url=url)


def test_sitemap_keeps_only_riyadh_properties_and_the_fid_urls():
    monkey = _FakeSession()
    slugs, by_fid = R.fetch_sitemap(monkey)
    assert slugs == ["riyadh-granada", "riyadh-science-park"]
    assert by_fid == {"C1ThyDRn8cT7nzvDUHcF": URL_2BR,
                      "fid_floorplan_riyadh-science-park_studio": "https://flow.life/en/properties/riyadh-science-park/available-homes/studio/fid/fid_floorplan_riyadh-science-park_studio"}


def test_main_tallies_the_404_shell_into_end_run_notes_and_prunes_a_complete_run(monkeypatch):
    calls: dict = {"batches": [], "pruned": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: _FakeSession())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls["pruned"].append((tbl, sorted(seen), source)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"] == [("flow_residential_listings", ["FLW-riyadh-granada-fid-C1ThyDRn8cT7nzvDUHcF",
                                                               "FLW-riyadh-granada-fid-IQAMWrxvlLwiGnJFiSSZ"]),
                                ("flow_commercial_listings", [])]
    assert calls["pruned"][0][0] == "flow_residential_listings" and calls["pruned"][0][2] == "Flow"
    assert calls["end"]["rows_seen"] == 2 and calls["end"]["rows_upserted"] == 2
    assert "property_not_livex1" in calls["end"]["notes"] and "complete=True" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["flow_residential_listings", "flow_commercial_listings"]


def test_limit_run_never_prunes(monkeypatch):
    calls: dict = {"touched": 0}
    monkeypatch.setattr(sys, "argv", ["run.py", "--limit", "1"])
    monkeypatch.setattr(R, "session", lambda: _FakeSession())
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: calls.__setitem__("touched", 1))
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda *a, **k: calls.__setitem__("touched", 1))
    assert R.main() == 0 and calls["touched"] == 0


def test_partial_enumeration_writes_but_never_prunes(monkeypatch):
    """One property unreachable → complete=False → the seen-set is incomplete → no prune."""
    calls: dict = {"pruned": 0, "batches": 0}

    class _Flaky(_FakeSession):
        def get(self, url, **kw):
            if "riyadh-science-park" in url:
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
