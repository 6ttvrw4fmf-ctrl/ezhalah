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


# mustqr (2026-10-08): its oracle reads module state the crawl arms; the daily check arms it itself.
from scrapers.mustqr import run as M


def _mustqr(monkeypatch, table, jwt="eyJ.a.b"):
    M.set_liveness_oracle(None, "", [])
    monkeypatch.setattr(M, "session", lambda: "S")
    if isinstance(jwt, Exception):
        monkeypatch.setattr(M, "fetch_jwt", lambda s: (_ for _ in ()).throw(jwt))
    else:
        monkeypatch.setattr(M, "fetch_jwt", lambda s: jwt)
    monkeypatch.setattr(M, "_oracle_fetch", lambda pid: (200, table.get(pid, [])))


def test_mustqr_oracle_is_armed_by_the_daily_check_with_its_control_as_canary(monkeypatch):
    assert F.SITES["mustqr"] == "scrapers.mustqr.run:_make_verify_gone()"
    _mustqr(monkeypatch, {"9": [{"id": 9, "status": "متاح"}], "1": [{"id": 1, "status": "متاح"}],
                          "3": [{"id": 3, "status": "مؤجر"}]})
    verify = M._make_verify_gone({"ad_number": "MQ9"})
    assert verify("MQ1")[0] == "live"
    assert verify("MQ3")[0] == "gone"                         # retired in place, control 9 available
    assert verify("MQ4")[0] == "gone"                         # no longer in the source's table
    assert M._oracle["canary_pids"] == ["9"] and M._oracle["jwt"] == "eyJ.a.b"


def test_mustqr_without_a_control_or_a_key_removes_nothing(monkeypatch):
    # 9 is available at the source: only a control the CALLER handed in may vouch for a removal
    _mustqr(monkeypatch, {"1": [{"id": 1, "status": "متاح"}], "9": [{"id": 9, "status": "متاح"}]})
    blind = M._make_verify_gone(None)
    assert blind("MQ1")[0] == "live" and blind("MQ4")[0] == "unknown"
    _mustqr(monkeypatch, {}, jwt=RuntimeError("bundle moved"))
    v, why = M._make_verify_gone({"ad_number": "MQ9"})("MQ4")
    assert v == "unknown" and "JWT" in why


# shatri (2026-10-08): its oracle needs the label taxonomy only the crawl read.
from scrapers.shatri import run as SH


def _shatri(monkeypatch, labels, posts, fail=None):
    monkeypatch.setattr(SH, "retry_smarter_session", lambda *a, **k: ("S", []))

    def terms(s):
        if fail:
            raise fail
        return {"property_label": labels}
    monkeypatch.setattr(SH, "fetch_terms", terms)

    class _P:
        def __init__(self, platform, signal, session, url_for, **k):
            self.signal, self.url_for = signal, url_for

        def verify_gone(self, ad):
            status, body = posts[int(self.url_for(ad).rsplit("/", 1)[1])]
            v = self.signal(status, _json.dumps(body), False)
            return (v, "x") if v else ("unknown", "x")
    monkeypatch.setattr(SH, "LivenessProbe", _P)


def test_shatri_is_callable_by_the_daily_check_and_reads_sold_labels(monkeypatch):
    assert F.SITES["shatri"] == "scrapers.shatri.run:_fleet_verify_gone()"
    _shatri(monkeypatch, {7: SH.SOLD_LABEL},
            {1: (200, {"id": 1, "status": "publish", "property_label": []}),
             2: (200, {"id": 2, "status": "publish", "property_label": [7]}),
             3: (404, {"code": "rest_post_invalid_id"})})
    verify = SH._fleet_verify_gone(None)
    assert [verify(f"SHT{i}")[0] for i in (1, 2, 3)] == ["live", "gone", "gone"]


def test_shatri_without_a_readable_sold_label_answers_nothing(monkeypatch):
    posts = {2: (200, {"id": 2, "status": "publish", "property_label": [7]})}
    _shatri(monkeypatch, {7: "مميز"}, posts)                  # «تم البيع» no longer in the taxonomy
    assert SH._fleet_verify_gone(None)("SHT2")[0] == "unknown"
    _shatri(monkeypatch, {}, posts, fail=RuntimeError("/wp/v2/property_label → HTTP 403"))
    assert SH._fleet_verify_gone(None)("SHT2")[0] == "unknown"


# aqalemhajer (2026-10-08): its oracle took the crawl's own live node id as the canary.
from scrapers.aqalemhajer import run as AQH


def _aqh(monkeypatch, pages):
    class _S:
        def get(self, url, **_k):
            nid = url.rstrip("/").rsplit("/", 1)[1] if url.rstrip("/") != AQH.BASE else ""
            status, live = pages.get(nid, (404, False))
            body = (f'<html data-history-node-id="{nid}"><h1>شقة</h1>' if live else "<html>") + "x" * 3000
            return _R(status, body, url)
    monkeypatch.setattr(AQH, "session", lambda: _S())
    monkeypatch.setattr(AQH, "parse_detail", lambda body: {"title": "شقة", "fields": {}})
    import scrapers.common.http_liveness as HL
    monkeypatch.setattr(HL.time, "sleep", lambda *_: None)


def test_aqalemhajer_is_callable_by_the_daily_check_with_its_control_as_canary(monkeypatch):
    assert F.SITES["aqalemhajer"] == "scrapers.aqalemhajer.run:_make_verify_gone()"
    _aqh(monkeypatch, {"9": (200, True), "1": (200, True), "2": (404, False)})
    p = AQH.PREFIX
    verify = AQH._make_verify_gone({"ad_number": f"{p}9"})
    assert verify(f"{p}1")[0] == "live" and verify(f"{p}2")[0] == "gone"
    # no control: a live page still reads live, but no removal is believed
    blind = AQH._make_verify_gone(None)
    assert blind(f"{p}1")[0] == "live" and blind(f"{p}2")[0] == "unknown"
