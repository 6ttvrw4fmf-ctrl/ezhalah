"""A wasalt SALE row served under 50 SAR/m² gets its Arabic page FIRST (2026-10-18).

5813546 (467 m², حي النرجس) was served at «6,500» — a per-m² rate typed into the price field. Its own description says
«Price: 3041220 SAR», but its Arabic page had never been read (54 of 108 such plots), so the trigger that moves a proven
rate to price_per_meter had no text to read. enrich_table() now reads those rows first; the source's text decides.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_rate_suspects_first_2026_10_18.py -v
"""
from __future__ import annotations

import scrapers.wasalt.enrich_ar as EAR
from scrapers.common.tests.test_wasalt_enrich_ar_no_district_first_2026_10_18 import _C, _Q, _no_net  # noqa: F401


class _QR(_Q):
    def execute(self):
        if self.t == "search_listings_ar" and self.n != 1:
            class R:
                data = self.c.index_rows
            return R()
        return super().execute()


class _CR(_C):
    def __init__(self, unfetched, index_rows):
        super().__init__(unfetched, [])
        self.index_rows = index_rows

    def table(self, t):
        return _QR(self, t)


ROWS = [
    {"listing_id": 3, "price_total_effective": 6500, "area_m2": 467},     # 14 SAR/m² — the rate shape
    {"listing_id": 7, "price_total_effective": 90000, "area_m2": 400},    # 225 SAR/m² — a real cheap plot, not ours
    {"listing_id": 9, "price_total_effective": 6500, "area_m2": None},    # no area — never a suspect
]


def test_rate_suspects_are_fetched_first(monkeypatch, _no_net):
    c = _CR(unfetched=range(1, 101), index_rows=ROWS)
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    monkeypatch.setattr(EAR, "_no_district_rows", lambda *a, **k: [])
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)
    assert _no_net[0] == 3, _no_net                       # newest-first alone would start at 100
    assert 7 not in _no_net[:1] and 9 not in _no_net[:1]


def test_mutant_without_the_rate_priority_starts_at_the_newest(monkeypatch, _no_net):
    """Mutation proof: with the rate read disabled the same run never reaches row 3."""
    c = _CR(unfetched=range(1, 101), index_rows=ROWS)
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    monkeypatch.setattr(EAR, "_no_district_rows", lambda *a, **k: [])
    monkeypatch.setattr(EAR, "_rate_suspect_rows", lambda *a, **k: [])
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)
    assert 3 not in _no_net and _no_net[0] == 100
