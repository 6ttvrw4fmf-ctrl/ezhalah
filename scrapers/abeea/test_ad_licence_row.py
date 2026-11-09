"""🔧 2026-11-09 (card_parity_card_missing:abeea:licence): abeea prints the REGA ad licence as its own label/value
row («Advertisement License» → 7201121827 on ABRE279) and the scraper never read it, so the card showed no
licence. The row is now read into additional_info.rega_ad_license_number, the key the card reads."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.abeea import run  # noqa: E402

ITEMS = ('<ul class="detail-wrap">'
         '<li><strong>Property ID</strong> <span>ABRE279</span></li>'
         '<li class="advertisement-license"><div><strong>Advertisement License</strong> \n <span>7201121827</span></div></li>'
         '</ul>')


def test_the_licence_row_is_parsed():
    assert run._detail_items(ITEMS)["Advertisement License"] == "7201121827"
    assert run._ad_licence("7201121827") == "7201121827"


def test_only_the_rega_ad_licence_shape_counts():
    for junk in (None, "", "1100029634", "720112182", "ABRE279", "—"):
        assert run._ad_licence(junk) is None, junk


def test_map_listing_carries_the_licence_to_the_card_key():
    # the real ABRE279 detail list, trimmed to the cells map_listing reads
    body = ('<ul class="detail-wrap">'
            '<li><strong>Property ID</strong> <span>ABRE279</span></li>'
            '<li><strong>Price</strong> <span>\u20c1 1,061,160</span></li>'
            '<li><strong>Land Area</strong> <span>530.58 m²</span></li>'
            '<li><strong>Property Type</strong> <span>Land, Residential</span></li>'
            '<li><strong>Property Status</strong> <span>For Sale</span></li>'
            '<li class="advertisement-license"><div><strong>Advertisement License</strong> <span>7201121827</span></div></li>'
            '</ul>')
    row, _cat, gone = run.map_listing(body, "https://abeea.com.sa/en/property/residential-land-for-sale-in-tharwah-2-2/")
    assert row is not None and gone is False
    assert row["additional_info"]["rega_ad_license_number"] == "7201121827"


if __name__ == "__main__":   # CI runs per-scraper barriers as scripts
    test_the_licence_row_is_parsed()
    test_only_the_rega_ad_licence_shape_counts()
    test_map_listing_carries_the_licence_to_the_card_key()
    print("✓ abeea: the page's own ad licence reaches the card key")
