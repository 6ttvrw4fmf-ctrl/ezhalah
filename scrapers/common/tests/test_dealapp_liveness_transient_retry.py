"""dealapp liveness: a dropped DB connection on one write is retried, not fatal to the run (2026-10-06).

The 2026-10-06 06:49 UTC `dealapp_liveness` run read 600 ads and then died on
`<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>` raised by ONE per-row
update, so the night's verdicts never all landed (scrape_runs ok=false). aqar learned the same lesson
on 2026-10-02 (test_aqar_liveness_transient_retry.py). These tests EXECUTE main() against a stub
client that raises the exact production text once per write, and prove every write still lands.
"""
from __future__ import annotations

import sys

import httpx
import pytest

from scrapers.common import db
from scrapers.common.liveness_contract import ALIVE, DEAD
from scrapers.dealapp import liveness_run as lr

TERMINATED = "<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>"


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    """A PostgREST-ish query whose execute() raises ConnectionTerminated the first time."""

    def __init__(self, client, kind, payload=None):
        self.client, self.kind, self.payload, self.filters, self.failed = client, kind, payload, [], False

    def __getattr__(self, name):          # select/eq/order/limit/in_/not_/is_ … all chain
        def chain(*a, **k):
            self.filters.append((name, a))
            return self
        return chain

    @property
    def not_(self):
        return self

    def execute(self):
        if self.client.flaky and not self.failed:
            self.failed = True
            raise httpx.RemoteProtocolError(TERMINATED)
        if self.kind == "select":
            return _Res(self.client.rows)
        if self.kind == "update":
            self.client.updates.append((self.payload, self.filters))
        return _Res([])


class _Table:
    def __init__(self, client):
        self.client = client

    def select(self, *_a, **_k):
        return _Q(self.client, "select")

    def update(self, payload):
        return _Q(self.client, "update", payload)

    def insert(self, payload):
        return _Q(self.client, "insert", payload)


class _Client:
    def __init__(self, rows, flaky):
        self.rows, self.flaky, self.updates = rows, flaky, []

    def table(self, _name):
        return _Table(self)


def _run(monkeypatch, flaky):
    rows = [{"id": i, "ad_number": f"D{i}", "listing_url": f"{lr.BASE}/ar/ad-details/{i}",
             "missing_count": 0, "last_verified_alive_at": "2026-10-05T00:00:00+00:00"}
            for i in range(1, 31)]
    client = _Client(rows, flaky)
    ended = {}
    monkeypatch.setattr(lr, "sb", lambda: client)
    monkeypatch.setattr(lr, "begin_run", lambda *_a, **_k: 1)
    monkeypatch.setattr(lr, "end_run", lambda *_a, **k: ended.update(k))
    monkeypatch.setattr(lr, "_session", lambda *_a, **_k: object())
    monkeypatch.setattr(lr, "harvest_sitemap_ids", lambda *_a, **_k: frozenset())
    # ids 1..28 live, 29..30 read dead: a trusted run (>= 25 probes) with two strikes to write.
    monkeypatch.setattr(lr, "probe_listing",
                        lambda _s, url, _b=None: (DEAD, 200) if url.endswith(("/29", "/30")) and "999999999" not in url
                        else ((DEAD, 200) if "999999999" in url else (ALIVE, 200)))
    monkeypatch.setattr(db.time, "sleep", lambda *_: None)
    monkeypatch.setattr(sys, "argv", ["liveness_run", "--limit", "30", "--apply"])
    rc = lr.main()
    return rc, client, ended


def test_one_dropped_connection_per_write_does_not_kill_the_run(monkeypatch):
    rc, client, ended = _run(monkeypatch, flaky=True)
    assert rc == 0 and ended.get("ok") is True, ended
    verified = [u for u, _f in client.updates if u.get("last_verified_alive_at")]
    struck = [u for u, _f in client.updates if u.get("missing_count") == 1 and "active" not in u]
    assert len(verified) == 28, len(verified)
    assert len(struck) == 2, len(struck)


def test_same_run_without_failures_writes_the_same(monkeypatch):
    rc, client, _ended = _run(monkeypatch, flaky=False)
    assert rc == 0
    assert sum(1 for u, _f in client.updates if u.get("last_verified_alive_at")) == 28


def test_never_probed_rows_are_read_before_sitemap_present_ones(monkeypatch):
    """Backlog #84 (2026-10-06): 567 active rows had never been opened, because sorting the window
    sitemap-present first cut the never-probed (sitemap-absent) rows off its end every run."""
    rows = ([{"id": i, "ad_number": f"D{i}", "listing_url": f"{lr.BASE}/ar/ad-details/{i}",
              "missing_count": 0, "last_verified_alive_at": None, "last_liveness_probe_at": None}
             for i in range(1, 6)]                                     # never probed, off-sitemap
            + [{"id": i, "ad_number": f"D{i}", "listing_url": f"{lr.BASE}/ar/ad-details/{i}",
                "missing_count": 0, "last_verified_alive_at": "2026-10-05T00:00:00+00:00",
                "last_liveness_probe_at": "2026-10-05T00:00:00+00:00"} for i in range(6, 41)])
    client = _Client(rows, flaky=False)
    read: list[str] = []
    monkeypatch.setattr(lr, "sb", lambda: client)
    monkeypatch.setattr(lr, "begin_run", lambda *_a, **_k: 1)
    monkeypatch.setattr(lr, "end_run", lambda *_a, **_k: None)
    monkeypatch.setattr(lr, "_session", lambda *_a, **_k: object())
    monkeypatch.setattr(lr, "harvest_sitemap_ids",
                        lambda *_a, **_k: frozenset(str(i) for i in range(6, 41)))
    monkeypatch.setattr(lr, "probe_listing", lambda _s, url, _b=None: read.append(url) or (ALIVE, 200))
    monkeypatch.setattr(sys, "argv", ["liveness_run", "--limit", "10"])
    assert lr.main() == 0
    worklist = [u.rsplit("/", 1)[1] for u in read if "999999999" not in u][-10:]
    assert {"1", "2", "3", "4", "5"} <= set(worklist), worklist
