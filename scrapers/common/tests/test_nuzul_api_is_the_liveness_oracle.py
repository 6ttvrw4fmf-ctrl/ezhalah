"""aldarim: the Nuzul API is the per-listing liveness oracle (owner 2026-10-20).

Measured: ten aldarim ads the API marked availability_status «unavailable» stayed active 6–15 days and were
served with a district border — the crawl skipped them and the page probe still answered 200. The API's own
answer (404, or availability_status) is the source's direct verdict; a failed fetch stays UNKNOWN.
"""
from pathlib import Path

import scrapers.aldarim.run as A

ROOT = Path(__file__).resolve().parents[3]


class _R:
    def __init__(self, status, body=None):
        self.status_code, self._b = status, body

    def json(self):
        if self._b is None:
            raise ValueError("no json")
        return self._b


class _S:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def get(self, url, timeout=30):
        self.calls.append(url)
        a = self.answers[url.rsplit("/", 1)[1]]
        if isinstance(a, Exception):
            raise a
        return a


def _wire(mod, monkeypatch, answers):
    s = _S(answers)
    monkeypatch.setattr(mod, "_ORACLE_S", s)
    return s


def test_api_404_is_gone_unavailable_is_gone_available_is_live_failure_is_unknown(monkeypatch):
    s = _wire(A, monkeypatch, {
        "1": _R(404), "2": _R(200, {"data": {"availability_status": "unavailable"}}),
        "3": _R(200, {"availability_status": "available"}), "4": _R(500), "5": ConnectionError("boom"),
        "6": _R(200, None)})
    assert A._api_verify_gone("ALD1")[0] == "gone"
    assert A._api_verify_gone("ALD2") == ("gone", "source API availability_status=unavailable")
    assert A._api_verify_gone("ALD3")[0] == "live"
    assert A._api_verify_gone("ALD4")[0] == "unknown"
    assert A._api_verify_gone("ALD5")[0] == "unknown"
    assert A._api_verify_gone("ALD6")[0] == "unknown"
    assert A._api_verify_gone("XYZ7")[0] == "unknown"          # not this tenant's ad number → no request
    assert all(u.startswith(A.API + "/") for u in s.calls)


def test_an_item_the_crawl_saw_as_unavailable_is_gone_without_a_request(monkeypatch):
    s = _wire(A, monkeypatch, {})
    A._SOURCE_UNAVAILABLE.add("ALD42")
    try:
        assert A._api_verify_gone("ALD42")[0] == "gone"
        assert s.calls == []
    finally:
        A._SOURCE_UNAVAILABLE.discard("ALD42")


def test_aldarim_asks_the_api_before_the_page_probe(monkeypatch):
    monkeypatch.setattr(A, "_api_verify_gone", lambda ad: ("gone", "api"))
    monkeypatch.setattr(A._probe, "verify_gone", lambda ad: ("live", "page 200"))
    assert A._verify_gone("ALD9")[0] == "gone"
    monkeypatch.setattr(A, "_api_verify_gone", lambda ad: ("unknown", "api down"))
    assert A._verify_gone("ALD9") == ("live", "page 200")


def test_aldarim_records_unavailable_items_and_hands_the_oracle_to_prune():
    text = (ROOT / "scrapers" / "aldarim" / "run.py").read_text(encoding="utf-8")
    assert "_SOURCE_UNAVAILABLE.add(f\"{_AD_PREFIX}{L.get('id')}\")" in text
    assert "verify_gone=_verify_gone)" in text


def test_aldarim_strikes_the_apis_unavailable_items_at_grace_one():
    # owner 2026-10-20 «once we see it, remove it»
    text = (ROOT / "scrapers" / "aldarim" / "run.py").read_text(encoding="utf-8")
    assert 'db.strike_read_gone(tbl, set(seen_ads), "Aldarim", verify_gone=_verify_gone, grace=1)' in text
    import inspect
    import scrapers.common.db as DB
    sig = inspect.signature(DB.strike_read_gone)
    assert sig.parameters["grace"].default == 3          # every other caller unchanged
