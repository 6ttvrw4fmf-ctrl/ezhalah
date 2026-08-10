"""Regression: fetch_page() must request an explicit, PII-free column list — never `select=*`.

2026-08-10: `select=*` against mustqr's own `/rest/v1/properties` started returning HTTP 401 with a
Postgres 42501 ("permission denied for table properties") on 4 consecutive real runs (04:22, 12:13,
13:20, 13:31), while an UNFILTERED `probe_status_values()` request using only `select=status`
succeeded the same day and found 1,000+ 'متاح' rows on the same endpoint with the same JWT. The
module docstring already documents that `properties` carries `owner_phone`/`broker`/`raw_text` PII
columns this scraper has always dropped/redacted — the evidence-consistent explanation is mustqr
locked down anon SELECT on those PII columns, and `select=*` started trying (and failing) to
project them. fetch_page() was switched to an explicit allowlist of only the columns map_listing()
actually reads, so it can never regress into re-requesting a column this scraper doesn't use.

Run: python -m pytest scrapers/common/tests/test_mustqr_fetch_page_column_allowlist.py -v
"""
import scrapers.mustqr.run as m


def test_fetch_page_never_requests_select_star():
    assert "select=*" not in m.fetch_page.__doc__ or True  # docstring isn't the guard; source is
    import inspect
    src = inspect.getsource(m.fetch_page)
    assert "select=*" not in src, (
        "fetch_page must not fall back to select=* — that is the exact request shape that started "
        "returning 401/42501 permission-denied from mustqr's own Supabase project on 2026-08-10"
    )
    assert "_PROPERTIES_COLUMNS" in src, "fetch_page must build its URL from the explicit allowlist"


def test_properties_columns_allowlist_excludes_pii():
    """The allowlist must never re-introduce the PII columns this scraper has always dropped."""
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    for pii in ("owner_phone", "broker", "raw_text"):
        assert pii not in cols, f"{pii!r} is PII (see module docstring) and must never be fetched"


def test_properties_columns_allowlist_covers_every_field_map_listing_reads():
    """Every `p.get("...")` field map_listing() consumes must be in the allowlist, or a future field
    read would silently come back None forever (not a crash — a quiet data-loss regression)."""
    import inspect
    import re

    src = inspect.getsource(m.map_listing)
    read_fields = set(re.findall(r'p\.get\("([a-zA-Z_]+)"\)', src))
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    missing = read_fields - cols
    assert not missing, f"map_listing reads {missing} but fetch_page's allowlist doesn't request them"


def test_status_and_id_present_for_the_filter_and_order_clauses():
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    assert "status" in cols, "fetch_page filters on status=eq.متاح — the column must be selected"
    assert "id" in cols, "fetch_page orders on id.asc and map_listing reads p.get('id') — must be selected"
