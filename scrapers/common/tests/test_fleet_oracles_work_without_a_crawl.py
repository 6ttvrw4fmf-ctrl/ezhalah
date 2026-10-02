"""The daily direct check (fleet_liveness.py) calls each site's oracle with an ad number and
nothing else. Two oracles needed something only their crawl had, so the check ran green and did
nothing: rakez raised on every call (controls 0/5 from 2026-09-29), sanadak withheld every removal
("no canary was supplied")."""
import pytest

from scrapers.rakez import run as R
from scrapers.sanadak import run as S


def test_rakez_oracle_reads_its_own_project_records_once_and_hands_them_on(monkeypatch):
    calls, got = [], {}
    monkeypatch.setattr(R, "session", lambda: "S")
    monkeypatch.setattr(R, "fetch_projects", lambda s, lang="": calls.append(lang) or {7: {"id": 7}})
    monkeypatch.setattr(R, "arabic_project_id", lambda s, en_id: 7)
    monkeypatch.setattr(R, "_verify_gone",
                        lambda ad, en, bridge: got.update(en=en, ar=bridge.get(7)) or ("live", "x"))
    verify = R._make_verify_gone(None)
    assert calls == [], "nothing is fetched until the first ad is asked about"
    assert verify("RKZ1") == ("live", "x") and verify("RKZ2") == ("live", "x")
    assert calls == ["", "ar"], "the project records are read once per run"
    assert got == {"en": {7: {"id": 7}}, "ar": {"id": 7}}


def test_rakez_oracle_is_unknown_when_the_project_records_cannot_be_read_whole(monkeypatch):
    monkeypatch.setattr(R, "session", lambda: "S")
    monkeypatch.setattr(R, "fetch_projects",
                        lambda s, lang="": R.INCOMPLETE.append("project[en] page 2 HTTP 503") or {7: {}})
    monkeypatch.setattr(R, "_verify_gone", lambda *a: pytest.fail("a partial read must not judge"))
    try:
        verdict, why = R._make_verify_gone(None)("RKZ1")
    finally:
        R.INCOMPLETE.clear()
    assert verdict == "unknown" and "HTTP 503" in why


def test_sanadak_oracle_takes_the_callers_control_as_its_canary():
    try:
        assert S._make_verify_gone({"ad_number": "A", "listing_url": "https://x/a"}) is S._verify_gone
        assert S._canary["urls"] == ["https://x/a"] and S._canary["verdict"] is None
        S._make_verify_gone(None)
        assert S._canary["urls"] == [], "no control, no canary: every removal stays withheld"
    finally:
        S.set_liveness_canaries([])
