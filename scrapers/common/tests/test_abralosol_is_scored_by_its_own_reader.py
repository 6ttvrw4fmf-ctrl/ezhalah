"""abralosol: the dead-visible score and spot-check read it the way its crawl does (2026-10-12).

The shared status reader got 0 of 5 known-live pages back alive (row void twice on 10-12) while the
crawl read 2,811 ads through its own session.
"""
from __future__ import annotations

from scrapers.abralosol import run as AB
from scrapers.common import lifecycle_spot_check as SC
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN

URL = "https://abralosol.com/12345"


def _reader(monkeypatch, status, page):
    monkeypatch.setattr(AB, "_session", lambda: object())
    monkeypatch.setattr(AB, "_fetch", lambda s, url, tries=3: (status, page))
    return SC._reader_for("abralosol")


def test_its_own_article_is_alive(monkeypatch):
    page = '<article data-history-node-id="12345" class="x">hi</article>'
    assert _reader(monkeypatch, 200, page)(URL) == ALIVE


def test_another_nodes_article_is_unknown(monkeypatch):
    page = '<article data-history-node-id="999" class="x">hi</article>'
    assert _reader(monkeypatch, 200, page)(URL) == UNKNOWN


def test_404_is_dead_and_unreadable_is_unknown(monkeypatch):
    assert _reader(monkeypatch, 404, None)(URL) == DEAD
    assert _reader(monkeypatch, None, None)(URL) == UNKNOWN


def test_the_score_uses_it():
    from scrapers.common import dead_visible_score as D
    assert D.reader_for("abralosol", None)[0] == "site-reader"
