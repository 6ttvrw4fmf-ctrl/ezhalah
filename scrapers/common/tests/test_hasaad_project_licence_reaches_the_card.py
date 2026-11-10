"""«رخصة المعلن : 7200345489» is printed once on a hasaad project page (مسكني 8); card parity 2026-11-09 found it on
the page and on 0 cards. Every unit row carries it under the key the card reads (additional_info.rega_ad_license_number);
a FAL licence (1xxxxxxxxx) never does. Reuses the real captured page of the compound-units test."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.tests.test_hasaad_compound_units_ranges_and_gates import PAGE_8404, URL_8404, R  # noqa: E402

KEY = "rega_ad_license_number"


def _with(line: str) -> str:
    return PAGE_8404.replace('<div class="title_single">', f"<p>{line}</p><div class=\"title_single\">", 1)


def test_the_project_pages_rega_ad_licence_reaches_every_units_card_key():
    page = _with("رخصة المعلن : 7200345489")
    assert R.parse_project(page)["licence"] == "7200345489"
    rows, _ = R.map_units(URL_8404, R.parse_project(page))
    assert rows and all(r["additional_info"][KEY] == "7200345489" for r in rows)


def test_a_fal_licence_or_no_licence_leaves_the_card_silent():
    assert R.parse_project(_with("رخصة المعلن : 1200039840"))["licence"] is None
    rows, _ = R.map_units(URL_8404, R.parse_project(PAGE_8404))
    assert rows and all(KEY not in r["additional_info"] for r in rows)
