"""`count="exact", head=True` reads 0 on the pinned client — never use it for a number.

On supabase 2.10.0 / postgrest 0.18.0 a HEAD answer has an empty body, `response.json()` raises,
and `APIResponse.from_http_request_response` returns `count=0` instead of reading the
Content-Range header. gathern's liveness kill-cap silently collapsed to its floor this way
(2026-08-16, comment in scrapers/gathern/liveness.py). On 2026-10-05 the Scraping Engineer found
the same trap still live in five places: the no-district backlog in the New Listings report and
score (the number the owner watches shrink nightly read 0), the Lifecycle report's hidden-today
count, and both wasalt enrichers' proxy circuit breakers (pending always 0, so the breaker can
never fire). The report call sites are fixed; the two breakers are a shrink-only allowlist below,
because making their count work would make them fire on ~13k genuinely new rows and stop all
Arabic enrichment — a proxy-spend decision for the owner.

Run: python -m pytest scrapers/common/tests/test_head_count_reads_zero.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

import httpx
from postgrest.base_request_builder import APIResponse

ROOT = Path(__file__).resolve().parents[3]

# Shrink-only: remove a line when that call site is fixed; never add one.
KNOWN_BLIND: set[str] = set()   # the wasalt enrichers were fixed 2026-10-06 (owner cap 15,000)


def _resp(method: str, body: bytes) -> httpx.Response:
    req = httpx.Request(method, "https://x.supabase.co/rest/v1/t?select=id",
                        headers={"prefer": "count=exact"})
    return httpx.Response(200, request=req, content=body, headers={"content-range": "0-0/29335"})


def test_the_pinned_client_reads_zero_on_a_head_count():
    # the library trap, executed: a HEAD answer carries the real total in Content-Range …
    assert APIResponse.from_http_request_response(_resp("HEAD", b"")).count == 0
    # … and the same answer with a JSON body (no head, .limit(1)) reads it
    assert APIResponse.from_http_request_response(_resp("GET", b"[]")).count == 29335


def test_no_scraper_counts_with_head_true():
    found = set()
    for p in (ROOT / "scrapers").rglob("*.py"):
        rel = p.relative_to(ROOT).as_posix()
        if "/tests/" in rel:
            continue
        code = "\n".join(l.split("#", 1)[0] for l in p.read_text(encoding="utf-8").splitlines())
        if re.search(r"head\s*=\s*True", code):
            found.add(rel)
    assert found <= KNOWN_BLIND, f"head=True count reads 0 on the pinned client: {sorted(found - KNOWN_BLIND)}"
    assert not (KNOWN_BLIND - found), f"fixed — remove from KNOWN_BLIND: {sorted(KNOWN_BLIND - found)}"
