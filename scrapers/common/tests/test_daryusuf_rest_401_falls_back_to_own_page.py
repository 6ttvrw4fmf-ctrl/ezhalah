"""daryusuf: a REST 401 (post no longer public) is UNKNOWN; the ad's own page decides (2026-10-12).

DYS6824/6511/9414/7846 sat at 3-17 strikes, shown, because every run read REST 401 → UNKNOWN.
"""
from __future__ import annotations

from scrapers.daryusuf import run as R


class _Resp:
    def __init__(self, status, text, url):
        self.status_code, self.text, self.url, self.headers = status, text, url, {}


def _wire(monkeypatch, rest_status, rest_body, page_status):
    page_url = "https://daryusuf.com/portfolio/x/"

    class _S:
        def get(self, url, **kw):
            if "/wp-json/" in url:
                return _Resp(rest_status, rest_body, url)
            return _Resp(page_status, "<html>page</html>", url)
    monkeypatch.setattr(R, "session", lambda: _S())
    monkeypatch.setattr(R, "_stored_url", lambda ad: page_url)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None, raising=False)


def test_rest_401_then_own_page_404_is_gone(monkeypatch):
    _wire(monkeypatch, 401, '{"code":"rest_forbidden"}', 404)
    assert R._verify_gone("DYS6824")[0] == "gone"


def test_rest_401_then_own_page_200_stays_unknown(monkeypatch):
    _wire(monkeypatch, 401, '{"code":"rest_forbidden"}', 200)
    assert R._verify_gone("DYS6824")[0] == "unknown"


def test_rest_401_then_own_page_blocked_stays_unknown(monkeypatch):
    _wire(monkeypatch, 401, '{"code":"rest_forbidden"}', 403)
    assert R._verify_gone("DYS6824")[0] == "unknown"


def test_rest_live_never_reads_the_page(monkeypatch):
    _wire(monkeypatch, 200, '{"id": 6824, "status": "publish"}', 404)
    assert R._verify_gone("DYS6824")[0] == "live", "REST stays the authority when it answers"


def test_a_403_is_not_a_401(monkeypatch):
    _wire(monkeypatch, 403, '{"code":"x"}', 404)
    assert R._verify_gone("DYS6824")[0] == "unknown", "only the WordPress 401 shape falls back"
