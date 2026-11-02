"""Azdad: a removed ad's page answers 200 «غير موجود» — the site's own API retires it (2026-10-27).

prune_unseen refused (-1) and the 404-only fallback read the soft-404 pages live, so stale ads
(AD202509210002, AD202608180003, AD202610200001) stayed on screen. One ad is asked of the API.
"""
from __future__ import annotations

from scrapers.azdad import run as R


class _Resp:
    def __init__(self, status, body=None, bad_json=False):
        self.status_code, self._body, self._bad = status, body, bad_json

    def json(self):
        if self._bad:
            raise ValueError("not json")
        return self._body


class _S:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def get(self, url, params=None, timeout=None, **kw):
        assert url == R.API
        ad = (params or {}).get("ad_number", "").removeprefix("eq.")
        self.calls.append(ad)
        v = self.answers.get(ad)
        if v is None or isinstance(v, Exception):
            raise v or ConnectionError(ad)
        return v


def _live(ad):
    return _Resp(200, [{"ad_number": ad, "status": "متاح"}])


def _vg(monkeypatch, answers, controls=("ADLIVE",), catalogue_n=21):
    monkeypatch.setattr(R, "_throttle", lambda: None)
    s = _S({"ADLIVE": _live("ADLIVE"), **answers})
    return R.make_verify_gone(s, list(controls), catalogue_n), s


def test_no_row_reads_gone_while_the_catalogue_is_non_empty(monkeypatch):
    vg, _ = _vg(monkeypatch, {"AD202509210002": _Resp(200, [])})
    v, why = vg("AD202509210002")
    assert v == "gone" and "no row" in why


def test_no_row_with_an_empty_catalogue_is_unknown(monkeypatch):
    vg, _ = _vg(monkeypatch, {"AD202608180003": _Resp(200, [])}, catalogue_n=0)
    assert vg("AD202608180003")[0] == "unknown"


def test_sold_reads_gone_and_available_reads_live(monkeypatch):
    vg, _ = _vg(monkeypatch, {"ADSOLD": _Resp(200, [{"ad_number": "ADSOLD", "status": "مباع"}]),
                              "ADOK": _live("ADOK")})
    assert vg("ADSOLD")[0] == "gone"
    assert vg("ADOK")[0] == "live"


def test_errors_and_odd_answers_read_unknown(monkeypatch):
    vg, _ = _vg(monkeypatch, {
        "ADBOOM": ConnectionError("reset"), "AD403": _Resp(403), "AD503": _Resp(503),
        "ADBAD": _Resp(200, bad_json=True), "ADOBJ": _Resp(200, {"message": "x"}),
        "ADNEW": _Resp(200, [{"ad_number": "ADNEW", "status": "محجوز"}])})
    for ad in ("ADBOOM", "AD403", "AD503", "ADBAD", "ADOBJ", "ADNEW"):
        assert vg(ad)[0] == "unknown", ad


def test_control_not_live_turns_gone_into_unknown(monkeypatch):
    for control in (_Resp(200, []), _Resp(429), ConnectionError("down")):
        vg, _ = _vg(monkeypatch, {"AD202610200001": _Resp(200, []), "ADCTRL": control}, controls=("ADCTRL",))
        assert vg("AD202610200001")[0] == "unknown"
    vg, _ = _vg(monkeypatch, {"AD202610200001": _Resp(200, [])}, controls=())
    assert vg("AD202610200001")[0] == "unknown", "no control at all"


def test_control_is_asked_once_per_run(monkeypatch):
    vg, s = _vg(monkeypatch, {"ADA": _Resp(200, []), "ADB": _Resp(200, [])})
    assert vg("ADA")[0] == vg("ADB")[0] == "gone"
    assert s.calls.count("ADLIVE") == 1


def test_refused_prune_hands_the_unseen_ads_to_the_oracle(monkeypatch):
    calls = {}
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: -1)

    def fake_strike(tbl, seen, source, verify_gone=None, **kw):
        calls.update(tbl=tbl, seen=set(seen), source=source, vg=verify_gone, kw=kw)
        return 3
    monkeypatch.setattr(R.db, "strike_read_gone", fake_strike)
    vg = object()
    assert R.prune_table("azdad_residential_listings", {"ADA"}, vg) == 3
    assert calls["vg"] is vg and calls["source"] == "Azdad" and calls["seen"] == {"ADA"}
    assert "grace" not in calls["kw"], "the default 3 strikes are kept"


def test_a_normal_prune_does_not_ask_the_api(monkeypatch):
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **kw: 1)
    monkeypatch.setattr(R.db, "strike_read_gone",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not read")))
    assert R.prune_table("t", {"ADA"}, object()) == 1
