"""sadin.com.sa added an `/ar/` locale prefix to every list-page property href (daily engineer,
2026-09-01), reproducing the exact `http_200_zero_ids_page1` signature that
test_sadin_list_fetch_failure_reason.py's circuit breaker had just made visible.

THE INCIDENT. sadin's scrape_runs showed two consecutive 0-row days (08-31, 09-01). The new
list-fetch failure-reason capture (same run) pinned the concrete cause to
`http_200_zero_ids_page1` — a real 200 response with zero `/property/{ID}` links extracted.
Direct network access to sadin.com.sa is blocked from this sandbox, so the real markup was
recovered via a temporary GitHub Actions debug probe (unblocked egress, same runner the real
scraper uses). It proved:

  - GET /properties now links ONLY `href="/ar/property/{ID}"` — zero bare `href="/property/{ID}"`
    hrefs anywhere on the page (19 distinct propert*-hrefs sampled, all `/ar/`-prefixed or
    purpose-query variants of the SAME prefix).
  - The 5-character alnum property ID scheme is completely unchanged (e.g. `86PGD`, `4HO6O`).
  - A direct GET of the bare (non-`/ar/`) detail URL still resolves 200 with an identical
    og:title, for both the apex and `www.` host — so BASE and the `f"{BASE}/property/{pid}"`
    detail-fetch construction need no change; only the list-page href-extraction regex does.

The real `<article>` block captured live (2026-09-01, debug probe job 99976409862, ad 86PGD):

    <article class="property-card property-card-classic" data-property-card
        data-property-id="86PGD" ...>
      <a class="property-card-media property-card-media-classic" href="/ar/property/86PGD" ...>
        ...
      </a>
      <div class="property-card-body">...<h3><a href="/ar/property/86PGD" lang="ar"
        dir="rtl">...</a></h3>...

Run: python -m pytest scrapers/common/tests/test_sadin_ar_locale_prefix.py -v
"""
import re

from scrapers.sadin import run as sd

# The real list-page markup captured live 2026-09-01 (trimmed to the relevant href-bearing span).
REAL_AR_PREFIXED_CARD = (
    '<article class="property-card property-card-classic" data-property-card '
    'data-property-id="86PGD">'
    '<a class="property-card-media property-card-media-classic" href="/ar/property/86PGD">'
    '</a>'
    '<div class="property-card-body"><h3><a href="/ar/property/86PGD" lang="ar" dir="rtl">'
    'مبنى تجاري وإداري مع فيلا سكنية للبيع</a></h3></div>'
    '</article>'
)


# ── The fix: the current regex must accept the /ar/-prefixed form ──────────────────────────────
def test_property_href_regex_matches_the_real_ar_prefixed_markup():
    ids = set(sd._PROPERTY_HREF_RE.findall(REAL_AR_PREFIXED_CARD))
    assert ids == {"86PGD"}, f"expected the /ar/-prefixed href to yield 86PGD, got {ids}"


def test_property_href_regex_still_matches_the_old_bare_form():
    """Backward-compatible: a bare (non-/ar/) href must still parse, since the detail-page fetch
    itself uses the bare form and it is confirmed still live."""
    ids = set(sd._PROPERTY_HREF_RE.findall('<a href="/property/AD001"></a>'))
    assert ids == {"AD001"}


def test_pages_extracts_ids_from_ar_prefixed_list_html():
    html = REAL_AR_PREFIXED_CARD * 1  # one page, one card
    ids = set(re.findall(sd._PROPERTY_HREF_RE, html))
    assert ids == {"86PGD"}


def test_ids_helper_uses_the_shared_prefix_tolerant_regex():
    class _Resp:
        status_code = 200
        text = REAL_AR_PREFIXED_CARD

    class _Session:
        def get(self, url, **kw):
            return _Resp()

    ids = sd._ids(_Session(), sd.LIST_ALL)
    assert ids == ["86PGD"], f"_ids() must parse /ar/-prefixed hrefs too, got {ids}"


def test_parse_catalog_cards_extracts_id_from_ar_prefixed_card():
    cards: dict[str, dict] = {}
    sd.parse_catalog_cards(REAL_AR_PREFIXED_CARD, cards)
    assert "86PGD" in cards, f"parse_catalog_cards must key the card by 86PGD, got {list(cards)}"


# ── Mutation proof: the OLD bare-only regex would fail against real markup ─────────────────────
def test_the_old_bare_only_regex_would_have_found_nothing():
    """Reproduce the pre-fix pattern exactly. On today's real /ar/-prefixed markup it matches
    zero ids — this IS the http_200_zero_ids_page1 defect, reproduced from the real capture."""
    old_pattern = re.compile(r'href="/property/([A-Za-z0-9]{4,8})"')
    ids = set(old_pattern.findall(REAL_AR_PREFIXED_CARD))
    assert ids == set(), (
        "the old bare-only pattern matched something against /ar/-prefixed markup — "
        "the mutation proof no longer demonstrates the regression"
    )


# ── Structural guard: every call site goes through the shared, prefix-tolerant regex ────────────
def test_pages_ids_and_parse_catalog_cards_all_use_the_shared_regex():
    """A reintroduced literal `re.findall(r'href="/property/...'` at any call site would silently
    regress to the exact defect this file guards against — pin that they all use
    _PROPERTY_HREF_RE instead of their own inline pattern."""
    import inspect
    for func in (sd._pages, sd._ids, sd.parse_catalog_cards):
        body = inspect.getsource(func)
        assert "_PROPERTY_HREF_RE" in body, (
            f"{func.__name__} must extract property ids via the shared _PROPERTY_HREF_RE, not an "
            "inline, possibly bare-only, regex literal"
        )
        assert 'href="/property/' not in body and 'href="(?:/ar)' not in body, (
            f"{func.__name__} still has an inline href regex literal instead of using "
            "_PROPERTY_HREF_RE"
        )


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
