"""Safety regression tests for the post-delete spot-check (barrier 11, scrapers/common/
verify_deletions.py). Same fake-client style as test_cleanup.py — no real DB, no network."""
from __future__ import annotations

import scrapers.common.verify_deletions as V
import scrapers.common.cleanup as C


class _Res:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, client, name):
        self.c, self.name, self._op = client, name, None
        self._filters = []
    def select(self, *a, **k): return self
    def eq(self, col, val): self._filters.append(("eq", col, val)); return self
    def gte(self, col, val): self._filters.append(("gte", col, val)); return self
    def insert(self, payload): self._op = ("insert", payload); return self
    def _matches(self, row):
        for op, col, val in self._filters:
            v = row.get(col)
            if op == "eq" and v != val: return False
            if op == "gte" and not (v is not None and v >= val): return False
        return True
    def execute(self):
        if self._op and self._op[0] == "insert":
            self.c.inserted.setdefault(self.name, []).append(self._op[1]); return _Res([])
        return _Res([r for r in self.c.rows.get(self.name, []) if self._matches(r)])


class _Client:
    def __init__(self, rows): self.rows, self.inserted = rows, {}
    def table(self, name): return _Table(self, name)


def _log_row(i, url="http://x/1", deleted_at="2026-08-20T00:00:00+00:00"):
    return {"id": i, "platform": "testp", "source_table": "testp_listings", "listing_id": i,
            "listing_url": url, "deleted_at": deleted_at}


def test_sample_recent_deletions_respects_platform_and_window():
    client = _Client({"cleanup_deletion_log": [
        _log_row(1, deleted_at="2026-08-20T00:00:00+00:00"),           # in window
        {**_log_row(2), "platform": "otherplatform"},                   # wrong platform
        _log_row(3, deleted_at="2026-01-01T00:00:00+00:00"),           # too old
        _log_row(4, url=""),                                            # no url — excluded
    ]})
    rows = V.sample_recent_deletions(client, "testp", days=30, sample=40)
    ids = {r["id"] for r in rows}
    assert ids == {1}, ids


def test_sample_caps_at_requested_size():
    client = _Client({"cleanup_deletion_log": [_log_row(i) for i in range(100)]})
    rows = V.sample_recent_deletions(client, "testp", days=30, sample=10)
    assert len(rows) == 10


def test_classify_flags_live_as_the_headline_finding():
    """The one verdict this whole script exists to surface: a deleted row's URL now serves live
    content — a false deletion."""
    rows = [_log_row(1)]
    out = V.classify(rows, dead_marker=lambda b: b == "DEAD", probe=lambda url: (200, "still for sale"))
    assert out[0]["verify_verdict"] == "live"


def test_classify_confirms_still_dead():
    rows = [_log_row(1)]
    out = V.classify(rows, dead_marker=lambda b: b == "DEAD", probe=lambda url: (404, ""))
    assert out[0]["verify_verdict"] == "dead"


def test_classify_reports_block_as_unknown_never_as_confirmation():
    """A 403/timeout on the SECOND check is just as inconclusive as it would be on the first —
    it must never be read as 'confirmed dead' just because the row is already gone."""
    for status in (403, 429, 503, None):
        rows = [_log_row(1)]
        out = V.classify(rows, dead_marker=lambda b: b == "DEAD", probe=lambda url, s=status: (s, ""))
        assert out[0]["verify_verdict"] == "unknown", f"status {status} must be unknown"


def test_run_writes_evidence_for_every_sampled_row():
    C.PLATFORMS["testp"] = {"tables": ["testp_listings"], "dead_marker": lambda b: b == "DEAD"}
    client = _Client({"cleanup_deletion_log": [
        _log_row(1, url="http://x/1"), _log_row(2, url="http://x/2"), _log_row(3, url="http://x/3")]})
    V.sb = lambda: client
    V.begin_run = lambda name: 1
    V.end_run = lambda *a, **k: True
    verdicts = {"http://x/1": (404, ""), "http://x/2": (200, "still for sale"), "http://x/3": (403, "")}
    V._probe = lambda url: verdicts[url]
    import scrapers.common.cleanup as C2
    C2._probe = lambda url: verdicts[url]
    stats = V.run("testp", days=30, sample=40)
    assert stats["sampled"] == 3 and stats["still_dead"] == 1 and stats["live"] == 1 and stats["unknown"] == 1
    logged = client.inserted.get("cleanup_deletion_verification", [])
    assert len(logged) == 1 and len(logged[0]) == 3          # one insert call, batch of 3 rows
    live_rows = [r for r in logged[0] if r["verdict"] == "live"]
    assert len(live_rows) == 1 and live_rows[0]["listing_id"] == 2


def test_run_skips_platforms_without_a_dead_marker():
    """Same default-deny posture as cleanup.py — a platform never registered for hard-delete has
    nothing to verify, and the run must say so rather than error or silently probe nothing."""
    C.PLATFORMS.pop("unregisteredp", None)
    client = _Client({"cleanup_deletion_log": [_log_row(1)]})
    V.sb = lambda: client
    calls = []
    V.begin_run = lambda name: 1
    V.end_run = lambda *a, **k: calls.append(k)
    stats = V.run("unregisteredp")
    assert stats["sampled"] == 0
    assert calls and calls[0]["ok"] is False
