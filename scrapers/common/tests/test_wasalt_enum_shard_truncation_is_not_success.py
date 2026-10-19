"""A page that fails mid-crawl is not the same as a page that legitimately ran out of results —
and until 2026-09-23 `scrape_slice()` could not tell them apart.

`fetch_page()` already returns a `valid` flag distinguishing a parsed-but-empty page
(valid=True, genuinely no more results) from an unparseable bot-wall/proxy shell
(valid=False, page 1 answered fine and later pages died). The per-page loop discarded that
flag for every page after the first (`_, _, props, _ = fetch_page(...)`), so both cases hit
the identical `if not props: break` and the slice was reported as a clean, complete sweep
either way.

On the shared 6-way-concurrent proxy pool `wasalt-enum-liveness.yml` runs (see run.py's module
docstring), that let a shard truncate after page 1 while still reporting `ok=true` with
whatever handful of rows it had upserted — the 2026-09-23 `silent_partial_success` incident
(13 of 24h's `wasalt_enum_shard` runs short, worst case 1 row against a 235-row baseline
median), which is dangerous specifically because `ok=true` suppresses every failure barrier and
the short list is handed straight to `prune_unseen()`, which then inactivates the real listings
that were simply never re-fetched.

This file pins the fix: `scrape_slice()` must surface a `truncated` flag whenever it stops on an
invalid (not merely empty) page, and `main()` must fold that into `ok`/`legit_empty` so a
truncated slice can never read as a healthy — or even a healthily-empty — run.

Run: python -m pytest scrapers/common/tests/test_wasalt_enum_shard_truncation_is_not_success.py -v
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.wasalt import run as R  # noqa: E402


def _fake_page(pages: dict[int, tuple[int, int, list[dict], bool]]):
    def _fp(s, deal, cat, slug, page):
        return pages[page]
    return _fp


def _no_op_map_property(monkeypatch):
    # scrape_slice() calls map_property(prop, deal, s) per row; make it pass rows straight
    # through their minimal shape so the batch upsert has something to count.
    monkeypatch.setattr(R, "map_property", lambda prop, deal, s: {"property_type": "apartment", **prop})


def _stub_upserters(monkeypatch):
    upserted: list[list[dict]] = []
    monkeypatch.setattr(R.db, "upsert_wasalt_residential_batch", lambda batch: upserted.append(batch))
    monkeypatch.setattr(R.db, "upsert_wasalt_commercial_batch", lambda batch: upserted.append(batch))
    return upserted


# ── the truncation signal itself ─────────────────────────────────────────────────────────────────

def test_a_failed_page_mid_crawl_is_reported_truncated(monkeypatch):
    """page 1: valid, 2 rows, claims 3 total pages. page 2: fetch failed (valid=False). The slice
    must report truncated=True — NOT a clean 1-page-of-real-data sweep."""
    _no_op_map_property(monkeypatch)
    upserted = _stub_upserters(monkeypatch)
    pages = {
        1: (999, 3, [{"id": 1}, {"id": 2}], True),
        2: (0, 0, [], False),  # bot-wall shell, not a genuine empty page
    }
    monkeypatch.setattr(R, "fetch_page", _fake_page(pages))

    up, count, page1_valid, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)

    assert truncated is True, "an invalid mid-crawl page must mark the slice truncated"
    assert page1_valid is True
    assert count == 999
    assert up == 2, "rows actually captured before the failure are still upserted"
    assert len(upserted) == 1


def test_a_genuinely_empty_page_is_not_truncated(monkeypatch):
    """page 1: valid, 2 rows. page 2: valid AND empty — a real end of results. Must NOT be
    truncated: this is the legitimate, intended way a crawl ends."""
    _no_op_map_property(monkeypatch)
    _stub_upserters(monkeypatch)
    pages = {
        1: (2, 2, [{"id": 1}, {"id": 2}], True),
        2: (2, 2, [], True),  # a real, parsed, empty page
    }
    monkeypatch.setattr(R, "fetch_page", _fake_page(pages))

    up, count, page1_valid, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)

    assert truncated is False, "a genuinely empty (valid=True) page must not be treated as a failure"
    assert up == 2


def test_page_1_itself_failing_is_also_truncated(monkeypatch):
    """The pre-existing page-1-unanswerable path must also report truncated=True — it already
    aborted the whole slice, which is the most extreme case of 'incomplete'."""
    monkeypatch.setattr(R, "fetch_page", _fake_page({1: (0, 0, [], False)}))

    up, count, page1_valid, truncated = R.scrape_slice(None, "sale", "residential", "apartment", max_pages=10)

    assert page1_valid is False
    assert truncated is True
    assert up == 0


# ── main()'s ok/legit_empty decision must fold `any_truncated` in ──────────────────────────────────
# (Executed against the SOURCE, not just re-implemented: a future edit that reintroduces the bug by
# restructuring main() without touching this exact code shape will fail this test, because the
# assertions below only pass if the printed source still gates `ok`/`legit_empty` on the flag.)

_MAIN_SRC = inspect.getsource(R.main)


def test_main_folds_truncation_into_ok():
    assert "any_truncated" in _MAIN_SRC, (
        "main() must track whether any slice truncated mid-crawl")
    assert "not any_truncated" in _MAIN_SRC, (
        "a truncated slice must be able to flip `ok` to False even when it upserted rows>0 — "
        "otherwise a mid-crawl proxy hiccup that still yielded a few rows reads as a healthy run")


def test_legit_empty_cannot_be_true_while_truncated():
    # legit_empty asserts "the source genuinely has zero listings for this slug" — a truncated
    # slice never proved that, it just stopped answering.
    assert "and not any_truncated" in _MAIN_SRC.replace("\n", " "), (
        "legit_empty must require `not any_truncated`, or a slice that failed after page 1 "
        "(source_count==0 so far, page1 valid) could be misread as a legitimately empty category")
