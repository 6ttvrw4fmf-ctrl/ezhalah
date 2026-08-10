"""Regression: fetch_page() must request an explicit, PII-free column list — never `select=*`.

2026-08-10: `select=*` against mustqr's own `/rest/v1/properties` started returning HTTP 401 with a
Postgres 42501 ("permission denied for table properties") on 4 consecutive real runs (04:22, 12:13,
13:20, 13:31). A first narrowing attempt (select down from `*` to all 29 columns map_listing()
reads) still failed identically. Four rounds of live probing (probe_status_values,
probe_query_shape, probe_column_bisect, probe_column_singles — see their docstrings) isolated the
exact cause: mustqr restricted anon SELECT on `types`, `lat`, and `lng` specifically (`categories`,
the plural sibling of `types`, and `show_location` are NOT restricted). fetch_page()'s allowlist
excludes exactly those 3 confirmed-restricted columns; both are used only for optional
`additional_info` extras (`types_ar`, map-pin `lat`/`lng`), so dropping them just means those two
extras come back absent — same as any field mustqr doesn't publish, never a crash or fabrication.

Run: python -m pytest scrapers/common/tests/test_mustqr_fetch_page_column_allowlist.py -v
"""
import scrapers.mustqr.run as m

# Confirmed restricted upstream (2026-08-10, probe_column_singles round 4) — deliberately excluded
# from _PROPERTIES_COLUMNS, not an oversight. Update this set only alongside fresh probe evidence.
KNOWN_RESTRICTED_COLUMNS = {"types", "lat", "lng"}


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


def test_properties_columns_allowlist_covers_every_field_map_listing_reads_except_restricted():
    """Every `p.get("...")` field map_listing() consumes must be in the allowlist OR a documented
    KNOWN_RESTRICTED_COLUMNS exception, or a future field read would silently come back None
    forever (not a crash — a quiet data-loss regression) with no record of why."""
    import inspect
    import re

    src = inspect.getsource(m.map_listing)
    read_fields = set(re.findall(r'p\.get\("([a-zA-Z_]+)"\)', src))
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    missing = read_fields - cols - KNOWN_RESTRICTED_COLUMNS
    assert not missing, (
        f"map_listing reads {missing} but fetch_page's allowlist doesn't request them, and they "
        f"are not in KNOWN_RESTRICTED_COLUMNS — either add them to the allowlist or document why "
        f"they're excluded"
    )


def test_known_restricted_columns_are_actually_excluded_from_the_allowlist():
    """The 3 confirmed-restricted columns must stay out of the request — re-adding one would
    reintroduce the exact 401/42501 this allowlist exists to avoid."""
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    for col in KNOWN_RESTRICTED_COLUMNS:
        assert col not in cols, f"{col!r} is confirmed restricted upstream — must not be selected"


def test_status_and_id_present_for_the_filter_and_order_clauses():
    cols = set(m._PROPERTIES_COLUMNS.split(","))
    assert "status" in cols, "fetch_page filters on status=eq.متاح — the column must be selected"
    assert "id" in cols, "fetch_page orders on id.asc and map_listing reads p.get('id') — must be selected"
