"""gathern sweep: a unit our chrome124 fingerprint is sent home on is re-read under a second
fingerprint, which may only say ALIVE (2026-10-30).

~90 served units read «transient» on every hourly sweep for 2-3 days: to chrome124 both /view/ and
/ar/view/ answered 307 -> /ar?error=500, while safari17_0, a plain client and a real Chromium opened
the same URLs named. These tests EXECUTE fingerprint_read() against stub sessions.
"""
from __future__ import annotations

from scrapers.gathern import liveness as gl

UNIT = "https://gathern.co/view/157698/unit/220652"
HOME = "https://gathern.co/ar?error=500"


class _R:
    def __init__(self, status, url, text):
        self.status_code, self.url, self.text = status, url, text


class _S:
    def __init__(self, status, final, text):
        self.r = _R(status, final, text)

    def get(self, *_a, **_k):
        return self.r


def _no_wait(monkeypatch):
    monkeypatch.setattr(gl, "_throttle", lambda *a, **k: None)


def test_named_own_page_under_second_fingerprint_is_alive(monkeypatch):
    _no_wait(monkeypatch)
    for final in (UNIT, "https://gathern.co/ar/view/157698/unit/220652"):
        alt = _S(200, final, "<h1>شاليه</h1> 220652")
        assert gl.fingerprint_read(0, alt, UNIT) == 200
        assert gl.fingerprint_read(gl.HOME_LANDED, alt, UNIT) == 200


def test_second_fingerprint_can_never_turn_a_unit_dead(monkeypatch):
    _no_wait(monkeypatch)
    for alt in (_S(404, UNIT, "الصفحة غير موجودة"), _S(410, UNIT, ""), _S(200, HOME, "home 220652"),
                _S(200, UNIT, "الصفحة غير موجودة 220652"), _S(200, UNIT, "names nothing"),
                _S(403, UNIT, "220652"), _S(500, UNIT, "220652")):
        got = gl.fingerprint_read(0, alt, UNIT)
        assert got == 0 and not gl.looks_dead(got)


def test_a_verdict_the_first_read_reached_is_never_second_guessed(monkeypatch):
    _no_wait(monkeypatch)
    live = _S(200, UNIT, "220652")
    gone = _S(404, UNIT, "الصفحة غير موجودة")
    assert gl.fingerprint_read(404, live, UNIT) == 404
    assert gl.fingerprint_read(410, live, UNIT) == 410
    assert gl.fingerprint_read(200, gone, UNIT) == 200
    assert gl.fingerprint_read(0, None, UNIT) == 0


def test_a_raising_second_read_is_no_verdict(monkeypatch):
    _no_wait(monkeypatch)

    class _Boom:
        def get(self, *_a, **_k):
            raise TimeoutError("slow")
    assert gl.fingerprint_read(0, _Boom(), UNIT) == 0


def test_the_sweep_actually_wires_the_second_read():
    import inspect
    src = inspect.getsource(gl.main)
    assert "fingerprint_read(" in src and "_alt_session()" in src
