"""A scraper that impersonates a browser must not hand-write its own User-Agent.

THE INCIDENT (2026-09-14). rakez.sa answered **403 to every endpoint** — unit, project and city
alike — while plain `curl` got 200 from the same machine, seconds apart. It was not rate limiting,
not the proxy, and not a block on us: it was our own request contradicting itself.

curl_cffi's `impersonate="chrome124"` sets a COMPLETE, internally consistent browser header set at
the C layer (User-Agent, sec-ch-ua, Accept, …) chosen to MATCH the TLS/JA3 fingerprint it presents.
Overriding just the User-Agent leaves the fingerprint saying one browser and the header saying
another — which is precisely the mismatch bot detection exists to find. Isolated by bisecting the
headers against rakez, TLS fingerprint held constant throughout:

    impersonate only .................. 200
    impersonate + Accept-Language ..... 200
    impersonate + my User-Agent ....... 403   ← this one, alone
    impersonate + both ................ 403

At the time this was written 46 of the 48 scrapers already left the UA to `impersonate`. The two
that did not were both mine, written the same day. The convention was already unanimous; this
records it so the 49th cannot quietly break it — and so the next person to meet a blanket 403
recognises it in minutes rather than blaming the source.

Accept-Language is NOT implicated and is deliberately still allowed.

Run: python -m pytest scrapers/common/tests/test_impersonate_owns_the_user_agent.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

SCRAPERS = Path(__file__).resolve().parents[2]

# A scraper may legitimately hand-write a UA if it does NOT impersonate — then nothing contradicts
# it. Any entry here must say which scraper and why.
EXEMPT: dict[str, str] = {}

_IMPERSONATE = re.compile(r"impersonate\s*=")
_UA_HEADER = re.compile(r"""["']User-Agent["']\s*:""")


def _scraper_sources() -> list[Path]:
    return sorted(p for p in SCRAPERS.glob("*/run.py") if p.parent.name != "common")


def test_there_are_scrapers_to_check():
    # Guards against a glob that silently matches nothing and passes vacuously.
    assert len(_scraper_sources()) >= 40, "the scraper sweep found almost nothing — check the glob"


@pytest.mark.parametrize("path", _scraper_sources(), ids=lambda p: p.parent.name)
def test_a_scraper_that_impersonates_does_not_also_hardcode_a_user_agent(path):
    name = path.parent.name
    if name in EXEMPT:
        pytest.skip(f"exempt: {EXEMPT[name]}")
    src = path.read_text(encoding="utf-8")
    if not _IMPERSONATE.search(src):
        return  # no impersonation, so nothing can contradict a hand-written UA
    hits = [ln.strip() for ln in src.splitlines()
            if _UA_HEADER.search(ln) and not ln.strip().startswith("#")]
    assert not hits, (
        f"{name} impersonates a browser AND hardcodes a User-Agent: {hits[:1]}. curl_cffi already "
        f"sets a UA consistent with the TLS fingerprint it presents; overriding it makes the two "
        f"disagree, which is what got rakez a 403 on every endpoint on 2026-09-14. Delete the "
        f"header and let impersonate own it.")


def test_the_rule_is_the_established_convention_not_a_new_opinion():
    # If this ever inverts — most scrapers hardcoding a UA — the rule above is the minority view
    # and should be re-argued rather than enforced.
    srcs = [(p.parent.name, p.read_text(encoding="utf-8")) for p in _scraper_sources()]
    impersonating = [(n, s) for n, s in srcs if _IMPERSONATE.search(s)]
    clean = [n for n, s in impersonating
             if not any(_UA_HEADER.search(ln) and not ln.strip().startswith("#")
                        for ln in s.splitlines())]
    assert len(impersonating) >= 20, "too few impersonating scrapers to call this a convention"
    assert len(clean) == len(impersonating), (
        f"{len(impersonating) - len(clean)} impersonating scraper(s) still hardcode a UA")
