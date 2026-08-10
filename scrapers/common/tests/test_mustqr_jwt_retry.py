"""Regression: mustqr's fetch_jwt must survive a transient discovery blip (2026-08-10 0-row runs).

mustqr.sa is a Vercel SPA; a redeploy swaps /assets/index-<hash>.js. Before this fix fetch_jwt had
NO retry, so a run that landed mid-deploy (bundle 404 / transient network blip) failed the WHOLE run
with 0 rows — the 2026-08-10 04:22 & 12:13 failures, while the source itself was healthy (1,144 live
listings, verified). This asserts fetch_jwt now retries, re-reads the LANDING page each attempt (so a
freshly-deployed bundle hash is picked up), and recovers — and that it still fails loudly if the
source is genuinely down.

Run: python -m pytest scrapers/common/tests/test_mustqr_jwt_retry.py -v
"""
from unittest.mock import MagicMock

import scrapers.mustqr.run as m


def _resp(text):
    r = MagicMock()
    r.text = text
    r.raise_for_status = MagicMock()
    return r


def test_fetch_jwt_retries_transient_then_recovers(monkeypatch):
    m._JWT = ""  # clear the in-process cache
    monkeypatch.setattr(m.time, "sleep", lambda *_a, **_k: None)  # skip real backoff

    LANDING = '<script type="module" src="/assets/index-NEWHASH1.js"></script>'
    BUNDLE = 'const KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.abc-DEF_123";'
    calls = {"n": 0}

    def fake_get(url, timeout=0):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient network blip on the first landing fetch")
        if url == m.SITE:
            return _resp(LANDING)  # 2nd attempt re-reads the landing page (new bundle hash)
        return _resp(BUNDLE)       # then the freshly-deployed bundle

    s = MagicMock()
    s.get.side_effect = fake_get

    jwt = m.fetch_jwt(s)
    assert jwt.startswith("eyJ") and jwt.count(".") == 2
    assert calls["n"] >= 3  # failed once, then landing + bundle succeeded
    m._JWT = ""  # don't leak the cache to other tests


def test_fetch_jwt_still_fails_loudly_when_source_down(monkeypatch):
    m._JWT = ""
    monkeypatch.setattr(m.time, "sleep", lambda *_a, **_k: None)
    s = MagicMock()
    s.get.side_effect = RuntimeError("source down")

    raised = False
    try:
        m.fetch_jwt(s)
    except RuntimeError as e:
        raised = True
        assert "after 3 attempts" in str(e)  # honest failure, not a silent 0-row run
    assert raised, "fetch_jwt must raise when discovery fails every attempt"
    m._JWT = ""
