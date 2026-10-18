"""amlakalahsa: when the headline price and the per-metre field carry the same figure, the headline IS the rate.

Rendered 2026-10-18: AMH19284 (/land/للبيع-ارض-في-حي-الغسانية-2-2/) prints «المساحة 663 م · السعر 1,650 سعر المتر» —
the price box labels its own figure per metre — and the REST record carries pw-prc 1650 and pw-prc-mtr 1650. It was
stored as a 1,650 total for 663 m² (likewise AMH19455 1,700 and AMH17111 1,700). The stored total clears
(AUTHORITATIVE_NULL — the page settled it) and the rate stays. Different figures keep both, as before.
"""
from __future__ import annotations

import pytest

import scrapers.amlakalahsa.run as A
import scrapers.common.db as db


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(A, "to_catalog", lambda city_ar, region_hint=None: (2748, 5))


def _post(prc, mtr, squ="663"):
    return {"id": 19284, "link": "https://amlakalahsa.com/land/x/", "title": {"rendered": "للبيع ارض في حي الغسانية 2"},
            "content": {"rendered": ""},
            "acf": {"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-squ": squ, "pw-prc": prc, "pw-prc-mtr": mtr,
                    "pw-dis": "الغسانية 2", "pw-map": {"city": "المبرز", "state": "المنطقة الشرقية"}}}


def test_equal_headline_and_rate_is_a_rate_not_a_total():
    row, _cat = A.map_listing(_post("1650", "1650"), {})
    assert row is not None
    assert row["price_total"] is db.AUTHORITATIVE_NULL and row["price_per_meter"] == 1650


def test_different_figures_keep_the_total_and_the_rate():
    row, _cat = A.map_listing(_post("850000", "1000", squ="850"), {})
    assert row["price_total"] == 850000 and row["price_per_meter"] == 1000
    row, _cat = A.map_listing(_post("850000", ""), {})
    assert row["price_total"] == 850000 and row["price_per_meter"] is None
