"""gathern liveness probe: a 200 that is gathern's HOME page is no verdict, never "alive" (2026-10-06).

gathern answers a removed unit, for some request shapes, with 307 -> /ar?error=500 and the home page
serves 200 (cleanup lesson, 2026-10-05). The --recheck-dead pass restores a hidden unit on a 200, and
it runs every day from 2026-10-06 (gathern-recheck-dead.yml), so probe() must not hand it the home
page's 200. These tests EXECUTE probe() against a stub session.
"""
from __future__ import annotations

from scrapers.gathern import liveness as gl

UNIT = "https://gathern.co/view/146283/unit/276709"


class _R:
    def __init__(self, status, url):
        self.status_code, self.url = status, url


class _S:
    def __init__(self, status, final):
        self.r = _R(status, final)

    def get(self, *_a, **_k):
        return self.r


def _no_wait(monkeypatch):
    monkeypatch.setattr(gl, "_throttle", lambda *a, **k: None)
    monkeypatch.setattr(gl.time, "sleep", lambda *_: None)


def test_redirect_to_home_is_no_verdict(monkeypatch):
    _no_wait(monkeypatch)
    assert gl.probe(_S(200, "https://gathern.co/ar?error=500"), UNIT) == 0


def test_own_page_200_is_alive(monkeypatch):
    _no_wait(monkeypatch)
    assert gl.probe(_S(200, UNIT), UNIT) == 200


def test_real_404_is_kept(monkeypatch):
    _no_wait(monkeypatch)
    assert gl.probe(_S(404, UNIT), UNIT) == 404
