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


# ── 2026-10-17: a LIVE unit gathern sends home on /view/ opens on /ar/view/ ──────────────────────
class _Route:
    """Answers per requested URL: {url: (status, final_url, body)}."""
    def __init__(self, table):
        self.table = table

    def get(self, url, *_a, **_k):
        st, final, body = self.table[url]
        r = _R(st, final)
        r.text = body
        return r


AR = "https://gathern.co/ar/view/146283/unit/276709"


def test_home_on_view_but_named_on_ar_view_is_alive(monkeypatch):
    _no_wait(monkeypatch)
    s = _Route({UNIT: (200, HOME, "home"), AR: (200, AR, "<h1>شاليه</h1> unit 276709")})
    assert gl.probe(s, UNIT) == 200


def test_ar_view_that_is_home_or_unnamed_or_a_soft_not_found_stays_no_verdict(monkeypatch):
    _no_wait(monkeypatch)
    for alt in ((200, AR, "الصفحة غير موجودة 276709"), (404, HOME, "الصفحة غير موجودة"),
                (200, HOME, "home 276709"), (200, AR, "a page that names nothing"),
                (403, AR, "الصفحة غير موجودة"), (500, AR, "")):
        assert gl.probe(_Route({UNIT: (200, HOME, "home"), AR: alt}), UNIT) == 0
        assert gl.probe(_Route({UNIT: (200, HOME, "home"), AR: alt}), UNIT,
                        home_status=gl.HOME_LANDED) == gl.HOME_LANDED


def test_ar_view_can_never_turn_a_unit_dead(monkeypatch):
    _no_wait(monkeypatch)
    s = _Route({UNIT: (200, HOME, "home"), AR: (404, AR, "")})
    assert not gl.looks_dead(gl.probe(s, UNIT))


# ── 2026-10-24 (backlog 800): the unit's own /ar/view/ 404 «الصفحة غير موجودة» is a reading ──────
def test_home_on_view_and_own_not_found_on_ar_view_is_a_404_reading(monkeypatch):
    """6 served units read «transient» every hour for 2 days while /ar/view/ answered gathern's own
    not-found page from CI and the cloud alike, so their 3rd strike never came. The sweep now takes
    that 404; the canary still only skips a home lander, never counts it."""
    _no_wait(monkeypatch)
    s = _Route({UNIT: (200, HOME, "home"), AR: (404, AR, "<h1>الصفحة غير موجودة</h1>")})
    assert gl.probe(s, UNIT) == 404 and gl.looks_dead(gl.probe(s, UNIT))
    assert gl.probe(s, UNIT, home_status=gl.HOME_LANDED) == gl.HOME_LANDED


def test_held_strikes_does_not_read_a_home_landing_as_live(monkeypatch):
    """10987196 was hidden on three own-page 404s (10-23 17:02) and revived by the 04:56 crawl,
    because held_strikes read its /view/ home landing (200) as the unit answering live."""
    import types
    stored = [{"ad_number": "GTH276709", "missing_count": 3, "active": False}]

    class _Q:
        def __getattr__(self, _n):
            return lambda *a, **k: self

        def execute(self):
            return types.SimpleNamespace(data=stored)
    monkeypatch.setattr(gr.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q()))
    monkeypatch.setattr(gr._probe, "fetch", lambda url: (200, "<html>home</html>", True))
    monkeypatch.setattr(gr, "_oracle_session", lambda: _Route({AR: (404, AR, "الصفحة غير موجودة")}))
    _no_wait(monkeypatch)
    rows = [{"ad_number": "GTH276709", "listing_url": UNIT}]
    assert gr.held_strikes(rows) == {"GTH276709": (3, False)}
    # ... and a unit that lands home on /view/ but opens named on /ar/view/ is released
    monkeypatch.setattr(gr, "_oracle_session", lambda: _Route({AR: (200, AR, "unit 276709")}))
    assert gr.held_strikes(rows) == {}


def test_crawl_canary_does_not_count_a_home_landing_as_a_live_control(monkeypatch):
    monkeypatch.setattr(gr._probe, "fetch", lambda url: (200, "<html>home</html>", True))
    monkeypatch.setattr(gr, "_oracle_url_for", lambda ad: UNIT)
    gr.arm_liveness_canaries(["GTH276709", "GTH2", "GTH3"])
    ok, why = gr._canary()
    assert not ok, why
