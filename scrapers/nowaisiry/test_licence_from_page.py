"""🔧 2026-11-09 (card_parity_card_missing:nowaisiry:licence): the REGA ad licence is printed only in the page's offer
table («رقم الترخيص» → 7100312611); the REST post the scraper reads carries it nowhere, so no card showed a licence."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.nowaisiry import run  # noqa: E402

# verbatim from the live page of the post whose card parity sampled 7100312611 (2026-11-09)
PAGE = ('<div><h3 id="brxe-xofxzc" class="brxe-heading offer-table-item-title">رقم الترخيص</h3>'
        '<h3 id="brxe-srlqzh" class="brxe-heading offer-table-item-description">7100312611</h3></div>')


def test_the_page_licence_is_read():
    assert run.licence_from_page(PAGE) == "7100312611"


def test_nothing_is_invented():
    assert run.licence_from_page(None) is None
    assert run.licence_from_page("") is None
    assert run.licence_from_page(PAGE.replace("7100312611", "1100029634")) is None      # not a REGA ad licence
    assert run.licence_from_page(PAGE.replace("رقم الترخيص", "رقم القطعة")) is None      # another row's number
    two = PAGE + PAGE.replace("7100312611", "7200000001")
    assert run.licence_from_page(two) is None                                            # two licences: say nothing


def test_map_listing_puts_it_on_the_card_key():
    post = {"id": 1, "status": "publish", "link": "https://alnowaisiry.com/lands/x/",
            "title": {"rendered": "للبيع ارض زراعية في الرياض"}, "content": {"rendered": "ارض زراعية مساحة 1000م"}}
    row, _ = run.map_listing(post, PAGE)
    assert row["additional_info"]["rega_ad_license_number"] == "7100312611"
    row, _ = run.map_listing(post, None)                                                 # page unread → unknown
    assert "rega_ad_license_number" not in row["additional_info"]


if __name__ == "__main__":   # CI runs per-scraper barriers as scripts
    test_the_page_licence_is_read()
    test_nothing_is_invented()
    test_map_listing_puts_it_on_the_card_key()
    print("✓ nowaisiry: the page's own ad licence reaches the card key")
