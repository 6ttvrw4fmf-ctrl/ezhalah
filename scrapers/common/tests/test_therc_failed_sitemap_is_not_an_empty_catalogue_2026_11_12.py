"""⚡ 2026-11-12 — therc: a sitemap that could not be read must fail the run with its reason.

On 2026-11-10 07:02 the crawl logged «0 listing URLs from sitemap.xml» (457 the night before): the
fetch's failure came back as [] and the run read as «0-row run (blocked/empty source?)». Executes the
real `sitemap_urls` against a stub session that answers like curl_cffi does.
"""
from __future__ import annotations

import pytest

from scrapers.therc import run


class _R:
    def __init__(self, code: int, text: str = ""):
        self.status_code, self.text = code, text


class _S:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), 0

    def get(self, url, **kw):
        self.calls += 1
        a = self.answers.pop(0) if self.answers else self.answers_last
        if isinstance(a, Exception):
            raise a
        return a


_XML = ("<urlset><url><loc>https://therc.aqar.digital/properties/villa-1</loc><lastmod>2026-11-01</lastmod></url>"
        "<url><loc>https://therc.aqar.digital/about</loc></url></urlset>")


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(run.time, "sleep", lambda *_: None)


def test_every_try_failing_raises_with_the_answer():
    s = _S([_R(503)] * 5)
    with pytest.raises(RuntimeError, match=r"HTTP 503 after 5 tries"):
        run.sitemap_urls(s)
    assert s.calls == 5


def test_a_transport_error_is_named():
    s = _S([ConnectionError("x")] * 5)
    with pytest.raises(RuntimeError, match="ConnectionError"):
        run.sitemap_urls(s)


def test_a_late_answer_is_read():
    s = _S([_R(503), ConnectionError("x"), _R(200, _XML)])
    assert run.sitemap_urls(s) == [("https://therc.aqar.digital/properties/villa-1", "2026-11-01")]


def test_a_read_sitemap_with_no_property_pages_raises():
    s = _S([_R(200, "<urlset><url><loc>https://therc.aqar.digital/about</loc></url></urlset>")])
    with pytest.raises(RuntimeError, match="0 /properties/ pages"):
        run.sitemap_urls(s)
