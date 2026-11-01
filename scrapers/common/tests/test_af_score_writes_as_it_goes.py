"""af_score writes each website's row as soon as it is scored (🔬 AF engineer, 2026-10-11).

The 08:00 UTC run of 2026-10-11 (GitHub run 38123261369) hit the job's 60-minute timeout and was cancelled
before main()'s single write at the end, so ops_af_score had NO rows for that night and the fleet score was
blind. Here the run is killed after two websites, the way a timeout kills it: the two finished websites must
already be in the table.
"""
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import af_score as S  # noqa: E402


class Killed(BaseException):
    pass


def test_a_run_killed_midway_keeps_the_websites_it_finished(monkeypatch):
    written: list[str] = []
    monkeypatch.setattr(S, "sb", lambda: object())
    monkeypatch.setattr(S, "anon_client", lambda: object())
    monkeypatch.setattr(S, "older_listings", lambda client: {p: [("t", 1)] for p in ("a", "b", "c")})

    def score_site(client, anon, p, picks, *, night, pace):
        if p == "c":
            raise Killed()          # the runner's cancel arrives in the middle of the third website
        return S.new_row(night, p)

    monkeypatch.setattr(S, "score_site", score_site)
    monkeypatch.setattr(S, "write_rows", lambda client, rows: written.extend(r["platform"] for r in rows) or "ok")
    monkeypatch.setattr(sys, "argv", ["af_score"])
    with pytest.raises(Killed):
        S.main()
    assert written == ["a", "b"]


def test_a_dry_run_writes_nothing(monkeypatch):
    written: list[str] = []
    monkeypatch.setattr(S, "sb", lambda: object())
    monkeypatch.setattr(S, "anon_client", lambda: object())
    monkeypatch.setattr(S, "older_listings", lambda client: {"a": [("t", 1)]})
    monkeypatch.setattr(S, "score_site", lambda client, anon, p, picks, *, night, pace: S.new_row(night, p))
    monkeypatch.setattr(S, "write_rows", lambda client, rows: written.extend(r["platform"] for r in rows) or "ok")
    monkeypatch.setattr(sys, "argv", ["af_score", "--dry-run"])
    S.main()
    assert written == []
