"""2026-11-08: from 03:43 UTC every muktamel detail read failed as a bare «network_CertificateVerifyError»
(1,050 of 1,050 per shard). The class alone cannot tell an expired certificate from a wrong host or a missing
chain, so the run must carry the first MESSAGE of each failure class (rulebook lesson 10-13)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.muktamel import run as M  # noqa: E402


class CertificateVerifyError(Exception):
    pass


def test_a_failed_read_keeps_the_exceptions_own_words(monkeypatch):
    monkeypatch.setattr(M, "_outcomes", {})
    monkeypatch.setattr(M, "_first_error", {})
    monkeypatch.setattr(M.time, "sleep", lambda *_: None)

    class S:
        def get(self, *a, **k):
            raise CertificateVerifyError("curl: (60) SSL certificate problem: certificate has expired")

    monkeypatch.setattr(M, "_session", lambda: S())
    assert M.fetch_one(30001) is None
    assert M._outcomes == {"network_CertificateVerifyError": 1}
    assert "certificate has expired" in M._why()
    assert M.fetch_one(30002) is None                       # the first message is kept, the count grows
    assert M._outcomes["network_CertificateVerifyError"] == 2 and M._why().count("network_") == 1
