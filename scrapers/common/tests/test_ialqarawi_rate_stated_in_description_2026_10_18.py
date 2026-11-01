"""ialqarawi: a price cell's figure is a RATE when the ad's own description states it per metre (2026-10-18).

Rendered that day: QRW2823 (/index.php?router=card&id=2823) prints «سعر الحد 900» on a 400 m² plot and, in its own
«تفاصيل العقار», «تفتح على شارع عرض 15م جنوبأ بطول 15م سعر المتر 900 ريال». It was stored as a 900 total. Owner rule:
a rate needs the ad's own per-metre marker tied to that figure — QRW1792 «سعر السوم 140» and QRW2210 «سعر السوم 330»
carry none, so they stay totals (PRICE = SOURCE).
"""
from __future__ import annotations

import pytest

import scrapers.common.db as db
from scrapers.common.tests.test_ialqarawi_source_traps import card, page
from scrapers.ialqarawi import run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: (21, 4) if str(name).strip() == "عنيزة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(R, "known_district_keys", lambda city_id: frozenset())


def _row(details, som="لا يوجد", limit="لا يوجد", area="400م"):
    c = card(lid="2823", title="للبيع أرض سكنية بحي الوفاء بعنيزة")
    row, _cat, why = R.map_listing(c, R.parse_detail(page(number="2823", title=c["title"], district="الوفاء",
                                                          details=details, land_area=area, som=som, limit=limit)))
    assert row is not None, why
    return row


def test_the_descriptions_own_per_metre_figure_makes_the_cell_a_rate():
    row = _row("تفتح على شارع عرض 15م جنوبأ بطول 15م سعر المتر 900 ريال", limit="900")
    assert row["price_per_meter"] == 900
    assert row["price_total"] is db.AUTHORITATIVE_NULL


@pytest.mark.parametrize("details, som", [
    ("تفتح على ميدان غربي وممر شمالي عرض 5 متر", "140"),            # QRW1792: no marker anywhere
    ("تفتح على شارع عرض 20م شمالا بطول 20.5م", "330"),             # QRW2210
    ("سعر المتر 900 ريال", "1400"),                                  # a rate about ANOTHER figure
])
def test_no_marker_on_that_figure_keeps_the_total(details, som):
    row = _row(details, som=som)
    assert row["price_total"] == int(som) and row.get("price_per_meter") is None
