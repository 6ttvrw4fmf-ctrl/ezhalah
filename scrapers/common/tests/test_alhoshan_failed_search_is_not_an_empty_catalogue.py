"""2026-10-08: alhoshan's search API answered Cloudflare 502 on every try; fetch_page returned an empty
page and the run logged «None listings across 1 pages» — a failed fetch read as an empty catalogue.
A page that never answers 200 must raise with the status, and a real 200 with no items stays empty."""
import pytest

from scrapers.alhoshan import run


class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body


class _Session:
    def __init__(self, resp):
        self.resp, self.calls = resp, 0

    def post(self, *a, **k):
        self.calls += 1
        return self.resp


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(run.time, "sleep", lambda *_: None)
    monkeypatch.setattr(run, "_throttle", lambda: None)


def test_a_502_on_every_try_raises_with_the_status():
    s = _Session(_Resp(502))
    with pytest.raises(RuntimeError, match="HTTP 502"):
        run.fetch_page(s, 1)
    assert s.calls == 3


def test_a_real_empty_page_is_still_empty():
    items, meta = run.fetch_page(_Session(_Resp(200, {"data": {"items": []}, "meta": {"total": 0}})), 1)
    assert items == [] and meta == {"total": 0}
