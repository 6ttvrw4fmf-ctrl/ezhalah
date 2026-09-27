"""The CARD's district line and the INDEX's district must come from ONE parse (live bug, 2026-09-21).

`ResultCard` shows the RAW scraped district whenever it is already Arabic — owner rule 2026-07-06,
enforced in src/data/remote.ts:
    l.district = /[ء-ي]/.test(rawDistrict || '') ? rawDistrict : ((ar?.district) || … )
— and that raw value is the platform table's `neighborhood` column (LIST_SELECT → `district:
r.neighborhood`). So for an Arabic-raw platform the canonical index value is NEVER what the user
reads, and `neighborhood` is a display surface in its own right.

aqarmonthly filled it from its own naive slug parse, `re.search(r"حي\\s+(\\S+(?:\\s+\\S+){0,2})")`,
which grabs up to three tokens after «حي» with no stop condition — the exact corruption
test_aqarmonthly_resolve_slug_district_suffix.py pins for `district_ar`, left live in the column the
card actually renders. Measured on production 2026-09-27 (anon key): 1,352 of 1,801 active rows, e.g.
AQM4840985 «الفرسان الدمام الدمام» and AQM5638357 «الرمال الرياض منطقة», while `district_ar` — and
`search_listings_ar` built from it — correctly said «حي الفرسان» / «حي الرمال». Found by real-user
testing on ezhalah-app.vercel.app: searching حي بدر returned cards labelled «بدر الرياض منطقة».

These tests drive the REAL map_listing() (never a copy) and assert the two columns agree, so the
card and the search index can never again disagree about where a listing is.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
from scrapers.aqarmonthly.run import map_listing

PRICE = {"discounted_price": 3000}


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {"الرياض": [(3, 1)], "الدمام": [(13, 5)]})
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض", 13: "الدمام"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    # Keyed with norm_district_tok(), which is what loc_catalog_district.district_norm stores
    # («حي الصحافة» → «صحافه») — the key production holds, not a normalize_ar() lookalike.
    monkeypatch.setattr(al, "_DISTRICT_AR_BY_CITY",
                        {(3, al.norm_district_tok("حي الصحافة")): "حي الصحافة"})
    yield


def row_for(uri: str, address: str | None = None) -> dict:
    return map_listing({"id": 1, "uri": uri, "area": 100, "imgs": [], "address": address}, PRICE)


@pytest.mark.parametrize("uri, district", [
    # Every shape is a real production slug; the comment is what the card used to read.
    ("حي-المهدية-الرياض-منطقة-الرياض-5839666", "حي المهدية"),          # «المهدية الرياض منطقة»
    ("شارع-15ب-حي-الفرسان-الدمام-الدمام-4840985", "حي الفرسان"),        # «الفرسان الدمام الدمام»
    ("حي-الرمال-الرياض-امارة-منطقة-الرياض-5510892", "حي الرمال"),       # «الرمال الرياض امارة»
    ("شارع-دباس-بن-راشد-حي-قرطبة-الرياض-منطقة-الرياض-6430739", "حي قرطبة"),
])
def test_card_district_carries_no_city_or_admin_marker(uri, district):
    r = row_for(uri)
    assert r["neighborhood"] == district
    for junk in ("الرياض", "الدمام", "منطقة", "امارة"):
        assert junk not in r["neighborhood"].replace(district, "")


def test_card_district_always_equals_the_stored_district():
    # ONE parse, ONE answer: whatever the index is built from is what the card renders.
    for uri in ("حي-المهدية-الرياض-منطقة-الرياض-5839666",
                "شارع-15ب-حي-الفرسان-الدمام-الدمام-4840985",
                "شارع-العمرة-الصحافة-الرياض-5946944",
                "الدرب-الدرب-3716038"):
        r = row_for(uri, address="شارع العمرة, الصحافة, الرياض" if "العمرة" in uri else None)
        assert r["neighborhood"] == r["district_ar"], uri


def test_address_fallback_reaches_the_card_too():
    # Slug has no «حي» at all, so the catalog-validated address fallback is the only district there
    # is — the card used to show nothing for these rows.
    r = row_for("شارع-العمرة-الصحافة-الرياض-5946944", address="شارع العمرة, الصحافة, الرياض")
    assert r["neighborhood"] == "حي الصحافة"


def test_an_unresolved_district_stays_null_never_invented():
    r = row_for("الدرب-الدرب-3716038", address="الدرب ، الدرب")
    assert r["neighborhood"] is None
    assert r["district_ar"] is None


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
