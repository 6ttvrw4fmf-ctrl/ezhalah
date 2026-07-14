"""Regression test for dealapp's skeleton-response retry (2026-07-14).

Guards a false-negative bug found during the price-fidelity repair: dealapp's Angular SPA
intermittently serves a SKELETON response — the "real-estate-listing" schema KEY is present (so
the old `"real-estate-listing" in r.text` success check passed) but `offers.price` is empty, an
apparent server-render caught before full hydration. fetch_one used to accept that response as
final, producing a false "no price" for a listing that genuinely has one. Proven live: retrying
recovered a real price for 28 of 37 listings previously believed unfetchable/removed.

Run: python -m pytest scrapers/common/tests/test_dealapp_skeleton_retry.py -v
"""
from scrapers.dealapp.run import has_priced_schema

# Real ng-state shape (trimmed) dealapp embeds on every ad-details page.
_SKELETON_HTML = """
<html><body>
<script id="ng-state" type="application/json">
{"schemaMarkupScripts":{"real-estate-listing-schema-537682":"{\\"@type\\":\\"RealEstateListing\\",\\"offers\\":{\\"@type\\":\\"Offer\\",\\"priceCurrency\\":\\"SAR\\"}}"}}
</script>
</body></html>
"""

_PRICED_HTML = """
<html><body>
<script id="ng-state" type="application/json">
{"schemaMarkupScripts":{"real-estate-listing-schema-537682":"{\\"@type\\":\\"RealEstateListing\\",\\"offers\\":{\\"@type\\":\\"Offer\\",\\"price\\":\\"949822.5\\",\\"priceCurrency\\":\\"SAR\\"}}"}}
</script>
</body></html>
"""

_NO_STATE_HTML = "<html><body>Page Not Found</body></html>"


def test_skeleton_response_has_no_priced_schema():
    # The "real-estate-listing" marker is present, but offers.price is absent -> must be treated
    # as a skeleton, not a successful fetch.
    assert "real-estate-listing" in _SKELETON_HTML
    assert has_priced_schema(_SKELETON_HTML) is False


def test_fully_rendered_response_has_priced_schema():
    assert has_priced_schema(_PRICED_HTML) is True


def test_missing_ng_state_has_no_priced_schema():
    assert has_priced_schema(_NO_STATE_HTML) is False


if __name__ == "__main__":
    test_skeleton_response_has_no_priced_schema()
    test_fully_rendered_response_has_priced_schema()
    test_missing_ng_state_has_no_priced_schema()
    print("OK — dealapp skeleton-retry regression tests pass")
