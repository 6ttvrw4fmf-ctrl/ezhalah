"""Guards for the 2026-08-04 intake-loss fixes (inventory investigation wf_f22dfe0d-fc3).

1. sadin pagination stopped on a pager marker that the site no longer emits.
   `_pages()` had two stop conditions: a site-agnostic one (a page contributes no NEW
   /property/{ID} links) and `if 'rel="next"' not in html: return`. sadin.com.sa dropped rel="next"
   from its pager, so the crawl returned after page 1 and collected 9 of the 82 listings sadin
   publishes — an 89% intake loss that every run still recorded as ok=true. Verified live
   2026-08-04: pages 1/2/3/11 all return 0 occurrences of rel="next"; pages 1 and 2 share 0 ids
   (9 unique each); page 11 yields 0 links, which is what terminates the loop.
   Only prune_unseen's collapse guard kept the 73 unseen rows searchable.

2. satel and eastabha wrote `scraped_at` on EVERY upsert. The column is contractually FIRST-seen
   (last_seen_at is the liveness stamp, set centrally in scrapers/common/db.py), so rewriting it
   made pre-existing listings look like brand-new intake and corrupted every churn/freshness metric
   for those two platforms — including the cohort analysis used to explain the inventory decline.

Run: python -m pytest scrapers/common/tests/test_sadin_pagination_and_first_seen.py
"""
from __future__ import annotations

import re
from pathlib import Path

SCRAPERS = Path(__file__).resolve().parent.parent.parent


def _src(rel: str) -> str:
    return (SCRAPERS / rel).read_text(encoding="utf-8")


def _body(src: str, func: str) -> str:
    """Return the source of `func` up to the next top-level def."""
    start = src.index(f"def {func}(")
    nxt = src.find("\ndef ", start + 1)
    return src[start : nxt if nxt != -1 else len(src)]


# ── 1. sadin pagination ──────────────────────────────────────────────────────────────────────
def test_pages_does_not_stop_on_rel_next() -> None:
    """The site emits no rel="next" at all — a stop that depends on it ends the crawl at page 1."""
    body = _body(_src("sadin/run.py"), "_pages")
    assert 'rel="next"' not in body.split('"""')[2], (
        "_pages() must not branch on rel=\"next\": sadin.com.sa no longer emits it, so this "
        "silently truncates the crawl to a single page (9 of 82 listings)."
    )


def test_pages_keeps_the_site_agnostic_stop() -> None:
    """The catalogue itself is the only reliable end-of-pagination signal."""
    body = _body(_src("sadin/run.py"), "_pages")
    assert "if p > 1 and not (ids - seen):" in body and "return" in body, (
        "_pages() must still stop when a page contributes no NEW property ids, or it would run to "
        "max_pages on every crawl."
    )


def test_pages_guard_has_headroom_for_the_real_catalogue() -> None:
    """82 published listings at ~9/page needs >10 pages; the old cap of 12 left almost none."""
    m = re.search(r"def _pages\([^)]*max_pages: int = (\d+)", _src("sadin/run.py"))
    assert m, "could not read _pages max_pages guard"
    assert int(m.group(1)) >= 20, (
        f"max_pages={m.group(1)} is too tight: sadin publishes 82 listings at ~9/page (~10 pages), "
        "so the runaway guard would become a silent intake ceiling as the catalogue grows."
    )


def test_pages_terminates_on_an_empty_page_without_rel_next() -> None:
    """Simulate today's markup: distinct ids per page, then an empty page — must stop, not loop."""
    pages = [
        "".join(f'<a href="/property/AD{p}{i:02d}"></a>' for i in range(9)) for p in range(3)
    ] + ["<html>no listings</html>"] * 5
    seen: set[str] = set()
    yielded = 0
    for p, html in enumerate(pages, start=1):
        ids = set(re.findall(r'href="/property/([A-Za-z0-9]{4,8})"', html))
        if p > 1 and not (ids - seen):
            break
        seen |= ids
        yielded += 1
    assert yielded == 3, f"expected the 3 real pages then a clean stop, got {yielded}"
    assert len(seen) == 27, f"expected 27 unique ids across 3 pages, got {len(seen)}"


# ── 2. scraped_at is FIRST-seen, never rewritten ─────────────────────────────────────────────
def test_satel_and_eastabha_do_not_overwrite_scraped_at() -> None:
    for rel in ("satel/run.py", "eastabha/run.py"):
        src = _src(rel)
        assert '"scraped_at"' not in src, (
            f"{rel} writes scraped_at on every upsert. That column is FIRST-seen; rewriting it makes "
            "existing listings masquerade as new intake. last_seen_at (set centrally in "
            "scrapers/common/db.py) is the liveness stamp — use that instead."
        )


def test_db_still_stamps_last_seen_at_centrally() -> None:
    """The reason removing scraped_at above is safe — liveness is stamped for every platform."""
    assert 'row["last_seen_at"]' in _src("common/db.py"), (
        "scrapers/common/db.py must keep stamping last_seen_at centrally; the scraped_at removals "
        "depend on it for liveness."
    )
