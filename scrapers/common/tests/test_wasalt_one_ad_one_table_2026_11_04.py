"""wasalt: one source ad lives in ONE table (2026-11-04, url_collision_res_vs_com:wasalt, alert 6925).

The commercial search also answers residential-usage ads; the old scrape_slice filed every ad by the
search that returned it, so WST5904998 «فيلا سكنية» (usage Residential) was a card from BOTH tables.
The table now follows the source's own «Property usage», and a known usage supersedes the sibling row.
"""
from __future__ import annotations

import scrapers.wasalt.run as R


def _row(ad: str, usage: str | None) -> dict:
    info = [{"key": "propertyMainType", "label": "Property usage", "value": usage}] if usage else []
    return {"ad_number": ad, "property_type": "Villa", "additional_info": info}


def _wire(monkeypatch):
    calls: dict = {"res": [], "com": [], "retire": []}
    monkeypatch.setattr(R.db, "upsert_wasalt_residential_batch", lambda rows: calls["res"].extend(r["ad_number"] for r in rows))
    monkeypatch.setattr(R.db, "upsert_wasalt_commercial_batch", lambda rows: calls["com"].extend(r["ad_number"] for r in rows))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: calls["retire"].append(kw) or 0)
    return calls


def test_a_residential_usage_ad_from_the_commercial_search_goes_residential(monkeypatch):
    calls = _wire(monkeypatch)
    n = R.upsert_page([_row("WST5904998", "Residential"), _row("WST1", "Commercial")], "commercial", 1)
    assert n == 2
    assert calls["res"] == ["WST5904998"] and calls["com"] == ["WST1"]
    kw = calls["retire"][0]
    assert kw["res_ads"] == {"WST5904998"} and kw["com_ads"] == {"WST1"}


def test_mixed_and_agricultural_usage_are_residential_commercial_usage_is_commercial(monkeypatch):
    for usage, want in (("Residential Commercial", "residential"), ("Agricultural", "residential"),
                        ("Residential", "residential"), ("Commercial", "commercial")):
        for search in ("residential", "commercial"):
            assert R.table_category(_row("X", usage), search) == want


def test_silence_keeps_the_search_category_and_supersedes_nothing(monkeypatch):
    calls = _wire(monkeypatch)
    R.upsert_page([_row("WST7", None)], "commercial", 1)
    assert calls["com"] == ["WST7"] and calls["res"] == []
    assert calls["retire"] == []           # an unknown usage never retires a sibling


def test_a_failed_upsert_supersedes_nothing(monkeypatch):
    calls = _wire(monkeypatch)

    def boom(rows):
        raise RuntimeError("PostgREST 503")
    monkeypatch.setattr(R.db, "upsert_wasalt_residential_batch", boom)
    assert R.upsert_page([_row("WST8", "Residential")], "commercial", 1) == 0
    assert calls["retire"] == []           # never retire the row we could not replace
