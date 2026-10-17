"""A source-settled unknown must reach rows that are ALREADY stored (🆕 2026-10-17).

Two 10-16 fixes mapped a value to None: ramzalqasim's bathroom 0 (the form's blank) and abralosol's
office city for an ad that names another region. None is dropped by
db._unknown_must_not_overwrite_known, which is right for a failed read and wrong here, so the next
crawl left the old value standing: ramzalqasim 17943237 still stored bathrooms 0 after its 10-17
04:24 crawl, and abralosol 17994690 («أرض تجارية للبيع في مدينة الروضة بمنطقة حائل») was still
served under الهفوف after 05:55. Each test runs the shipping mapper AND the shipping guard on its row.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.common.tests.test_abralosol_price_basis import CELL_TOTAL, _index  # noqa: E402
from scrapers.common.tests.test_ramzalqasim_under_construction_is_off_plan import RQ174  # noqa: E402
from scrapers.abralosol import run as A  # noqa: E402
from scrapers.ramzalqasim.run import map_marker  # noqa: E402


def _after_guard(row: dict) -> dict:
    r = dict(row)
    db._unknown_must_not_overwrite_known(r)
    return r


def test_ramzalqasim_bathroom_zero_writes_null_over_a_stored_zero():
    row, _, _ = map_marker({**RQ174, "avalible": "available", "bathroom": 0})
    out = _after_guard(row)
    assert "bathrooms" in out and out["bathrooms"] is None


def test_ramzalqasim_missing_bathroom_key_keeps_the_stored_value():
    rec = {k: v for k, v in RQ174.items() if k != "bathroom"}
    row, _, _ = map_marker({**rec, "avalible": "available"})
    assert "bathrooms" not in _after_guard(row)
    row, _, _ = map_marker({**RQ174, "avalible": "available", "bathroom": 3})
    assert _after_guard(row)["bathrooms"] == 3


def test_abralosol_other_region_ad_writes_null_city_over_hofuf():
    title = "أرض تجارية للبيع في مدينة الروضة بمنطقة حائل"
    mapped = A.map_listing(_index("17994690", CELL_TOTAL, title, district="مدينة الروضة – حائل"),
                           {"title": title, "description": title})
    out = _after_guard(mapped[0])
    assert "city" in out and out["city"] is None and out["region"] is None


def test_abralosol_ahsa_ad_keeps_the_office_city():
    mapped = A.map_listing(_index("9001", CELL_TOTAL, "أرض للبيع"), {})
    assert _after_guard(mapped[0])["city"] in (A.OFFICE_CITY, A.MUBARRAZ_CITY)


def test_sanadak_emirate_label_names_the_city_after_the_dash():
    # 6696714 / 12586935: «امارة منطقة الرياض - الدرعيه» resolved to nothing → no city, unsearchable.
    from scrapers.sanadak.run import _emirate_city
    assert _emirate_city("امارة منطقة الرياض - الدرعيه") == "الدرعيه"
    assert _emirate_city("إمارة منطقة مكة المكرمة - جدة") == "جدة"
    # A village name stays as published (honest unknown), and a «city - district» label is untouched.
    assert _emirate_city("قريه ديراب") == "قريه ديراب"
    assert _emirate_city("المدينة - العزيزية") == "المدينة - العزيزية"
