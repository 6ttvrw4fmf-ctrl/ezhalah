"""fursaghyr: a REST 401 rest_forbidden (post no longer public) is UNKNOWN; the ad's own page decides,
and only after a live control page answered 200 in the same run (2026-10-19).

FG27710 left the feed on 10-17 and sat at 3 strikes, shown, for three nights: every crawl read REST 401
→ UNKNOWN while its own page answered 404 (dead-visible 10-17, 10-18, 10-19).
"""
from __future__ import annotations

import pytest

from scrapers.fursaghyr import run as R

CONTROL = "https://fursaghyr.com/property/live/"
PAGE = "https://fursaghyr.com/property/gone/"


class _Resp:
    def __init__(self, status, body, url):
        self.status_code, self._body, self.url = status, body, url

    def json(self):
        return self._body


def _wire(monkeypatch, rest_status, rest_body, page_status, control_status=200, control=CONTROL):
    class _S:
        def get(self, url, **kw):
            if "/wp-json/" in url:
                return _Resp(rest_status, rest_body, url)
            if url == CONTROL:
                return _Resp(control_status, None, url)
            return _Resp(page_status, None, url)
    monkeypatch.setattr(R, "_stored_url", lambda ad: PAGE)
    monkeypatch.setattr(R, "_throttle", lambda: None)
    monkeypatch.setattr(R, "_CONTROL_URL", control)
    monkeypatch.setattr(R, "_control_ok", None)
    return _S()


FORBIDDEN = {"code": "rest_forbidden", "data": {"status": 401}}


def test_rest_401_then_own_page_404_is_gone(monkeypatch):
    s = _wire(monkeypatch, 401, FORBIDDEN, 404)
    assert R._verify_gone("FG27710", s)[0] == "gone"


def test_rest_401_then_own_page_200_stays_unknown(monkeypatch):
    s = _wire(monkeypatch, 401, FORBIDDEN, 200)
    assert R._verify_gone("FG27710", s)[0] == "unknown"


def test_rest_401_page_404_but_control_not_200_stays_unknown(monkeypatch):
    s = _wire(monkeypatch, 401, FORBIDDEN, 404, control_status=403)
    assert R._verify_gone("FG27710", s)[0] == "unknown", "a 404 without a live control proves nothing"


def test_rest_401_page_404_without_any_control_stays_unknown(monkeypatch):
    s = _wire(monkeypatch, 401, FORBIDDEN, 404, control=None)
    assert R._verify_gone("FG27710", s)[0] == "unknown"


def test_rest_publish_never_reads_the_page(monkeypatch):
    s = _wire(monkeypatch, 200, {"id": 27710, "status": "publish"}, 404)
    assert R._verify_gone("FG27710", s)[0] == "live", "REST stays the authority when it answers"


@pytest.mark.parametrize("status,body", [(403, {"code": "x"}), (401, {"code": "other"}), (500, {})])
def test_only_the_wordpress_401_shape_falls_back(monkeypatch, status, body):
    s = _wire(monkeypatch, status, body, 404)
    assert R._verify_gone("FG27710", s)[0] == "unknown"
