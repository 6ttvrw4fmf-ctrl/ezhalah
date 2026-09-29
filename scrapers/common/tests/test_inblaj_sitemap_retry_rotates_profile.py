"""A sitemap retry must be a NEW handshake, not the same one replayed.

Measured 2026-09-27: `alhumaidan` failed the 04:25 UTC daily crawl with «sitemap returned no
/property/ urls» after all three retries (Actions job 108549602049), then crawled cleanly on a
re-dispatch at 21:52 — same code, same host. `fetch_catalogue` retried on the ONE chrome124 session
it was handed, so every retry replayed the same fingerprint on the same connection. The Scraping
Engineer rulebook (docs/ops/SCRAPING_ENGINEER.md step 5a) says a block is usually the handshake:
switch profile with a fresh session every attempt.

These tests execute the REAL `fetch_catalogue` against stub sessions:
  1. a first session that keeps answering empty is abandoned for a fresh session with another
     profile, and the listing pages then ride the session that actually served the sitemap;
  2. when every profile fails, the result is still empty (the fail-loud guard keeps its meaning)
     and the trace names what each profile got.

Run: python -m pytest scrapers/common/tests/test_inblaj_sitemap_retry_rotates_profile.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.inblaj_platform as IP  # noqa: E402

BASE = "https://al-humaidan.inblaj.net"
SITEMAP = ("<urlset><url><loc>https://al-humaidan.inblaj.net/property/a/</loc></url>"
           "<url><loc>https://al-humaidan.inblaj.net/property/b/</loc></url></urlset>")


class _Resp:
    def __init__(self, status: int, text: str) -> None:
        self.status_code = status
        self.text = text


class _Sess:
    """Answers every sitemap request the same way; records what it was asked."""

    def __init__(self, profile: str, status: int, text: str, raises: bool = False) -> None:
        self.profile, self.status, self.text, self.raises = profile, status, text, raises
        self.calls: list[str] = []

    def get(self, url: str, timeout: int = 0) -> _Resp:
        self.calls.append(url)
        if self.raises:
            raise TimeoutError("curl: (28) Connection timed out")
        return _Resp(self.status, self.text)


def _no_sleep(monkeypatch) -> None:
    monkeypatch.setattr(IP.time, "sleep", lambda _s: None)


def test_empty_first_session_is_replaced_by_a_fresh_profile(monkeypatch):
    _no_sleep(monkeypatch)
    first = _Sess("chrome124", 200, "<html>maintenance</html>")
    made: list[_Sess] = []

    def make(profile: str) -> _Sess:
        sess = _Sess(profile, 200, SITEMAP)
        made.append(sess)
        return sess

    urls, used, trace = IP.fetch_catalogue(first, BASE, make_session=make)

    assert urls == [f"{BASE}/property/a/", f"{BASE}/property/b/"]
    assert made, "a retry must open a FRESH session, not replay the one that just failed"
    assert made[0].profile != "chrome124", "the retry must switch browser profile"
    assert used is made[0], "listing pages must ride the session that actually served the sitemap"
    assert any("chrome124" in t and "no /property/ loc" in t for t in trace)


def test_every_profile_failing_stays_empty_and_says_why(monkeypatch):
    _no_sleep(monkeypatch)
    first = _Sess("chrome124", 200, "<html></html>")
    made: list[str] = []

    def make(profile: str) -> _Sess:
        made.append(profile)
        return _Sess(profile, 0, "", raises=True)

    urls, used, trace = IP.fetch_catalogue(first, BASE, make_session=make)

    assert urls == [], "an unreadable sitemap must never turn into a catalogue"
    assert used is first
    assert made == list(IP.CATALOGUE_PROFILES[1:]), "every configured profile must be tried once"
    assert len(set(IP.CATALOGUE_PROFILES)) == len(IP.CATALOGUE_PROFILES) >= 3
    for prof in IP.CATALOGUE_PROFILES:
        assert any(t.startswith(prof + ":") for t in trace), f"trace must say what {prof} got"


def test_healthy_first_session_needs_no_retry(monkeypatch):
    _no_sleep(monkeypatch)
    first = _Sess("chrome124", 200, SITEMAP)

    def make(profile: str):  # pragma: no cover — must not be reached
        raise AssertionError("a served sitemap must not trigger a retry")

    urls, used, _trace = IP.fetch_catalogue(first, BASE, limit=1, make_session=make)
    assert urls == [f"{BASE}/property/a/"] and used is first
    assert len(first.calls) == 1, "the WP-core sitemap is only a fallback"
