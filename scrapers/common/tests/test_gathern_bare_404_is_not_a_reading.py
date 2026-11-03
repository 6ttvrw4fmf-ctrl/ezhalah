"""gathern liveness: a 404 that is NOT gathern's own not-found page is no reading (2026-11-03).

Unit 10218 (row 21137745) read 404 at 2026-11-03 00:06 while it was live in a real browser and in
the feed five hours later. gathern's real removal answer is a 404 whose server-rendered body says
«الصفحة غير موجودة» (measured on unit 145583 that day). probe() now takes a 404/410 only with that
page; a bare one is re-read on the unit's /ar/view/ address, where only a named 200 or the not-found
page counts. These tests EXECUTE probe() against stub sessions.
"""
from __future__ import annotations

from scrapers.gathern import liveness as gl

UNIT = "https://gathern.co/view/5995/unit/10218"
AR = "https://gathern.co/ar/view/5995/unit/10218"
NOT_FOUND = "<html><h1>الصفحة غير موجودة</h1></html>"


class _R:
    def __init__(self, status, url, text=""):
        self.status_code, self.url, self.text = status, url, text


class _Seq:
    """Answers each get() with the next response; records the URLs asked."""
    def __init__(self, *answers):
        self.answers, self.asked = list(answers), []

    def get(self, url, *_a, **_k):
        self.asked.append(url)
        return self.answers.pop(0)


def _no_wait(monkeypatch):
    monkeypatch.setattr(gl, "_throttle", lambda *a, **k: None)
    monkeypatch.setattr(gl.time, "sleep", lambda *_: None)


def test_not_found_page_404_is_gone(monkeypatch):
    _no_wait(monkeypatch)
    s = _Seq(_R(404, UNIT, NOT_FOUND))
    assert gl.probe(s, UNIT) == 404
    assert s.asked == [UNIT]                       # no second read needed


def test_bare_404_then_unit_opens_is_alive(monkeypatch):
    """The 21137745 shape: a bare 404 on /view/, the unit's own /ar/view/ opens and names it."""
    _no_wait(monkeypatch)
    s = _Seq(_R(404, UNIT, "<html>" + "x" * 500 + "</html>"), _R(200, AR, "<html>unit 10218</html>"))
    assert gl.probe(s, UNIT) == 200
    assert s.asked == [UNIT, AR]


def test_bare_404_then_not_found_page_is_gone(monkeypatch):
    _no_wait(monkeypatch)
    s = _Seq(_R(404, UNIT, ""), _R(404, AR, NOT_FOUND))
    assert gl.probe(s, UNIT) == 404


def test_bare_404_twice_is_no_verdict(monkeypatch):
    """Neither read is the unit's not-found page: a strike would be a guess, so 0 (UNKNOWN)."""
    _no_wait(monkeypatch)
    for second in (_R(404, AR, "blocked"), _R(410, AR, ""), _R(200, "https://gathern.co/ar?error=500", "home"),
                   _R(200, AR, "names nothing")):
        s = _Seq(_R(404, UNIT, "<html>blocked</html>"), second)
        assert gl.probe(s, UNIT) == 0, second.__dict__


def test_bare_410_is_treated_like_bare_404(monkeypatch):
    _no_wait(monkeypatch)
    s = _Seq(_R(410, UNIT, ""), _R(403, AR, ""))
    assert gl.probe(s, UNIT) == 0


def test_canary_control_reading_bare_404_still_fails_the_controls(monkeypatch):
    """A control that reads 0 is counted as probed-but-not-alive: the all-controls gate stays closed."""
    assert gl.controls_all_alive(9, 10, 10, 10) is False
