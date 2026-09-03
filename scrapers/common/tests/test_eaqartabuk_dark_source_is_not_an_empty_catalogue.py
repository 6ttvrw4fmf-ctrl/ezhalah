"""A blocked catalogue fetch must never be reported as an empty catalogue (senior run 2026-08-29).

THE DEFECT THIS LOCKS IN
------------------------
eaqartabuk captured nothing on 2026-08-28 and 2026-08-29. Its page-1 list fetch timed out from the
GitHub Actions runners; the SAME endpoint answered `HTTP 200` with `total: 554` from other egress
on 2026-08-29, and the sitemap-equivalent count matched our 554 stored rows exactly — so no listing
was lost or missed. The source was fine. The capture path was blocked.

What the scraper said about that, verbatim from run 33233644101, job 99050702829:

    Eaqar Tabuk: None listings across 1 pages (5 workers)
      collected 0 list items
    ⚠ eaqartabuk_residential_listings: prune guard tripped (0 scraped or collapse) — kept existing active
    ⚠ eaqartabuk_commercial_listings: prune guard tripped (0 scraped or collapse) — kept existing active
    ✓ Eaqar Tabuk: 0 residential + 0 commercial upserted, 0 stale pruned
    ✗ run demoted to unhealthy by end_run()'s RC-B guard

`fetch_page` exhausted its ladder and returned `([], {})`; `main()` read `total` off that empty
dict, printed `None`, and then walked the ENTIRE upsert/prune path on a phantom empty catalogue.
Only `prune_unseen`'s 0-scraped guard and `end_run`'s RC-B demotion stood between a blocked crawl
and 532 live listings being pruned. The scrape_runs note it left could only say
`0-row run (blocked/empty source?)` — with a question mark — because the scraper genuinely did not
know which of the two had happened. That is the distinction the whole liveness architecture rests
on (docs/ops/DATA_INTEGRITY_ENGINEER.md: absence of evidence is not evidence of absence).

THIS IS THE MUTE FORM OF THE ERAPULSE DEFECT (2026-08-27, test_source_death_is_recorded.py).
erapulse exited non-zero before `begin_run()` and left NO row; eaqartabuk left a row that
MISDESCRIBED what happened. §1 of that barrier catches only the first shape — it looks for a
failure exit before `begin_run()`, and a scraper that quietly continues has none — which is why
eaqartabuk passed it every day while carrying this.

A second, latent half was fixed with it: `r.json()` sat OUTSIDE `fetch_page`'s try/except, so a WAF
or consent HTML body answering 200 raised an uncaught exception in `main()` before `begin_run()` —
the literal erapulse no-row outcome, one WAF rule away.

WHAT THIS TEST DOES
-------------------
§A pins the discriminator itself, both directions: a source-published empty catalogue must stay
healthy, and only a fetch that never answered counts as dark.
§B runs main() against a dark source: begin_run IS called, end_run says ok=False with a note that
names the cause, the exit is non-zero, and — the part that matters — prune is NEVER reached.
§C runs main() against a genuinely empty catalogue and proves it is still treated as a real,
non-dark crawl, so the fix cannot be "call everything dark".
§D pins that a non-JSON 200 body is a retry, not a crash.
§E pins that a --limit validation run still opens no scrape_runs row.

Run: python -m pytest scrapers/common/tests/test_eaqartabuk_dark_source_is_not_an_empty_catalogue.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.eaqartabuk import run as eaq  # noqa: E402


# ── §A — the discriminator ───────────────────────────────────────────────────────────────────

def test_source_published_empty_catalogue_is_not_dark():
    """total=0 is the source telling us it has nothing. That is evidence, and it is healthy."""
    assert eaq.catalogue_is_unreachable({"total": 0, "total_pages": 0, "items": []}) is False


def test_populated_catalogue_is_not_dark():
    assert eaq.catalogue_is_unreachable({"total": 554, "total_pages": 185}) is False


def test_exhausted_ladder_is_dark():
    """`([], {})` — what fetch_page returns when nothing ever answered. The 2026-08-28 shape."""
    assert eaq.catalogue_is_unreachable({}) is True


def test_error_object_without_total_is_dark():
    """A WP REST error parses as JSON but carries no catalogue. Absence of `total` is not total=0."""
    assert eaq.catalogue_is_unreachable({"code": "rest_no_route", "data": {"status": 404}}) is True


# ── §B — a dark source, end to end ───────────────────────────────────────────────────────────

def _wire(monkeypatch, *, meta, items=()):
    """Run main() against a stubbed source; return what it did."""
    calls: dict[str, object] = {}
    monkeypatch.setattr(eaq, "session", lambda: object())
    monkeypatch.setattr(eaq, "fetch_page", lambda s, page: (list(items) if page == 1 else [], meta))
    def _begin_run(platform):
        calls["begin"] = platform
        return 7373

    monkeypatch.setattr(eaq.db, "begin_run", _begin_run)

    def _end_run(run_id, *, ok, rows_seen, rows_upserted, notes=None, **kw):
        calls["end"] = {"run_id": run_id, "ok": ok, "notes": notes}
        return ok

    def _prune(tbl, seen, source=None):
        calls.setdefault("pruned", []).append(tbl)
        return 0

    monkeypatch.setattr(eaq.db, "end_run", _end_run)
    monkeypatch.setattr(eaq.db, "prune_unseen", _prune)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all"])
    calls["rc"] = eaq.main()
    return calls


def test_dark_source_records_a_failed_run_and_never_prunes(monkeypatch):
    calls = _wire(monkeypatch, meta={})

    assert calls["rc"] == 1, "a dark source must be a non-zero exit"
    assert calls.get("begin") == "eaqartabuk", (
        "begin_run() was never called — the attempt is invisible to scrape_runs, which is the "
        "erapulse defect: 'the source stopped answering' becomes indistinguishable from 'the job "
        "never ran'"
    )
    end = calls.get("end")
    assert end is not None, "end_run() was never called: the row would dangle at ok=NULL"
    assert end["ok"] is False
    assert "NOT an empty catalogue" in (end["notes"] or ""), (
        "the note must state which of the two happened; '0-row run (blocked/empty source?)' is "
        "exactly the ambiguity this fix removes"
    )
    assert "pruned" not in calls, (
        "THE REGRESSION THAT MATTERS: a blocked crawl reached prune_unseen. Today only its "
        "0-scraped guard prevented 532 live listings from being deactivated; a scraper must not "
        "rely on a downstream guard to avoid destroying data it never had evidence about."
    )


# ── §C — a genuinely empty catalogue is still a real crawl ───────────────────────────────────

def test_source_published_emptiness_is_not_treated_as_dark(monkeypatch):
    """The negative direction. If this can be made to pass by calling everything dark, the fix is
    worthless: a source that truly empties out must still complete a normal, prunable crawl."""
    calls = _wire(monkeypatch, meta={"total": 0, "total_pages": 0, "items": []})

    end = calls.get("end")
    assert end is not None
    assert "NOT an empty catalogue" not in (end["notes"] or ""), (
        "a source-published empty catalogue was misreported as an unreachable one"
    )
    assert calls.get("pruned"), (
        "a real crawl that legitimately saw nothing must still reach prune (its own guards then "
        "decide) — otherwise the fix has simply disabled pruning"
    )


# ── §D — a non-JSON 200 body retries instead of crashing ─────────────────────────────────────

def test_html_body_on_200_is_a_failed_attempt_not_a_crash(monkeypatch):
    """A WAF/consent shell answers 200 with HTML. Before the fix, .json() sat outside the try and
    raised straight through main() — before begin_run(), so NO scrape_runs row at all."""

    class _HtmlResponse:
        status_code = 200

        def json(self):
            raise ValueError("Expecting value: line 1 column 1 (char 0)")

    class _Session:
        def get(self, *a, **kw):
            return _HtmlResponse()

    monkeypatch.setattr(eaq.time, "sleep", lambda *_: None)
    items, meta = eaq.fetch_page(_Session(), 1)

    assert (items, meta) == ([], {}), "an unparseable body must exhaust the ladder, not propagate"
    assert eaq.catalogue_is_unreachable(meta) is True


# ── §E — validation runs stay invisible ──────────────────────────────────────────────────────

def test_limit_run_opens_no_scrape_run(monkeypatch):
    opened: list[str] = []
    monkeypatch.setattr(eaq, "session", lambda: object())
    monkeypatch.setattr(eaq, "fetch_page", lambda s, page: ([], {}))
    monkeypatch.setattr(eaq.db, "begin_run", lambda platform: opened.append(platform) or 1)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all", "--limit", "5"])

    assert eaq.main() == 1
    assert opened == [], (
        "a --limit validation run must stay invisible to freshness/liveness accounting"
    )
