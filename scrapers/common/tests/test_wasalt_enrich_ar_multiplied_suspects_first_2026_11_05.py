"""A wasalt SALE row served at ≥100,000 SAR/m² gets its detail page FIRST (owner 2026-11-05).

5893909 (504 m², حي البوادي جدة) was served at 1,613,001,600: the seller typed the total into wasalt's per-m² box and wasalt
multiplied it by the area. The box figure (3,200,400) is only on the detail page, so until that page is read the meter-box
rule (migration 20261105233818, trg_wrz_land_box_figure) cannot correct the card. enrich_table() now reads those rows first.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_multiplied_suspects_first_2026_11_05.py -v
"""
from __future__ import annotations

import scrapers.wasalt.enrich_ar as EAR
from scrapers.common.tests.test_wasalt_enrich_ar_no_district_first_2026_10_18 import _no_net  # noqa: F401
from scrapers.common.tests.test_wasalt_enrich_ar_rate_suspects_first_2026_10_18 import _CR

ROWS = [
    {"listing_id": 4, "price_total_effective": 1_613_001_600, "area_m2": 504},  # 3.2 M SAR/m² — the multiplied shape
    {"listing_id": 8, "price_total_effective": 30_000_000, "area_m2": 600},     # 50,000 SAR/m² — dear, not ours
    {"listing_id": 9, "price_total_effective": 1_613_001_600, "area_m2": None},  # no area — never a suspect
]


def _run(monkeypatch, c):
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    monkeypatch.setattr(EAR, "_no_district_rows", lambda *a, **k: [])
    monkeypatch.setattr(EAR, "_rate_suspect_rows", lambda *a, **k: [])
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)


def test_multiplied_suspects_are_fetched_first(monkeypatch, _no_net):
    _run(monkeypatch, _CR(unfetched=range(1, 101), index_rows=ROWS))
    assert _no_net[0] == 4, _no_net                       # newest-first alone would start at 100
    assert 8 not in _no_net[:1] and 9 not in _no_net[:1]


def test_bar_is_100k_per_m2():
    assert EAR.MULTIPLIED_SUSPECT_PPM == 100_000


def test_mutant_without_the_multiplied_priority_starts_at_the_newest(monkeypatch, _no_net):
    """Mutation proof: with the multiplied read disabled the same run never reaches row 4."""
    monkeypatch.setattr(EAR, "_multiplied_suspect_rows", lambda *a, **k: [])
    _run(monkeypatch, _CR(unfetched=range(1, 101), index_rows=ROWS))
    assert 4 not in _no_net and _no_net[0] == 100
