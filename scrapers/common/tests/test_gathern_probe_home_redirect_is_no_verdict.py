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


# ── 2026-10-08: the crawl's prune oracle and the sweep's controls learn the same thing ───────────
from scrapers.common import http_liveness  # noqa: E402
from scrapers.gathern import run as gr  # noqa: E402

HOME = "https://gathern.co/ar?error=500"


class _RT(_R):
    def __init__(self, status, url, text="<html>" + "x" * 3000 + "</html>"):
        super().__init__(status, url)
        self.text = text


def test_prune_oracle_reads_a_home_landing_as_no_verdict_never_live(monkeypatch):
    """On 2026-10-08 the cross-shard prune 'self-healed' 18 feed-missing units whose page lands home
    as verified alive; they became the sweep's controls and quarantined it all day."""
    assert gr._oracle_signal(200, "<html/>", True) is None
    assert gr._oracle_signal(200, "<html/>", False) == "live"
    assert gr._oracle_signal(404, "<html/>", True) == "gone"
    monkeypatch.setattr(gr, "_oracle_session", lambda: type("S", (), {"get": lambda self, *a, **k: _RT(200, HOME)})())
    monkeypatch.setattr(gr.time, "sleep", lambda *_: None)
    probe = gr._GathernProbe(platform="gathern", signal=gr._oracle_signal, session=gr._oracle_session,
                             url_for=lambda _ad: UNIT, canary=lambda: (True, "ok"), backoff=0)
    assert probe.fetch(UNIT)[2] is True
    assert probe.verify_gone("GTH276709")[0] == "unknown"
    # a locale prefix on the unit's own page is still that page
    own = lambda: type("S", (), {"get": lambda self, *a, **k: _RT(200, "https://gathern.co/ar/view/146283/unit/276709")})()  # noqa: E731
    probe2 = gr._GathernProbe(platform="gathern", signal=gr._oracle_signal, session=own,
                              url_for=lambda _ad: UNIT, canary=lambda: (True, "ok"), backoff=0)
    assert probe2.verify_gone("GTH276709")[0] == "live"


def _canary_world(monkeypatch, answers):
    """answers: url -> final url (200) or an int status."""
    _no_wait(monkeypatch)
    rows = [{"listing_url": u} for u in answers]
    monkeypatch.setattr(gl, "_collect_canaries", lambda client, limit: rows[:limit])

    class _S2:
        def get(self, url, **_k):
            a = answers[url]
            return _R(a, url) if isinstance(a, int) else _R(200, a)
    return _S2()


def test_sweep_controls_skip_home_landers_and_read_the_next(monkeypatch):
    answers = {f"https://gathern.co/view/1/unit/{i}": HOME for i in range(8)}
    answers.update({f"https://gathern.co/view/1/unit/{i}": f"https://gathern.co/view/1/unit/{i}" for i in range(8, 30)})
    ok, alive, probed, hist = gl._run_canary(_canary_world(monkeypatch, answers), None, 10)
    assert (ok, alive, probed) == (True, 10, 10) and "homex8" in hist


def test_sweep_controls_all_home_fail_closed(monkeypatch):
    answers = {f"https://gathern.co/view/1/unit/{i}": HOME for i in range(40)}
    ok, alive, probed, _ = gl._run_canary(_canary_world(monkeypatch, answers), None, 10)
    assert (ok, alive, probed) == (False, 0, 0)


def test_sweep_controls_a_404_block_still_fails(monkeypatch):
    answers = {f"https://gathern.co/view/1/unit/{i}": 404 for i in range(40)}
    ok, _alive, probed, _ = gl._run_canary(_canary_world(monkeypatch, answers), None, 10)
    assert not ok and probed == 10
