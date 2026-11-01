"""aqar liveness: a TRANSIENT on the evidence insert must not orphan the hide (2026-10-02).

Evidence-before-hide only holds if the ledger insert is retried like the hide is. Without the retry
a single ConnectionTerminated on the insert was swallowed as best-effort, the buffer cleared, and the
hide then landed via _run_with_retry — a hide with no kill row, the exact bug the reorder targets."""
import sys
import scrapers.aqar.liveness as L
from scrapers.common.tests.test_aqar_liveness_sweeps_aqarmonthly import _Client, _Resp, _row

TABLE = "aqar_residential_listings"
LEDGER = "aqar_liveness_detail"

class _LedgerBlipsOnce(_Client):
    def __init__(self, rows):
        super().__init__(rows); self.ledger_calls = 0
    def table(self, t):
        q = super().table(t); real = q.execute
        def execute():
            if q.op and q.op[0] == "insert" and t == LEDGER:
                self.ledger_calls += 1
                if self.ledger_calls == 1:
                    raise RuntimeError("httpx.RemoteProtocolError: <ConnectionTerminated error_code:0>")
            return real()
        q.execute = execute; return q

def test_a_transient_on_the_ledger_insert_still_evidences_the_hide(monkeypatch):
    client = _LedgerBlipsOnce({TABLE: [_row(1, "https://sa.aqar.fm/gone-1", mc=2)]})
    monkeypatch.setattr(L, "sb", lambda: client)
    monkeypatch.setattr(L, "begin_run", lambda name: 1)
    monkeypatch.setattr(L, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(L, "reconcile_orphaned_stubs", lambda *a, **k: 0)
    monkeypatch.setattr(L.time, "sleep", lambda *_: None)
    monkeypatch.setattr(L, "get", lambda url, **k: _Resp(404) if 404 in k.get("keep", ()) else None)
    monkeypatch.setattr(sys, "argv", ["liveness", "--table", TABLE, "--shards", "1", "--shard", "0"])
    L.main()
    row = client.rows[TABLE][0]
    kills = [e for e in client.inserted.get(LEDGER, []) if e["listing_id"] == 1 and e["verdict"] == "kill"]
    assert row["active"] is False
    assert kills, "ORPHAN: hidden, no kill row (ledger insert hit a transient once, hide retried fine)"
    assert client.ledger_calls == 2, "the insert was retried once, not abandoned"
