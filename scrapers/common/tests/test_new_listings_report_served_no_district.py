"""«Searchable arrivals with no district» is a COMPUTED number in the nightly report (🆕 2026-11-12, backlog 1796).

On 11-11 the number was hand-counted (36). It is now counted by new_listings_report._bucket over the same rows as
every other report figure: served (production_ready) AND district_ar NULL. An unserved row with no district is not
counted (it is a searchability problem, not a district one), and a served row with a district is not counted.
"""
import pytest

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


@pytest.mark.parametrize("row,expected", [
    pytest.param({"production_ready": True, "district_ar": None}, 1, id="served-null"),
    pytest.param({"production_ready": False, "district_ar": None}, 0, id="unserved-null"),
    pytest.param({"production_ready": None, "district_ar": None}, 0, id="unknown-readiness"),
    pytest.param({"district_ar": None}, 0, id="missing-readiness"),
    pytest.param({"production_ready": True, "district_ar": "حي النرجس"}, 0, id="served-district"),
    pytest.param({"production_ready": False, "district_ar": "حي النرجس"}, 0, id="unserved-district"),
    pytest.param({"production_ready": True, "district_ar": ""}, 0, id="empty-is-not-null"),
    pytest.param({"production_ready": True, "district_ar": " "}, 0, id="whitespace-is-not-null"),
    pytest.param({"production_ready": True}, 1, id="missing-district"),
    pytest.param({}, 0, id="missing-both"),
])
def test_served_no_district_null_and_readiness_boundaries(row, expected):
    assert _bucket([row])["served_no_district"] == expected


def test_empty_bucket_has_zero_arrivals_without_a_district():
    assert _bucket([])["served_no_district"] == 0


def test_count_is_absolute_and_does_not_require_other_location_fields():
    rows = [
        {"production_ready": True, "district_ar": None, "city_id": None, "region_ar": None},
        {"production_ready": True, "district_ar": None, "city_id": 2},
        {"production_ready": True, "district_ar": "حي النرجس"},
    ]
    bucket = _bucket(rows)
    assert bucket["served_no_district"] == 2
    assert bucket["district_pct"] == 33.3
    assert bucket["searchable_pct"] == 100.0


def _report(rows, *, backlog=97):
    sites = {}
    for row in rows:
        sites.setdefault(row["platform"], []).append(row)
    return {
        "hours": 24, "now": "2026-11-12T00:00:00+00:00", "errors": [],
        "sites": {site: _bucket(site_rows) for site, site_rows in sites.items()},
        "totals": _bucket(rows), "no_district_backlog": backlog, "open_items": [],
    }


def test_render_places_distinct_site_counts_in_the_matching_column():
    rows = [
        {"platform": "aqar", "production_ready": True, "district_ar": None, "deal_ar": "بيع"},
        {"platform": "aqar", "production_ready": True, "district_ar": None, "deal_ar": "بيع"},
        {"platform": "haraj", "production_ready": True, "district_ar": None, "deal_ar": "بيع"},
        {"platform": "haraj", "production_ready": False, "district_ar": None, "deal_ar": "بيع"},
        {"platform": "abaad", "production_ready": True, "district_ar": "حي النرجس", "deal_ar": "بيع"},
    ]
    out = render(_report(rows))
    assert "searchable arrivals with no district 3" in out
    assert "**No-district backlog (production_ready, NULL district):** 97" in out

    table = [
        [cell.strip() for cell in line.strip("|").split("|")]
        for line in out.splitlines() if line.startswith("|")
    ]
    header, separator, *site_rows = table
    assert header == [
        "website", "new", "searchable", "region", "city", "district",
        "served, no district", "deal split",
    ]
    assert separator == ["---"] * len(header)
    assert all(len(row) == len(header) for row in site_rows)
    by_site = {row[0]: dict(zip(header, row)) for row in site_rows}
    assert {site: row["served, no district"] for site, row in by_site.items()} == {
        "aqar": "2", "haraj": "1", "abaad": "0",
    }
    assert by_site["aqar"]["deal split"] == "buy:2"
    assert by_site["haraj"]["district"] == "0.0%"
    assert by_site["abaad"]["district"] == "100.0%"


@pytest.mark.parametrize("rows", [[], [ROWS[1]], [ROWS[2]]], ids=["empty", "district-present", "unserved"])
def test_render_reports_zero_when_no_arrivals_qualify(rows):
    out = render(_report(rows))
    assert "searchable arrivals with no district 0" in out
    assert "**No-district backlog (production_ready, NULL district):** 97" in out


def test_unreadable_arrivals_do_not_render_a_fabricated_zero_count():
    rep = _report([])
    rep.update(totals=None, errors=["search_listings_ar: unavailable"])
    out = render(rep)
    assert "new in the window: ?" in out
    assert "searchable arrivals with no district 0" not in out
    assert "| served, no district |" in out


def test_unreadable_backlog_does_not_hide_known_arrival_count():
    rep = _report(ROWS, backlog=None)
    rep["errors"] = ["no-district backlog: unavailable"]
    out = render(rep)
    assert "searchable arrivals with no district 2" in out
    assert "**No-district backlog (production_ready, NULL district):** ?" in out
