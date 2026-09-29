"""نفوذ (nufouth.com): a city that exists in two regions was dropped, and two plain types skipped.

COVERAGE AUDIT 2026-09-28, measured live over the 268 indexed properties:
  · map_listing called to_catalog(city) with no region hint. «الهفوف» is both the Eastern-province
    city (catalog 12, 110 districts) and a Riyadh-region namesake (501, no districts), so every
    Hofuf unit skipped as city_not_in_catalog — H219 «حي الشهابية» among them — and so did
    «الدوادمي», «المجمعة», «الباحة» and «العيينة». The source states no region, but it does state
    the district, and arabic_location.resolve() narrows a twin ONLY when that district belongs to
    exactly one candidate. A twin whose district matches neither must stay unplaced (never guessed).
  · «فيلا دوبلكس» (N5435) and «مبنى» (H253) skipped as type_unmapped although the fleet already maps
    them: sqcc/eilmalriyada → Duplex, snam/dealapp/souq24/sadin/alsidra/eaqartabuk → Building.

The REAL resolve() runs here over a two-row fake of the catalog (the shape read from production on
2026-09-28); only the catalog load is stubbed. Fixtures keep the keys map_listing reads, with the
unit title's owner name removed (PDPL).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.nufouth import run as R  # noqa: E402

URL = "https://nufouth.com/latest-offers?ads-H219=1"
H219 = {"property": {"code": "H219", "property_type": "أرض تجارية", "city": "الهفوف",
                     "district": "حي الشهابية", "property_area": 1150}}
H219_AD = {"name": "ADV-00665", "ad_type": "ايجار", "status": "نشط", "annual_rent": 234210.0,
           "selling_price": 0.0, "ad_license_no": "7200859018", "custom_sell_property": 0}
H219_U = {"name": "(1-أرض تجارية)-أرض المباركية F-H219", "unit_type": "أرض تجارية",
          "space": 1171.25, "area": 1171.25, "annual_rent": "234,210", "selling_price": "0"}


def test_twin_city_is_placed_by_its_own_district_and_fleet_types_map(monkeypatch):
    k = al.norm_district_tok
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {al.norm_ar("الهفوف"): [(12, 5), (501, 1)],
                                      al.norm_ar("الدوادمي"): [(669, 1), (2679, 8)],
                                      al.norm_ar("الرياض"): [(3, 1)]})
    monkeypatch.setattr(al, "_CID_AR", {12: "الهفوف", 501: "الهفوف", 669: "الدوادمي",
                                        2679: "الدوادمي", 3: "الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    monkeypatch.setattr(al, "_REGION_AR_FOR", {1: "منطقة الرياض", 5: "المنطقة الشرقية", 8: "منطقة حائل"})
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {12: {k("حي الشهابية")}, 669: {k("حي حطين")}})
    # The shipping scraper's own names, pointed at the real resolver (another test file stubs them).
    monkeypatch.setattr(R, "resolve", al.resolve)
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)

    row, _cat, why = R.map_listing(H219, H219_AD, H219_U, URL)
    assert why == "", f"H219 (الهفوف, حي الشهابية) was dropped: {why!r}"
    assert (row["city_id"], row["region_id"], row["city_ar"]) == (12, 5, "الهفوف")

    # Never guessed: a twin whose district belongs to neither candidate stays unplaced.
    lost = {"property": dict(H219["property"], city="الدوادمي", district="حي العليا")}
    assert R.map_listing(lost, H219_AD, H219_U, URL)[2] == "city_not_in_catalog"

    riyadh = {"property": dict(H219["property"], city="الرياض", district="حي الملك سلمان")}
    for type_ar, want in (("فيلا دوبلكس", "Duplex"), ("مبنى", "Building")):
        row, _cat, why = R.map_listing(riyadh, H219_AD, dict(H219_U, unit_type=type_ar), URL)
        assert why == "" and row["property_type"] == want, f"{type_ar!r} → {why or row['property_type']!r}"
