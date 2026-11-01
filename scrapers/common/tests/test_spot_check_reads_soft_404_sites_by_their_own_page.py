"""The double-check and the nightly dead-ads score must read soft-404 sites by their own page (2026-10-31).

A removed albukaeri ad answers HTTP 200 as an empty shell («  | البكيري», no property block), so the
status reader could only ever say "live": albukaeri, superoffice and azdad were scored status-only
every night (ops_dead_visible_score 10-31). lifecycle_spot_check._reader_for now reads albukaeri and
superoffice through their crawls' own run.read_own_page — the same answer their prune acts on.
Measured from CI 2026-10-31 (spot-check 41196333484 / 41196505860 / 41196530048, controls 5/5 live):
the 6 albukaeri and 15 superoffice ads the status reader had read «live» all read gone on their own page.
"""
from __future__ import annotations

from scrapers.common import http as H
from scrapers.common import db
from scrapers.common import lifecycle_spot_check as L
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN

SHELL = "<html><head><title>  | البكيري</title></head><body><main></main></body></html>"
LIVE = ('<html><head><title>فيلا للبيع | البكيري</title></head><body>'
        '<h1 class="prop-hero-title">فيلا للبيع في حي النرجس</h1></body></html>')
PID_DEAD, PID_LIVE = "a" * 24, "b" * 24


class _Resp:
    def __init__(self, code, text):
        self.status_code, self.text = code, text


class _Session:
    def get(self, url, timeout=None):
        return _Resp(200, SHELL if PID_DEAD in url else LIVE)


def _wire(monkeypatch, url_to_ad):
    monkeypatch.setattr(H, "retry_smarter_session", lambda base, timeout=40: (_Session(), []))

    class _Q:
        def __init__(self):
            self.url = None

        def eq(self, col, val):
            if col == "listing_url":
                self.url = val
            return self

        def execute(self):
            ad = url_to_ad.get(self.url)
            return type("R", (), {"data": [{"ad_number": ad}] if ad else []})()

        def __getattr__(self, _):
            return lambda *a, **k: self

    monkeypatch.setattr(db, "sb", lambda: type("C", (), {"table": lambda self, t: _Q()})())


def test_albukaeri_shell_is_dead_and_real_page_is_alive(monkeypatch):
    u_dead, u_live = f"https://albukaeri.sa/property/{PID_DEAD}", f"https://albukaeri.sa/property/{PID_LIVE}"
    _wire(monkeypatch, {u_dead: f"BKR{PID_DEAD}", u_live: f"BKR{PID_LIVE}"})
    read = L._reader_for("albukaeri")
    assert read is not None, "albukaeri must not fall back to the status-only reader"
    assert read(u_dead)[0] == DEAD
    assert read(u_live)[0] == ALIVE
    assert read("https://albukaeri.sa/property/unknown")[0] == UNKNOWN


def test_superoffice_has_its_own_reader(monkeypatch):
    _wire(monkeypatch, {})
    assert L._reader_for("superoffice") is not None


def test_dead_visible_score_uses_the_site_reader(monkeypatch):
    _wire(monkeypatch, {})
    from scrapers.common import dead_visible_score as D
    method, _ = D.reader_for("albukaeri", None)
    assert method == "site-reader"


def test_azdad_is_read_by_its_own_api(monkeypatch):
    from scrapers.azdad import run as az

    class _R:
        def __init__(self, data):
            self.status_code, self._d = 200, data

        def json(self):
            return self._d

    class _S:
        def get(self, url, params=None, timeout=None):
            ad = (params or {}).get("ad_number", "")
            if not ad:
                return _R([{"ad_number": "X"}])            # the catalogue is non-empty
            return _R([] if ad == "eq.AD-GONE" else [{"ad_number": ad[3:], "status": "متاح"}])

    monkeypatch.setattr(az, "session", lambda: _S())
    monkeypatch.setattr(az, "_throttle", lambda: None)
    _wire(monkeypatch, {"https://azdad.sa/property/1": "AD-GONE", "https://azdad.sa/property/2": "AD-LIVE"})
    read = L._reader_for("azdad")
    assert read is not None, "azdad must not fall back to the status-only reader"
    assert read("https://azdad.sa/property/1")[0] == DEAD
    assert read("https://azdad.sa/property/2")[0] == ALIVE
