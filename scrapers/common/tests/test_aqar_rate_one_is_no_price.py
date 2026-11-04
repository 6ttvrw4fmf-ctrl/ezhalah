"""Owner decision #4 (2026-11-04): an aqar ad with no price and only «سعر المتر 1 ريال» shows NO price —
never rate × area.

Measured that day: 109 active aqar sale ads with no total and «سعر المتر 1» were served a derived price of
1 × area (search_listings_ar.price_total_effective / derivedTotalFromPerMeter), and 16 more stored aqar's own
1 × area headline as the price (ad 6738236: «21,721 § ريال / سنوي» for 21,721 m² beside «سعر المتر 1 §»).
The parser now writes the placeholder rate 1 as an authoritative NULL (so nothing can multiply it) and a
headline equal to 1 × area as no price, stamped authoritative_absent so trg_aqar_parse never re-reads it
from prose. Fails on the old parser (price_per_meter 1 stored; price 21,721 stored)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqar import enrich_residential as ER  # noqa: E402
from scrapers.common.db import _unknown_must_not_overwrite_known  # noqa: E402


def _sent(row: dict, col: str):
    r = dict(row)
    _unknown_must_not_overwrite_known(r)
    return r[col] if col in r else "_DROPPED"


def _page(listing: dict, prose: str) -> str:
    body = json.dumps({"listing": listing}, ensure_ascii=False)
    escaped = body.replace("\\", "\\\\").replace('"', '\\"')
    return f'<script>self.__next_f.push([1,"{escaped}"])</script><div>{prose}</div>'


def _parse(html: str, *, deal: str, ptype: str):
    class _R:
        text = html
    orig = ER.get
    ER.get = lambda url, **kw: _R()  # noqa: ARG005
    try:
        return ER.enrich_residential(f"https://sa.aqar.fm/{ptype}/ابها/حي-العقيق/حي-6738236",
                                     type_slug="أراضي", deal_slug=deal)
    finally:
        ER.get = orig


def test_placeholder_detection_is_exactly_one():
    assert ER.ppm_is_placeholder("المساحة 450 م² سعر المتر 1 § ريال")
    assert not ER.ppm_is_placeholder("سعر المتر 1,093.74 §")
    assert not ER.ppm_is_placeholder("سعر المتر 1.25 §")
    assert not ER.ppm_is_placeholder("سعر المتر 12 §")
    assert not ER.ppm_is_placeholder("متوسط سعر المتر 1 §")
    assert not ER.ppm_is_placeholder("لا يوجد")


def test_rent_headline_equal_to_area_is_no_price():
    prose = ("أرض للإيجار 21,721 § ريال / سنوي تفاصيل الإعلان الواجهة شرق "
             "المساحة 21,721 م² سعر المتر 1 § ريال بيانات الإعلان")
    row = _parse(_page({"id": 6738236, "price": 21721, "published": True, "rent_period": 3}, prose),
                 deal="rent", ptype="أراضي-للإيجار")
    assert row["area_m2"] == 21721
    assert _sent(row, "price_annual") is None          # written NULL, not dropped, not 21,721
    assert _sent(row, "price_per_meter") is None       # the placeholder 1 is cleared too
    ev = row["price_evidence"]
    assert ev["authoritative_absent"] is True and ev["stored"] is None


def test_sale_with_no_price_keeps_no_rate_to_multiply():
    prose = "أرض للبيع تفاصيل الإعلان المساحة 900 م² سعر المتر 1 § ريال بيانات الإعلان"
    row = _parse(_page({"id": 6738237, "published": True, "price": None}, prose),
                 deal="sale", ptype="أراضي-للبيع")
    assert _sent(row, "price_per_meter") is None       # index derives 1 × area from a stored 1
    assert _sent(row, "price_total") is None


def test_real_price_beside_placeholder_rate_is_kept():
    prose = ("أرض للبيع 1,500,000 § تفاصيل الإعلان المساحة 900 م² سعر المتر 1 § ريال بيانات الإعلان")
    row = _parse(_page({"id": 6738238, "price": 1500000, "published": True}, prose),
                 deal="sale", ptype="أراضي-للبيع")
    assert row["price_total"] == 1500000
    assert _sent(row, "price_per_meter") is None
    assert row["price_evidence"]["authoritative_absent"] is False


def test_real_rate_is_untouched():
    prose = "أرض للبيع تفاصيل الإعلان المساحة 900 م² سعر المتر 1,200 § ريال بيانات الإعلان"
    row = _parse(_page({"id": 6738239, "published": True, "price": None}, prose),
                 deal="sale", ptype="أراضي-للبيع")
    assert row["price_per_meter"] == 1200
