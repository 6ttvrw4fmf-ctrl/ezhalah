"""The re-read's log block must carry what we serve and what the page says, and survive a missing page
(the engineer reads the job log because the artifact's blob host is unreachable from its container)."""
from scrapers.common.source_reread import compact


def test_compact_carries_ours_and_the_page():
    out = compact({"table": "aqar_residential_listings", "id": 7, "url": "https://x/7", "status": 200,
                   "verdict": "ALIVE", "stored": {"price_total": 530000, "bathrooms": None},
                   "page": {"title": "شقة", "evidence_lines": ["530,000 ريال", "98 م²"], "jsonld": []}})
    assert "aqar_residential_listings:7" in out and "status=200" in out
    assert '"price_total": 530000' in out and "bathrooms" not in out  # unknown is not printed as a value
    assert "530,000 ريال ¦ 98 م²" in out


def test_compact_without_a_page():
    out = compact({"table": "t", "id": 1, "url": None, "stored": {}})
    assert out.startswith("=== t:1 status=None")
