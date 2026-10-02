"""The scheduled aqar deep fill must read every page the source publishes — no fixed 150-page cap.

WHY (coverage audit 2026-09-28, re-measured 2026-10-02). aqar paginates every slice to
ceil(numberOfItems / 20): Riyadh apartments-for-rent published 22,415 ads on 1,121 pages, Jeddah
apartments-for-sale 25,048 on 1,253. The weekly fill stopped at page 150, so we held 4,888 and 5,238 of
them; 8 of 8 sampled ads from pages 400-1100 opened live and priced. The walk must end at the SOURCE'S
own last page — not at a constant, and not past it (aqar keeps answering 200 there).

The test runs the workflow's own command line the way pg_cron dispatches it (no inputs, so every
`${{ github.event.inputs.X || D }}` is D) and drives the real discover() over a fake 201-page slice.

    python -m pytest scrapers/common/tests/test_aqar_fill_walks_to_the_sources_own_page_count.py -q
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path
from urllib.parse import unquote

for _name, _attrs in (("supabase", {"Client": object, "create_client": lambda *a, **k: None}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    if _name not in sys.modules:
        sys.modules[_name] = types.ModuleType(_name)
        for _k, _v in _attrs.items():
            setattr(sys.modules[_name], _k, _v)

import scrapers.aqar.discover as D  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
N_ITEMS = 4013                       # -> 201 pages: deeper than the old 150, last page holds 13 ads
LAST = -(-N_ITEMS // 20)


def _scheduled_arg(workflow: str, flag: str) -> int:
    """The value pg_cron's input-less dispatch passes for `flag` in the workflow's run command."""
    run = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
    m = re.search(re.escape(flag) + r"\s+\$\{\{\s*github\.event\.inputs\.\w+\s*\|\|\s*(-?\d+)\s*\}\}", run)
    assert m, f"{workflow}: {flag} is no longer `${{{{ github.event.inputs.X || <default> }}}}`"
    return int(m.group(1))


def test_scheduled_fill_reads_every_page_the_source_publishes_and_stops_there(monkeypatch):
    fetched: list[int] = []

    class _Page:
        status_code = 200

        def __init__(self, page: int):
            # Past the last page aqar still answers 200 with a full page (a fallback feed), so only
            # the source's own count can end the walk in the right place.
            n = 20 if page != LAST else N_ITEMS - 20 * (LAST - 1)
            links = "".join(f'<a href="/شقق-للإيجار/الرياض/حي-{page}-{6000000 + page * 100 + i}">x</a>'
                            for i in range(n))
            self.text = ('<script type="application/ld+json">{"mainEntity":{"@type":"ItemList",'
                         f'"numberOfItems":{N_ITEMS}}}}}</script>' + links)

    def fake_get(url, *a, **k):
        tail = unquote(url).rstrip("/").rsplit("/", 1)[-1]
        page = int(tail) if tail.isdigit() else 1
        fetched.append(page)
        return _Page(page)

    monkeypatch.setattr(D, "get", fake_get)
    for wf in ("aqar-deep-fill.yml", "aqar-commercial-fill.yml"):
        pages, limit = _scheduled_arg(wf, "--pages"), _scheduled_arg(wf, "--limit")
        fetched.clear()
        urls = list(D.discover("apartment", "rent", "riyadh", max_pages=pages, max_listings=limit))
        assert fetched == list(range(1, LAST + 1)), (wf, fetched[:3], fetched[-3:], len(fetched))
        assert len(urls) == N_ITEMS, (wf, len(urls))
