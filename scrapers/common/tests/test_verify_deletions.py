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
        self._filters, self._limit = [], None
    def select(self, *a, **k): return self
    def eq(self, col, val): self._filters.append(("eq", col, val)); return self
    def gte(self, col, val): self._filters.append(("gte", col, val)); return self
    def in_(self, col, vals): self._filters.append(("in", col, list(vals))); return self
    def limit(self, n): self._limit = n; return self
    def insert(self, payload): self._op = ("insert", payload); return self
    def update(self, payload): self._op = ("update", payload); return self
    def _matches(self, row):
        for op, col, val in self._filters:
            v = row.get(col)
            if op == "eq" and v != val: return False
            if op == "gte" and not (v is not None and v >= val): return False
            if op == "in" and v not in val: return False
        return True
    def execute(self):
        if self._op and self._op[0] == "insert":
            self.c.inserted.setdefault(self.name, []).append(self._op[1]); return _Res([])
        matched = [r for r in self.c.rows.get(self.name, []) if self._matches(r)]
        if self._op and self._op[0] == "update":
            # Record (payload, matched rows) so a test can assert WHAT was written, not just that
            # something was — the verdict string is the whole point of the back-audit.
            self.c.updated.setdefault(self.name, []).append((self._op[1], matched))
            for r in matched:
                r.update(self._op[1])
            return _Res(matched)
        if self._limit is not None:
            matched = matched[:self._limit]
        return _Res(matched)


class _Client:
    def __init__(self, rows): self.rows, self.inserted, self.updated = rows, {}, {}
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


# ── Legacy back-audit (barrier 14 back-audit, 2026-08-24) ───────────────────────────────────────
# The failure this whole block exists to prevent: the retired aqar_cleanup path left 65 deleted rows
# whose only surviving source key is an ad_number, so their URL has to be BUILT. A built URL the
# platform does not serve 404s for a perfectly live listing, and a back-audit that trusted it would
# report "correctly deleted" about listings that are still on the market — the same manufactured
# certainty the legacy deleter itself produced. Calibration against known-live listings is what
# stands between those two outcomes, so each of its three outcomes is pinned here.

def _ba_row(i, ad="WST5761235", url=None, verdict="unaudited"):
    return {"id": i, "source_table": "wasalt_residential_listings", "listing_id": 1000 + i,
            "ad_number": ad, "listing_url": url, "verdict": verdict}


def test_build_probe_url_prefers_the_rows_own_url():
    assert V.build_probe_url("wasalt", "WST999999", "https://wasalt.sa/en/property/slug-999999") \
        == "https://wasalt.sa/en/property/slug-999999"


def test_build_probe_url_builds_from_ad_number_only_for_a_known_form():
    assert V.build_probe_url("wasalt", "WST5761235", None) == "https://wasalt.sa/en/property/5761235"
    # No registered URL form for the platform, or no digits to build from -> no probe, no verdict.
    assert V.build_probe_url("aqar", "6582689", None) is None
    assert V.build_probe_url("wasalt", "", None) is None
    assert V.build_probe_url("wasalt", None, None) is None


def _cal_client():
    return _Client({"wasalt_residential_listings": [
        {"id": 1, "ad_number": "WST111111", "listing_url": "https://wasalt.sa/en/property/a-111111",
         "active": True},
        {"id": 2, "ad_number": "WST222222", "listing_url": "https://wasalt.sa/en/property/b-222222",
         "active": True},
    ]})


def test_calibration_valid_when_the_built_form_serves_known_live_listings():
    form, detail = V.calibrate_url_form(_cal_client(), "wasalt",
                                        probe=lambda url: (200, "<html>live</html>"))
    assert form == "valid", (form, detail)
    assert detail["built_ok"] == detail["built_tested"] > 0


def test_calibration_invalid_when_built_urls_404_for_listings_that_are_actually_live():
    # The exact trap: real URLs serve, built URLs do not. Trusting the built form here would call
    # every back-audit row 'dead' on an artefact of our own URL construction.
    def probe(url):
        return (200, "ok") if "-" in url.rsplit("/", 1)[-1] else (404, "")
    form, _ = V.calibrate_url_form(_cal_client(), "wasalt", probe=probe)
    assert form == "invalid"


def test_calibration_unreachable_when_the_source_blocks_us():
    form, _ = V.calibrate_url_form(_cal_client(), "wasalt", probe=lambda url: (403, ""))
    assert form == "unreachable"


def test_calibration_unreachable_with_no_controls():
    form, detail = V.calibrate_url_form(_Client({}), "wasalt", probe=lambda url: (200, "ok"))
    assert form == "unreachable" and detail["controls"] == 0


def _run_legacy(monkeypatch, rows, probe, calibration):
    """run_legacy() against a fake client, with the network and the DB handle stubbed."""
    client = _Client({V.BACKAUDIT_TABLE: rows})
    monkeypatch.setattr(V, "sb", lambda: client)
    monkeypatch.setattr(V, "begin_run", lambda *a, **k: 1)
    monkeypatch.setattr(V, "end_run", lambda *a, **k: None)
    monkeypatch.setattr(V, "calibrate_url_form", lambda *a, **k: (calibration, {}))
    stats = V.run_legacy("wasalt", sample=10, probe=probe)
    return stats, client


def test_legacy_records_dead_only_when_the_url_form_is_calibrated(monkeypatch):
    stats, client = _run_legacy(monkeypatch, [_ba_row(1)], lambda url: (404, ""), "valid")
    assert (stats["dead"], stats["live"], stats["inconclusive"]) == (1, 0, 0)


