"""almuteb: the dead-visible score and spot-check read its REST record, as its crawl does (2026-10-18).

Its HTML pages answer HTTP 503 (a 4 KB stub) to every CI read, so the status reader voided the
dead-visible row four nights running (10-15..10-18) while the crawl read all 10 ads through REST.
"""
from __future__ import annotations

from scrapers.almuteb import run as MT
from scrapers.common import db
from scrapers.common import lifecycle_spot_check as SC
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN

URL = "https://almuteb.sa/property/x-72/"


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_a):
        return self

    def eq(self, _c, v):
        self.rows = [r for r in self.rows if r["listing_url"] == v]
        return self

    def limit(self, _n):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _C:
    def table(self, t):
        return _Q([{"listing_url": URL, "ad_number": "MTB72"}] if t.startswith("almuteb_residential") else [])


def _reader(monkeypatch, verdict):
    asked = []
    monkeypatch.setattr(MT, "session", lambda: object())
    monkeypatch.setattr(MT, "fetch_taxonomies", lambda s: {})
    monkeypatch.setattr(MT, "_verify_gone_with", lambda tax: (lambda ad: (asked.append(ad) or (verdict, "REST"))))
    monkeypatch.setattr(db, "sb", lambda: _C())
    return SC._reader_for("almuteb"), asked


def test_its_rest_record_decides(monkeypatch):
    read, asked = _reader(monkeypatch, "live")
    assert read(URL)[0] == ALIVE and asked == ["MTB72"]
    assert _reader(monkeypatch, "gone")[0](URL)[0] == DEAD
    assert _reader(monkeypatch, "unknown")[0](URL)[0] == UNKNOWN


def test_an_unknown_url_is_no_answer(monkeypatch):
    read, asked = _reader(monkeypatch, "live")
    assert read("https://almuteb.sa/property/not-ours/")[0] == UNKNOWN and asked == []


def test_the_score_uses_it(monkeypatch):
    from scrapers.common import dead_visible_score as D
    _reader(monkeypatch, "live")
    assert D.reader_for("almuteb", None)[0] == "site-reader"
