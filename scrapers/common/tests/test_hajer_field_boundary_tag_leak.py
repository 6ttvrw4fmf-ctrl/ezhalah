"""Daily engineer fix (2026-08-05): scrapers/hajer/run.py's rem_fields() bounds a field's raw
value at the START of the next field's title-marker text (`(?=rem-single-field-title"|...)`), not
at the end of that marker's opening tag. So the captured segment for every non-last field always
ends with the next field's dangling `<strong class="` prefix — which has no closing `>` and
therefore survives _clean()'s tag-stripper (`<[^>]+>` requires a closing bracket).

Live evidence (2026-08-05): hajer_residential_listings.city_ar stored "الأحساء <strong class=\""
for all 116 active rows (last_seen_at same-day) — the leaked markup doesn't match anything in the
location catalog, so to_catalog() returns city_id=NULL for every row, and production_ready=false
fleet-wide. The whole hajer platform (116/116 active listings) was silently invisible in search
while scrape_runs kept reporting ok=true (rows_seen>0) — a defect class no existing scraper-health
detector catches, because the rows exist and are "active", just unfindable.

Run: python -m pytest scrapers/common/tests/test_hajer_field_boundary_tag_leak.py -v
"""
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

from scrapers.hajer.run import rem_fields  # noqa: E402


def _rem_html(*fields: tuple[str, str]) -> str:
    """Build a REM spec table exactly like hajerhouses.com's detail pages: consecutive
    <strong class="rem-single-field-title">LABEL</strong><span class="rem-single-field-value">
    VALUE</span> blocks, no whitespace between a value's closing </span> and the next title's
    opening <strong> — the exact adjacency that triggers the boundary leak."""
    return "".join(
        f'<strong class="rem-single-field-title">{label}</strong>'
        f'<span class="rem-single-field-value">{value}</span>'
        for label, value in fields
    )


def test_middle_field_value_does_not_leak_next_titles_opening_tag():
    # المدينة is NOT the last field — أسم الحي follows it, reproducing the live HJ* shape.
    html = _rem_html(
        ("نوع العقار", "شقة"),
        ("المدينة", "الأحساء"),
        ("أسم الحي", "حي الشهابية"),
    )
    f = rem_fields(html)
    assert f["المدينة"] == "الأحساء", (
        f"expected a clean city value, got {f['المدينة']!r} — the next field's dangling "
        f'"<strong class=\\"" prefix leaked into this field\'s value'
    )
    assert "<" not in f["المدينة"] and ">" not in f["المدينة"]
    assert f["أسم الحي"] == "حي الشهابية", "the following field must parse untouched"


def test_last_field_in_document_still_parses_clean():
    # No trailing dangling tag at all when a field IS the last one — must still work (no regression
    # on the case the existing test_hajer_rem_fields_keeps_nested_range_and_magnitude covers).
    html = _rem_html(("عمر العقار", "جديد"))
    f = rem_fields(html)
    assert f["عمر العقار"] == "جديد"


if __name__ == "__main__":
    test_middle_field_value_does_not_leak_next_titles_opening_tag()
    test_last_field_in_document_still_parses_clean()
    print("OK — hajer field-boundary tag-leak regression tests pass")
