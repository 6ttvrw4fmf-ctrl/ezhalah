"""shomou: an index page 0 with no ad is a FAILED run that names what the page answered (2026-10-14,
backlog 533).

The 10-14 nightly (job 115679289482) read shomoalaqar.com.sa's index page 0 in 1.5 s on one pinned
profile, found no ad, and wrote ok=True with 0 rows that end_run's RC-B guard then demoted with no
reason («0-row run (blocked/empty source?)»), after seven nights of ~1,030 ads. main() now probes the
shared retry_smarter_session route and, when page 0 still holds no ad, records ok=False with the
status and size that page answered.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.shomou import run as S  # noqa: E402


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text, self.content = status, text, text.encode()

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Sess:
    def __init__(self, resp):
        self.resp = resp

    def get(self, url, **kw):
        return self.resp


def _run(monkeypatch, resp):
    runs: list[dict] = []
    monkeypatch.setattr(S, "retry_smarter_session", lambda url, **kw: (_Sess(resp), ["direct/chrome124:200"]))
    monkeypatch.setattr(S.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(S.db, "end_run", lambda rid, **kw: runs.append(kw) or True)
    monkeypatch.setattr(S.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["shomou"])
    return S.main(), runs


def test_a_200_shell_with_no_ad_fails_and_says_what_it_answered(monkeypatch):
    rc, runs = _run(monkeypatch, _Resp(200, "<html><body>maintenance</body></html>"))
    assert rc == 1
    assert len(runs) == 1 and runs[0]["ok"] is False
    assert "index page 0 held no ad" in runs[0]["notes"] and "answered 200" in runs[0]["notes"]
    assert "direct/chrome124:200" in runs[0]["notes"]


def test_a_refused_index_fails_with_its_status(monkeypatch):
    rc, runs = _run(monkeypatch, _Resp(503, "busy"))
    assert rc == 1 and runs[0]["ok"] is False and "503" in runs[0]["notes"]
