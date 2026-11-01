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


def _post(prc, mtr, squ="663", typ=None):
    return {"id": 19284, "link": "https://amlakalahsa.com/land/x/", "title": {"rendered": "للبيع ارض في حي الغسانية 2"},
            "content": {"rendered": ""},
            "acf": {"pw-typ": "ارض", "pw-cnt": "للبيع", "pw-squ": squ, "pw-prc": prc, "pw-prc-mtr": mtr,
                    "pw-dis": "الغسانية 2", "pw-map": {"city": "المبرز", "state": "المنطقة الشرقية"},
                    **({"pw-prc-typ": typ} if typ else {})}}


def test_equal_headline_and_rate_is_a_rate_not_a_total():
    row, _cat = A.map_listing(_post("1650", "1650"), {})
    assert row is not None
    assert row["price_total"] is db.AUTHORITATIVE_NULL and row["price_per_meter"] == 1650


def test_different_figures_keep_the_total_and_the_rate():
    row, _cat = A.map_listing(_post("850000", "1000", squ="850"), {})
    assert row["price_total"] == 850000 and row["price_per_meter"] == 1000
    row, _cat = A.map_listing(_post("850000", ""), {})
    assert row["price_total"] == 850000 and row["price_per_meter"] is None


# The price box's own label, pw-prc-typ, read from /wp-json/wp/v2/land on 2026-10-18 for each ad below.
@pytest.mark.parametrize("ad, prc, mtr, typ, total, rate", [
    ("AMH18982", 1500, "", "سعر المتر", "NULL", 1500),       # «السعر 1,500 سعر المتر», pw-prc-mtr empty
    ("AMH18592", 1450, 1500, "سعر المتر", "NULL", 1450),     # the headline's own rate; the box prints 1,450
    ("AMH19198", 1600, "", "سوم", 1600, None),               # «السعر 1,600 سوم» — an offer, a total (PRICE = SOURCE)
    ("AMH20045", 499, "", "السعر", 499, None),               # «السعر 499» — a total as printed
    ("AMH19549", -1, "", "على السوم", "NULL", None),         # -1 beside «على السوم» — no price, never «1 ر.س»
    ("AMH-0", 0, "", "على السوم", "NULL", None),             # the 0 form of the same statement
])
def test_the_price_boxs_own_label_decides_rate_total_or_none(ad, prc, mtr, typ, total, rate):
    row, _cat = A.map_listing(_post(prc, mtr, squ="741", typ=typ), {})
    assert (row["price_total"] is db.AUTHORITATIVE_NULL) if total == "NULL" else row["price_total"] == total, ad
    assert row["price_per_meter"] == rate, ad
    assert row["additional_info"]["price_type"] == typ
