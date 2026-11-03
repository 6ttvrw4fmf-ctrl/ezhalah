"""souq24: ONE transient browse-page timeout must not make the whole harvest incomplete (2026-11-02).

Run 92838 (11-01) read every browse page but one, whose single transport_Timeout withheld the prune and
raised enumeration_incomplete P1 alert 12223. The failed page is now asked once more after the pool;
only a page that fails BOTH reads leaves the harvest incomplete. Hermetic: fake session, no network."""
from __future__ import annotations

import threading
from unittest import mock

from scrapers.souq24 import run as sq


class _Flaky:
    """Every page answers 200 with ids, except `bad` pages, which time out `fails` times each."""

    def __init__(self, bad: set[str], fails: int):
        self.bad, self.fails = bad, fails
        self.seen: dict[str, int] = {}
        self._lock = threading.Lock()

    def get(self, url, timeout=None, **kw):
        if url == sq.SITEMAP:
            return mock.Mock(status_code=200, text="<urlset>" + "".join(
                f"<loc>https://24.com.sa/view/s-{i}</loc>" for i in range(6)) + "</urlset>")
        with self._lock:
            n = self.seen[url] = self.seen.get(url, 0) + 1
        if url in self.bad and n <= self.fails:
            raise TimeoutError("read timed out")
        return mock.Mock(status_code=200, text=f'href="https://24.com.sa/{1000 + len(url)}/x"')


BAD = {"https://24.com.sa/view/s-3"}


def test_one_transient_timeout_is_retried_and_the_harvest_is_complete():
    s = _Flaky(BAD, fails=1)
    ids, mx, complete = sq.harvest_ids(s)
    assert s.seen["https://24.com.sa/view/s-3"] == 2
    assert complete is True, "a page that answered on the second read is an enumerated page"


def test_a_page_that_fails_both_reads_still_withholds_the_prune():
    s = _Flaky(BAD, fails=2)
    ids, mx, complete = sq.harvest_ids(s)
    assert s.seen["https://24.com.sa/view/s-3"] == 2
    assert complete is False, "an unread page is an un-enumerated page — never prune on it"
