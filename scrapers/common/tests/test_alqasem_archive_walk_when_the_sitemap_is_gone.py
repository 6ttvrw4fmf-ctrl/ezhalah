"""alqasem: with every sitemap gone (HTTP 404 since 2026-11-04) the crawl reads the archive pages (2026-11-07).

CI probe run 42341971426: property-sitemap.xml and its siblings answer 404 while /?post_type=property answers 200 and
names /property/<slug>/ links with /property/page/2/. archive_walk() must collect every page, stop at the end, and
RAISE on a failed page (a failed read is never an empty catalogue).
"""
from __future__ import annotations

import pytest

from scrapers.alqasem import run as A


def _link(slug):
    return f'<a href="https://alqasem.com.sa/property/{slug}/">x</a>'


class _R:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


class _S:
    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def get(self, url, **_k):
        self.asked.append(url)
        return self.pages.get(url, _R(404))


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(A.time, "sleep", lambda *_: None)


def test_every_archive_page_is_read_until_the_end():
    s = _S({A.ARCHIVE: _R(200, _link("villa-a") + _link("pro-cat-x") + _link("floor-b")),
            f"{A.ARCHIVE}page/2/": _R(200, _link("shop-c"))})
    urls = A.archive_walk(s)
    assert urls == [f"{A.ARCHIVE}floor-b/", f"{A.ARCHIVE}villa-a/", f"{A.ARCHIVE}shop-c/"]
    assert s.asked[-1] == f"{A.ARCHIVE}page/3/"           # page 3 answered 404 → the end


def test_a_failed_archive_page_is_not_an_empty_catalogue():
    s = _S({A.ARCHIVE: _R(200, _link("villa-a")), f"{A.ARCHIVE}page/2/": _R(503)})
    with pytest.raises(RuntimeError):
        A.archive_walk(s)
    with pytest.raises(RuntimeError):
        A.archive_walk(_S({A.ARCHIVE: _R(403)}))
