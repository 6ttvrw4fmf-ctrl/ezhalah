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


# ── 2026-10-08: the Nuzul tenants (goldendeal engine) ───────────────────────────────────────────
# goldendeal, maqam and yameen built their oracle only inside the crawl (verify_gone_for +
# make_canary with an id that run mapped), so the daily check could not call them: 345 ads, 0 checked
# in time. `_make_verify_gone(control)` is that same pair, the control row becoming the canary.
import json as _json

from scrapers.common import fleet_liveness as F
from scrapers.goldendeal import run as G


class _R:
    def __init__(self, status, body, url):
        self.status_code, self.text, self.url = status, body, url

    def json(self):
        return _json.loads(self.text)


def _stub(answers):
    """A session whose GET answers per record id; records which hosts/headers were used."""
    seen = []

    class _S:
        headers = {}

        def get(self, url, timeout=None, allow_redirects=True):
            pid = int(url.rsplit("/", 1)[1])
            seen.append(url)
            status, data = answers[pid]
            body = _json.dumps({"data": data}) if status == 200 else '{"message":"No query results for model"}'
            return _R(status, body, url)
    return (lambda: _S()), seen


LIVE = {"availability_status": "available", "published_on_website": 1}


@pytest.mark.parametrize("site", ["goldendeal", "maqam", "yameen"])
def test_nuzul_tenant_is_callable_by_the_daily_check_with_only_a_control_row(site):
    assert F.SITES[site] == f"scrapers.{site}.run:_make_verify_gone()"
    mod = __import__(f"scrapers.{site}.run", fromlist=["_make_verify_gone"])
    assert callable(mod._make_verify_gone(None)), "the daily check hands a control row or None"


def test_nuzul_oracle_reads_live_gone_and_withholds_without_its_control():
    p = G.TENANT.prefix
    sf, seen = _stub({1: (200, {"id": 1, **LIVE}), 2: (404, None),
                      3: (200, {"id": 3, "availability_status": "sold"}), 9: (200, {"id": 9, **LIVE})})
    verify = G.make_verify_gone(G.TENANT, sf)({"ad_number": f"{p}9"})
    assert verify(f"{p}1")[0] == "live"
    assert verify(f"{p}2")[0] == "gone"                 # the record's own 404, control 9 echoed
    assert verify(f"{p}3")[0] == "gone"                 # retired in place («sold»)
    assert all(G.TENANT.api_host in u for u in seen)
    # no control row: a live answer still stands, but no removal can be testified
    blind = G.make_verify_gone(G.TENANT, sf)(None)
    assert blind(f"{p}1")[0] == "live" and blind(f"{p}2")[0] == "unknown"
    # a control from another site's numbering is no control
    assert G.make_verify_gone(G.TENANT, sf)({"ad_number": "XYZ9"})(f"{p}2")[0] == "unknown"


def test_nuzul_oracle_withholds_removal_when_the_control_no_longer_echoes():
    p = G.TENANT.prefix
    sf, _ = _stub({2: (404, None), 9: (404, None)})
    verdict, why = G.make_verify_gone(G.TENANT, sf)({"ad_number": f"{p}9"})(f"{p}2")
    assert verdict == "unknown" and "withheld" in why
