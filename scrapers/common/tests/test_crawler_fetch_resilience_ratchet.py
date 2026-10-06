"""Every NEW crawler must fetch through the shared resilient path; the old ones are a shrink-only list.

Owner, 2026-10-05 (backlog 63, «fix the class, not the site»): the night's four failures were the same
weaknesses — one pinned browser profile with no retry, no proxy leg, a refused first page read as
«no posts». The shared code already knows how to survive that:
  · scrapers.common.http.get()                    — retry, 4 profiles DIRECT, then the proxy
                                                     (SCRAPE_PROXY_FALLBACK_URL), pinned per host;
  · scrapers.common.http.retry_smarter_session()  — 3 profiles DIRECT then the proxy, returns the
                                                     route that ANSWERED (2026-10-06);
  · scrapers.common.http.negotiated_session()
  · scrapers.common.inblaj_platform               — the inblaj tenants' shared walker.
On 2026-10-06, 133 of 152 crawlers still opened their own single-profile session. Moving them all is
many nights of work, so this file does two things now:
  1. a crawler that is NOT on the list below and does not use the shared path is RED — the class
     cannot grow (every site onboarded from today starts resilient);
  2. a crawler on the list that now uses the shared path is RED as stale — remove its line, so the
     list only ever shrinks and its length is the honest size of the remaining work.

Run: python -m pytest scrapers/common/tests/test_crawler_fetch_resilience_ratchet.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASELINE = ROOT / "scrapers/common/tests/crawler_fetch_not_resilient.txt"

SHARED = re.compile(
    r"retry_smarter_session|negotiated_session|\bhttp\.get\(|\bhttp\.session\(|inblaj_platform"
    r"|from scrapers\.common\.http import [^\n]*\bget\b")


def _code(p: Path) -> str:
    return "\n".join(l.split("#", 1)[0] for l in p.read_text(encoding="utf-8").splitlines())


def crawlers() -> dict[str, bool]:
    """{site: uses the shared resilient path} for every scrapers/<site>/run.py."""
    out = {}
    for run in sorted((ROOT / "scrapers").glob("*/run.py")):
        site = run.parent.name
        if site == "common":
            continue
        code = _code(run)
        # a site split over several modules: its own package counts too
        for extra in run.parent.glob("*.py"):
            if extra.name not in ("run.py", "__init__.py") and not extra.name.startswith("test_"):
                code += "\n" + _code(extra)
        out[site] = bool(SHARED.search(code))
    return out


def baseline() -> set[str]:
    return {l.strip() for l in BASELINE.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.startswith("#")}


def test_no_new_crawler_opens_its_own_single_profile_session():
    weak = {s for s, ok in crawlers().items() if not ok}
    new = sorted(weak - baseline())
    assert not new, (f"{new}: a new crawler must fetch through scrapers.common.http (get() / "
                     f"retry_smarter_session()) — see this file's docstring")


def test_the_list_only_shrinks():
    weak = {s for s, ok in crawlers().items() if not ok}
    stale = sorted(baseline() - weak)
    assert not stale, f"{stale} now use the shared path (or are gone) — remove them from {BASELINE.name}"


def test_the_detector_sees_both_shapes():
    assert SHARED.search("s, tried = retry_smarter_session(URL)")
    assert SHARED.search("r = http.get(url, timeout=45)")
    assert not SHARED.search("s = cc.Session(impersonate='chrome')\nr = s.get(url)")
    # commented-out use does not count
    assert not SHARED.search(_code_text("x = 1  # http.get(url)"))


def _code_text(t: str) -> str:
    return "\n".join(l.split("#", 1)[0] for l in t.splitlines())
