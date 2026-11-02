"""aljassim writes the catalog's numbered districts in the feminine («الفيصلية الثانية», «الفيصلية الاولى»)
where loc_catalog_district says «حي الفيصلية الثاني» / «حي الفيصلية الأول»: a spelling, mapped in the scraper
(contract G, 2026-10-24 — 4 + 1 ads had no district). The bare «الفيصلية» names neither half and stays NULL.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402

from scrapers.aljassim import run as R  # noqa: E402
from scrapers.common.tests.test_aljassim_source_truth import ROW_PER_METRE, _one  # noqa: E402

HOFUF = {"الفيصلية الثاني": "حي الفيصلية الثاني", "الفيصلية الاول": "حي الفيصلية الأول"}


@pytest.fixture()
def catalog(monkeypatch):
    # Exact-match only, like the real find_district_in_text: «الفيصلية» alone is not a Hofuf district.
    monkeypatch.setattr(R, "to_catalog", lambda *a, **k: (12, 5))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, _cid: HOFUF.get((text or "").strip()))


def test_fold():
    assert R.masculine_ordinal("الفيصلية الثانية") == "الفيصلية الثاني"
    assert R.masculine_ordinal("الفيصلية الاولى") == "الفيصلية الاول"
    assert R.masculine_ordinal("الفيصلية") == "الفيصلية"
    assert R.masculine_ordinal("الثانية") == "الثانية", "a bare ordinal is not a district name"


@pytest.mark.parametrize("raw,want", [
    ("الفيصلية الثانية", "حي الفيصلية الثاني"),
    ("الفيصلية الاولى", "حي الفيصلية الأول"),
    ("الفيصلية", None),
])
def test_the_row_carries_the_catalog_district(catalog, raw, want):
    ix = dict(_one(ROW_PER_METRE), district=raw)
    row, _c, why = R.map_listing(ix, {})
    assert why == "" and row is not None
    assert row["district_ar"] == want
    assert row["neighborhood"] == raw, "the card keeps the source's own words"
