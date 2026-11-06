"""A facade published only in JSON-LD is compared as the label's OWN value (🔬 2026-11-06).

aqarcity 31207 (17802282) was re-read through net.http_get on 2026-11-06. Its additionalProperty includes
{"name": "الواجهة", "value": "جنوبية شرقية"} and we store «جنوب شرق». The 11-06 score counted this as a MISMATCH,
because the adjective rescue only searched page lines, and JSON-LD never reaches them.
"""
import json
import sys

sys.path.insert(0, ".")

from scrapers.common.new_listings_score import compare_listing  # noqa: E402
from scrapers.common.source_reread import page_evidence  # noqa: E402


def _v(stored, props):
    ld = {"@context": "https://schema.org", "@type": "Apartment",
          "additionalProperty": [{"@type": "PropertyValue", "name": k, "value": v} for k, v in props]}
    page = page_evidence('<html><head><script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False)
                         + "</script></head><body></body></html>")
    return compare_listing({"direction_ar": stored}, page, skip_price=True)["direction_ar"]


def test_the_same_facade_as_adjectives_matches():
    assert _v("جنوب شرق", [("الواجهة", "جنوبية شرقية"), ("عمر العقار", "جديد")]) == "match"


def test_a_different_facade_is_still_a_mismatch():
    assert _v("شمال", [("الواجهة", "جنوبية شرقية")]) == "mismatch"


def test_a_bearing_in_another_property_is_not_the_facade():
    assert _v("جنوب شرق", [("الواجهة", "شمالية"), ("نوع", "جنوبية شرقية")]) == "mismatch"
