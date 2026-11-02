"""aljassim writes «الضاحية الحي الثالث» (4 ads) where loc_catalog_district (الهفوف) says «الضاحية الثالث»:
unknown_named_districts_checked reads it as a TWIN (2026-10-25), so it is a spelling, mapped in the scraper and
never added (contract G, the twin guard). «الضاحية الحي الثامن» has no catalog row and stays NULL (#319).
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

HOFUF = {"الضاحية الثالث": "الضاحية الثالث", "الضاحية الأول": "الضاحية الأول"}


@pytest.fixture()
def catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda *a, **k: (12, 5))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, _cid: HOFUF.get((text or "").strip()))


def test_fold():
    assert R.dahiya_without_hayy("الضاحية الحي الثالث") == "الضاحية الثالث"
    assert R.dahiya_without_hayy("حي الضاحية الحي الثالث") == "الضاحية الثالث"
    assert R.dahiya_without_hayy("الضاحية الثالث") == "الضاحية الثالث"
    assert R.dahiya_without_hayy("الحي الثالث") == "الحي الثالث", "no «الضاحية», nothing to fold"


@pytest.mark.parametrize("raw,want", [
    ("الضاحية الحي الثالث", "الضاحية الثالث"),
    ("الضاحية الحي الثالثة", "الضاحية الثالث"),
    ("الضاحية الحي الثامن", None),
])
def test_the_row_carries_the_catalog_district(catalog, raw, want):
    ix = dict(_one(ROW_PER_METRE), district=raw)
    row, _c, why = R.map_listing(ix, {})
    assert why == "" and row is not None
    assert row.get("district_ar") == want
    assert row["neighborhood"] == raw, "the card keeps the source's own words"
