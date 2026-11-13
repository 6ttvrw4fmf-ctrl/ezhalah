"""«Searchable arrivals with no district» is a COMPUTED number in the nightly report (🆕 2026-11-12, backlog 1796).

On 11-11 the number was hand-counted (36). It is now counted by new_listings_report._bucket over the same rows as
every other report figure: served (production_ready) AND district_ar NULL. An unserved row with no district is not
counted (it is a searchability problem, not a district one), and a served row with a district is not counted.
"""
from scrapers.common.new_listings_report import _bucket, render

ROWS = [
    {"platform": "aqar", "production_ready": True, "district_ar": None, "city_id": 1, "region_ar": "x", "deal_ar": "بيع"},
    {"platform": "aqar", "production_ready": True, "district_ar": "حي النرجس", "city_id": 1, "region_ar": "x", "deal_ar": "بيع"},
    {"platform": "aqar", "production_ready": False, "district_ar": None, "city_id": None, "region_ar": None, "deal_ar": "بيع"},
    {"platform": "haraj", "production_ready": True, "district_ar": None, "city_id": 2, "region_ar": "y", "deal_ar": "إيجار"},
]


def test_counts_only_served_rows_without_district():
    assert _bucket(ROWS)["served_no_district"] == 2
    assert _bucket(ROWS[:3])["served_no_district"] == 1
    assert _bucket([ROWS[1]])["served_no_district"] == 0


def test_the_number_is_printed_in_total_and_per_site():
    sites = {"aqar": _bucket(ROWS[:3]), "haraj": _bucket(ROWS[3:])}
    rep = {"hours": 24, "now": "t", "errors": [], "sites": sites, "totals": _bucket(ROWS),
           "no_district_backlog": 7, "open_items": []}
    out = render(rep)
    assert "searchable arrivals with no district 2" in out
    assert "| aqar | 3 |" in out and "| 1 | buy:3 |" in out
    assert "| haraj | 1 |" in out and "| 1 | " in out