def test_legacy_never_calls_a_row_dead_on_an_uncalibrated_built_url(monkeypatch):
    # Same 404, but the built form was never proven to work: the honest answer is 'inconclusive',
    # and the probe must not even be attempted.
    probed = []
    def probe(url):
        probed.append(url)
        return (404, "")
    stats, client = _run_legacy(monkeypatch, [_ba_row(1)], probe, "invalid")
    assert (stats["dead"], stats["live"], stats["inconclusive"]) == (0, 0, 1)
    assert probed == []
    assert client.updated[V.BACKAUDIT_TABLE][0][0]["verdict"] == "inconclusive"


def test_legacy_still_probes_a_row_that_kept_its_own_url_when_the_built_form_is_invalid(monkeypatch):
    stats, _ = _run_legacy(monkeypatch,
                           [_ba_row(1, url="https://wasalt.sa/en/property/kept-5761235")],
                           lambda url: (404, ""), "invalid")
    assert (stats["dead"], stats["inconclusive"]) == (1, 0)


def test_legacy_reports_a_live_row_as_a_false_deletion(monkeypatch):
    stats, client = _run_legacy(monkeypatch, [_ba_row(1)],
                                lambda url: (200, "<html>a real listing</html>"), "valid")
    assert stats["live"] == 1
    assert client.updated[V.BACKAUDIT_TABLE][0][0]["verdict"] == "live"


def test_legacy_treats_a_block_as_inconclusive_not_as_dead(monkeypatch):
    for status in (403, 429, 500, None):
        stats, _ = _run_legacy(monkeypatch, [_ba_row(1)], lambda url: (status, ""), "valid")
        assert (stats["dead"], stats["live"], stats["inconclusive"]) == (0, 0, 1), status


def test_legacy_never_reopens_a_settled_row(monkeypatch):
    # 'unverifiable_no_source_key' and 'dead'/'live' are settled; only open rows may be re-probed.
    rows = [_ba_row(1, verdict="unverifiable_no_source_key"), _ba_row(2, verdict="dead"),
            _ba_row(3, verdict="live"), _ba_row(4, verdict="inconclusive")]
    stats, _ = _run_legacy(monkeypatch, rows, lambda url: (404, ""), "valid")
    assert stats["candidates"] == 1          # only the 'inconclusive' one is retried


# ── "sampled 0" is two different facts (2026-08-30) ─────────────────────────────────────────────
# verify_deletions:aqar and verify_deletions:wasalt reported ok=False every week with
# "RC-B demoted ok=False: 0-row run (blocked/empty source?)". Nothing was blocked: cleanup:aqar and
# cleanup:wasalt were (correctly) aborting on their anomaly gate, so neither platform had EVER
# hard-deleted a row, so there was nothing to verify. RC-B cannot see that difference from
# rows_seen alone, and a job whose healthy state is indistinguishable from its broken state is
# decoration. These tests pin BOTH directions of the distinction.

def _run_with_log(monkeypatch, log_rows, platform="testp"):
    C.PLATFORMS.setdefault(platform, {"dead_marker": lambda b: b == "DEAD"})
    client = _Client({"cleanup_deletion_log": log_rows})
    calls = []
    monkeypatch.setattr(V, "sb", lambda: client)
    monkeypatch.setattr(V, "begin_run", lambda name: 1)
    monkeypatch.setattr(V, "end_run", lambda *a, **k: calls.append(k))
    monkeypatch.setattr(V, "classify", lambda rows, dm, probe=None:
                        [{**r, "verify_verdict": "dead", "http_status": 404} for r in rows])
    return V.run(platform), calls


def test_empty_deletion_window_is_healthy_not_a_blocked_source(monkeypatch):
    """No deletions logged → nothing to verify → the safest state this job can report. It must
    finalize ok=True AND opt out of RC-B explicitly, or rows_seen=0 demotes it right back."""
    stats, calls = _run_with_log(monkeypatch, [])
    assert stats["sampled"] == 0 and stats["window_total"] == 0
    assert calls[0]["ok"] is True
    assert calls[0]["allow_empty"] is True          # fails on the old code: RC-B demoted this run
    assert "nothing to verify" in calls[0]["notes"]
    assert "blocked" not in calls[0]["notes"]


def test_deletions_with_no_listing_url_stay_red_and_cannot_borrow_the_exemption(monkeypatch):
    """The other 'sampled 0': rows WERE deleted but none carries a listing_url, so none can ever
    be probed. That is a real defect and must NOT inherit the empty-window pass."""
    stats, calls = _run_with_log(monkeypatch, [_log_row(1, url=""), _log_row(2, url="   ")])
    assert stats["sampled"] == 0 and stats["window_total"] == 2
    assert calls[0]["ok"] is False
    assert calls[0].get("allow_empty") in (None, False)
    assert "unverifiable" in calls[0]["notes"]


def test_unverifiable_rows_are_counted_exactly_even_when_the_sample_caps(monkeypatch):
    """The url-less count is taken BEFORE sampling, so capping the sample can never make
    unverifiable deletions look like rows the sample merely didn't draw."""
    log = [_log_row(i) for i in range(100)] + [_log_row(500 + i, url="") for i in range(7)]
    stats, calls = _run_with_log(monkeypatch, log)
    assert stats["window_total"] == 107
    assert stats["sampled"] == 40                  # capped by the default sample size
    assert stats["unverifiable"] == 7              # exact, not 107 - 40
    assert calls[0]["ok"] is True and "unverifiable=7" in calls[0]["notes"]
