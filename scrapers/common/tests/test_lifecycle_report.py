"""The report's numbers are the rulebook's lines applied as data (docs/ops/LIFECYCLE_ENGINEER.md,
"Report"). Hermetic: a fake PostgREST client serves canned rows; no network, no git.

What breaks if the logic breaks: a site sorted out of most-hidden order, "The other N" not summing
to every site, a site with no deletion path reading 0 instead of n/a, a failed job or an open
lifecycle alert not turning its site ❌, a RECHECK folded into the daily run, an unreadable table
rendering as 0, or a PR's merge state read from the wrong place.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from scrapers.common import lifecycle_report as LR

NOW = datetime(2026, 10, 3, 11, 0, tzinfo=timezone.utc)


def _t(h):
    return (NOW - timedelta(hours=h)).isoformat()


class _Q:
    def __init__(self, rows):
        self.rows, self._lo, self._hi, self._lim = list(rows), None, None, None

    def select(self, *a, **k): return self
    def eq(self, c, v): self.rows = [r for r in self.rows if r.get(c) == v]; return self
    def gte(self, c, v): self.rows = [r for r in self.rows if r.get(c) is not None and r[c] >= v]; return self
    def lte(self, c, v): self.rows = [r for r in self.rows if r.get(c) is not None and r[c] <= v]; return self
    def in_(self, c, vs): vs = set(vs); self.rows = [r for r in self.rows if r.get(c) in vs]; return self
    def is_(self, c, v): assert v == "null"; self.rows = [r for r in self.rows if r.get(c) is None]; return self

    def filter(self, c, op, v):
        assert op == "imatch"
        rx = re.compile(v, re.I)
        self.rows = [r for r in self.rows if rx.search(str(r.get(c) or ""))]
        return self

    def order(self, c, desc=False):
        self.rows.sort(key=lambda r: (r.get(c) is None, r.get(c)), reverse=desc)
        return self

    # PostgREST's count=exact is the TOTAL match count; .limit() only trims the rows returned.
    def limit(self, n): self._lim = n; return self
    def range(self, lo, hi): self._lo, self._hi = lo, hi; return self

    def execute(self):
        rows = self.rows if self._lo is None else self.rows[self._lo:self._hi + 1]
        if self._lim is not None:
            rows = rows[:self._lim]
        return SimpleNamespace(data=rows, count=len(self.rows))


class _Client:
    def __init__(self, tables, rpcs):
        self.tables, self.rpcs = tables, rpcs

    def table(self, name):
        if name not in self.tables:
            raise RuntimeError(f"relation {name} does not exist")
        return _Q(self.tables[name])

    def rpc(self, name, params):
        return _Q(self.rpcs[name])


SNAP_AT, YSNAP_AT = _t(1), _t(25)


def _snap(at, pct_big=0.9):
    return [
        dict(taken_at=at, platform="big", tbl="big_residential_listings", active_rows=1000, verified_in_sla=int(1000 * pct_big), never_verified=10),
        dict(taken_at=at, platform="big", tbl="big_commercial_listings", active_rows=100, verified_in_sla=100, never_verified=0),
        dict(taken_at=at, platform="tiny", tbl="tiny_residential_listings", active_rows=20, verified_in_sla=20, never_verified=0),
        dict(taken_at=at, platform="quiet", tbl="quiet_residential_listings", active_rows=50, verified_in_sla=50, never_verified=0),
        dict(taken_at=at, platform="broken", tbl="broken_residential_listings", active_rows=30, verified_in_sla=30, never_verified=0),
        dict(taken_at=at, platform="alerted", tbl="alerted_residential_listings", active_rows=30, verified_in_sla=30, never_verified=0),
    ]


def _client(**over):
    tables = {
        "ops_liveness_registry": [dict(platform=p, strategy="DIRECT_REVISIT", sla_hours=48)
                                  for p in ("big", "tiny", "quiet", "broken", "alerted")],
        "ops_liveness_coverage_snapshot": _snap(SNAP_AT) + _snap(YSNAP_AT, pct_big=0.5),
        # hidden: active=false with deactivated_at in the window counts; outside it or still active does not
        "big_residential_listings": [dict(id=1, active=False, deactivated_at=_t(2)), dict(id=2, active=False, deactivated_at=_t(3)),
                                     dict(id=3, active=False, deactivated_at=_t(30)), dict(id=4, active=True, deactivated_at=_t(2))],
        "big_commercial_listings": [dict(id=5, active=False, deactivated_at=_t(5))],
        "tiny_residential_listings": [dict(id=6, active=False, deactivated_at=_t(1))],
        "quiet_residential_listings": [],
        "broken_residential_listings": [],
        "alerted_residential_listings": [],
        "crawl_stats_run": [dict(id=10, captured_at=_t(2)), dict(id=11, captured_at=_t(12)), dict(id=12, captured_at=_t(40))],
        "crawl_stats_platform": [dict(run_id=10, platform="big", reactivated=3), dict(run_id=11, platform="big", reactivated=4),
                                 dict(run_id=12, platform="big", reactivated=99), dict(run_id=10, platform="tiny", reactivated=0)],
        "purged_listings_archive": [dict(id=1, source_table="big_residential_listings", deleted_at=_t(3)),
                                    dict(id=2, source_table="big_commercial_listings", deleted_at=_t(4)),
                                    dict(id=3, source_table="big_residential_listings", deleted_at=_t(60)),
                                    dict(id=4, source_table="tiny_residential_listings", deleted_at=_t(1))],
        "platform_retention_policy": [dict(platform="big", enabled=True), dict(platform="quiet", enabled=True),
                                      dict(platform="broken", enabled=False)],
        "scrape_runs": [
            dict(platform="fleet_liveness:big", started_at=_t(10), finished_at=_t(9), ok=True, rows_seen=1100, rows_upserted=5, notes="APPLY active=1100 probed=1100 hidden=3"),
            dict(platform="fleet_liveness:big", started_at=_t(3), finished_at=_t(2), ok=True, rows_seen=40, rows_upserted=1, notes="APPLY RECHECK active=1100 probed=40"),
            dict(platform="fleet_liveness:broken", started_at=_t(30), finished_at=_t(30), ok=True, rows_seen=30, rows_upserted=0, notes="APPLY"),
            dict(platform="fleet_liveness:broken", started_at=_t(6), finished_at=_t(6), ok=False, rows_seen=0, rows_upserted=0, notes="error: boom"),
            dict(platform="aqar_liveness:big_residential_listings:0/2", started_at=_t(8), finished_at=_t(7), ok=True, rows_seen=500, rows_upserted=0, notes="x"),
            dict(platform="aqar_liveness:big_residential_listings:1/2", started_at=_t(7), finished_at=_t(6), ok=True, rows_seen=500, rows_upserted=0, notes="x"),
            dict(platform="cleanup:tiny", started_at=_t(100), finished_at=_t(100), ok=True, rows_seen=0, rows_upserted=0, notes="dry"),
            dict(platform="gathern_liveness", started_at=_t(1), finished_at=_t(1), ok=True, rows_seen=120, rows_upserted=0, notes="x"),
            dict(platform="gathern_liveness", started_at=_t(2), finished_at=_t(2), ok=True, rows_seen=80, rows_upserted=0, notes="x"),
            dict(platform="gathern_liveness", started_at=_t(50), finished_at=_t(50), ok=True, rows_seen=999, rows_upserted=0, notes="x"),
            dict(platform="big", started_at=_t(1), finished_at=_t(1), ok=True, rows_seen=5, rows_upserted=5, notes="a crawl, not a lifecycle job"),
        ],
        "alert_event": [dict(id=1, severity="P1", kind="liveness_verification_sla", platform="alerted", resolved_at=None),
                        dict(id=2, severity="P1", kind="liveness_verification_sla", platform="alerted", resolved_at=_t(1)),
                        dict(id=3, severity="P1", kind="field_integrity", platform="tiny", resolved_at=None),
                        dict(id=4, severity="P3", kind="liveness_verification_sla", platform="quiet", resolved_at=None)],
        "mon_unverified_inactivations_24h": [dict(unverified_inactivations_24h=7, deduplicated_copies_24h=0)],
        "ops_daily_engineer_run": [
            dict(id=90, run_at=_t(5), phase="lifecycle:followup", report="fixed in #5601 and #5601, waiting on #5699", notes=None),
            dict(id=89, run_at=_t(20), phase="lifecycle:end", report="see PR #5602", notes="also #5610"),
            dict(id=88, run_at=_t(21), phase="scraping-engineer:end", report="#5555", notes=None),
            dict(id=87, run_at=_t(70), phase="lifecycle:end", report="#5000 too old", notes=None),
        ],
    }
    tables.update(over)
    rpcs = {
        "ops_platform_protection_matrix": [dict(platform="big", final_status="PROTECTED"), dict(platform="tiny", final_status="PARTIAL"),
                                           dict(platform="quiet", final_status="PROTECTED")],
        "ops_lifecycle_ledger_rows_not_deleted": [dict(source_table="big_residential_listings", listing_id=1)] * 3,
    }
    return _Client(tables, rpcs)


def _by(rep):
    return {s["platform"]: s for s in rep["sites"]}


def test_per_site_numbers_come_from_the_right_ledgers():
    rep = LR.collect(_client(), hours=24, now=NOW, merged={5601, 5602})
    s = _by(rep)
    assert rep["errors"] == []
    assert (s["big"]["hidden"], s["big"]["brought_back"], s["big"]["deleted"]) == (3, 7, 2)
    assert s["big"]["pct_in_time"] == 90.9 and s["big"]["never_verified"] == 10
    assert s["big"]["pct_in_time_yesterday"] == 54.5  # 600 of 1100 in the snapshot ~24h earlier
    assert s["tiny"]["deleted"] == 1            # no policy, but the archive has a real row: count it
    assert s["broken"]["deleted"] == "n/a"      # policy disabled, no archive row: no deletion path
    assert s["quiet"]["deleted"] == 0           # policy enabled, nothing deleted: a real 0
    assert s["big"]["ledger_not_deleted"] == 3 and s["tiny"]["ledger_not_deleted"] == 0


def test_marks_follow_the_rulebook_lines_and_the_list_sums_to_every_site():
    rep = LR.collect(_client(), hours=24, now=NOW, merged=set())
    s = _by(rep)
    assert s["big"]["mark"] == "⚠️" and "90.9% checked in time" in s["big"]["why"] and "10 never checked" in s["big"]["why"]
    assert s["broken"]["mark"] == "❌" and s["broken"]["why"] == ["job failed: fleet_liveness:broken"]
    assert s["alerted"]["mark"] == "❌" and s["alerted"]["why"] == ["open alert: liveness_verification_sla×1"]
    assert s["tiny"]["mark"] == "✅"            # field_integrity is not a lifecycle kind
    assert s["quiet"]["mark"] == "✅"           # a P3 is not counted
    assert rep["listed"] == ["big", "tiny", "alerted", "broken"]   # most hidden first, then by name
    assert rep["other_count"] == 1 and len(rep["listed"]) + rep["other_count"] == len(rep["sites"])
    f = rep["fleet"]
    assert (f["hidden"], f["brought_back"], f["deleted"], f["deleted_na_sites"]) == (4, 7, 3, 2)   # broken + alerted: no policy, no archive row
    assert f["pct_in_time"] == 91.9 and f["never_checked"] == 10 and f["pct_in_time_yesterday"] == 59.3
    assert f["unverified_inactivations_24h"] == 7 and f["ledger_rows_not_deleted"] == 3
    assert (f["protected"], f["sites_in_matrix"]) == (2, 3) and f["gathern_checked"] == 200


def test_an_alert_on_a_table_name_with_no_owner_still_turns_its_site_red():
    # alert_event.platform is sometimes the TABLE, owner_routine may be unset: a served dead ad is the rulebook's ❌
    rows = [dict(id=1, severity="P1", kind="served_despite_direct_404", platform="big_residential_listings",
                 owner_routine=None, resolved_at=None),
            dict(id=2, severity="P1", kind="some_new_kind", platform="tiny", owner_routine="routine-11-lifecycle", resolved_at=None),
            dict(id=3, severity="P1", kind="some_new_kind", platform="quiet", owner_routine="routine-2-production", resolved_at=None)]
    s = _by(LR.collect(_client(alert_event=rows), hours=24, now=NOW, merged=set()))
    assert s["big"]["mark"] == "❌" and s["big"]["why"] == ["open alert: served_despite_direct_404×1"]
    assert s["tiny"]["mark"] == "❌" and s["tiny"]["why"] == ["open alert: some_new_kind×1"]   # owner_routine is the fact
    assert s["quiet"]["mark"] == "✅"           # neither owned by lifecycle nor a lifecycle kind


def test_jobs_keep_recheck_apart_collapse_shards_and_carry_age():
    rep = LR.collect(_client(), hours=24, now=NOW, merged=set())
    j = {x["job"]: x for x in rep["jobs"]}
    assert set(j) == {"fleet_liveness:big", "fleet_liveness:big RECHECK", "fleet_liveness:broken",
                      "aqar_liveness:big_residential_listings", "cleanup:tiny", "gathern_liveness"}
    assert j["fleet_liveness:big"]["rows_seen"] == 1100 and j["fleet_liveness:big RECHECK"]["rows_seen"] == 40
    assert j["fleet_liveness:broken"]["ok"] is False and j["fleet_liveness:broken"]["age_h"] == 6.0
    assert j["aqar_liveness:big_residential_listings"]["runs_in_window"] == 2
    assert j["gathern_liveness"]["runs_in_window"] == 2 and j["gathern_liveness"]["rows_seen_in_window"] == 200
    assert j["cleanup:tiny"]["age_h"] == 100.0 and j["cleanup:tiny"]["runs_in_window"] == 0
    assert LR.job_site("aqar_liveness:aqarmonthly_residential_listings:0/1") == "aqarmonthly"
    assert LR.job_site("dealapp_recover") == "dealapp" and LR.job_site("wasalt_enum_shard") == "wasalt"


def test_followups_list_prs_with_merge_state_from_main_only():
    rep = LR.collect(_client(), hours=24, now=NOW, merged={5601, 5602})
    fu = {r["id"]: r for r in rep["followups"]}
    assert set(fu) == {90, 89}                      # last 48 h, lifecycle phases only
    assert fu[90]["prs"] == [dict(pr=5601, merged=True), dict(pr=5699, merged=False)]
    assert fu[89]["prs"] == [dict(pr=5602, merged=True), dict(pr=5610, merged=False)]
    unknown = LR.aggregate(dict(hours=24, now=NOW, since=NOW - timedelta(hours=24), errors=[], registry=[], taken_at=None,
                                cov=[], tables={}, y_taken_at=None, ycov=[], hidden_by_table={}, back={}, deleted={},
                                retention=set(), ledger_rows=[], runs=[], alerts=[], unverified={}, matrix=[], merged=None,
                                followups=[dict(id=1, run_at=_t(1), phase="lifecycle:end", report="#5601", notes="")]))
    assert unknown["followups"][0]["prs"] == [dict(pr=5601, merged=None)]
    assert "#5601?" in LR.render(unknown)


def test_no_readable_coverage_prints_unknown_not_a_perfect_fleet():
    c = _client(ops_liveness_registry=[], ops_liveness_coverage_snapshot=[])
    rep = LR.collect(c, hours=24, now=NOW, merged=set())
    assert rep["sites"] == [] and rep["fleet"]["pct_in_time"] is None and rep["fleet"]["never_checked"] is None
    assert any("no website could be listed" in e for e in rep["errors"])
    assert "Checked in time:** ?% (goal 100%) · never checked: ? (goal 0)" in LR.render(rep)


def test_view_fallback_when_the_key_cannot_read_the_snapshot():
    view = [dict(platform="big", strategy="DIRECT_REVISIT", sla_hours=48, active=1100, verified_in_sla=1000, never_verified=10, as_of=_t(1)),
            dict(platform="tiny", strategy="SOURCE_LIST_PRESENCE", sla_hours=24, active=20, verified_in_sla=20, never_verified=0, as_of=_t(1))]
    c = _client(ops_liveness_registry=[], ops_liveness_coverage_snapshot=[], ops_platform_liveness_coverage=view)
    rep = LR.collect(c, hours=24, now=NOW, merged=set())
    s = _by(rep)
    assert set(s) == {"big", "tiny"}
    assert s["big"]["hidden"] == 3 and s["big"]["tables"] == ["big_residential_listings", "big_commercial_listings"]
    assert s["tiny"]["hidden"] == 1 and s["tiny"]["tables"] == ["tiny_residential_listings"]  # no commercial table: skipped, not an error
    assert s["tiny"]["strategy"] == "SOURCE_LIST_PRESENCE" and s["big"]["pct_in_time"] == 90.9
    assert s["big"]["pct_in_time_yesterday"] is None and rep["fleet"]["pct_in_time_yesterday"] is None
    assert [e for e in rep["errors"] if "view ops_platform_liveness_coverage" in e] and not [e for e in rep["errors"] if e.startswith("hidden ")]


def test_a_key_that_sees_nothing_prints_unknown_not_zero():
    """Silent-empty reads (RLS, a dead capture cron) must never become a reassuring 0."""
    c = _client(crawl_stats_run=[], platform_retention_policy=[], purged_listings_archive=[],
                big_residential_listings=[], big_commercial_listings=[], tiny_residential_listings=[])
    rep = LR.collect(c, hours=24, now=NOW, merged=set())
    s = _by(rep)
    assert s["big"]["brought_back"] is None and rep["fleet"]["brought_back"] is None
    assert s["big"]["deleted"] is None and s["broken"]["deleted"] is None and rep["fleet"]["deleted"] is None
    assert s["big"]["hidden"] is None and rep["fleet"]["hidden"] is None     # job notes said hidden=3 … inactivated
    assert any("brought back is unknown" in e for e in rep["errors"])
    assert any("deleted is unknown" in e for e in rep["errors"])
    assert any("hidden is unknown" in e for e in rep["errors"])
    # …but a quiet night whose notes also say 0 is a real 0
    quiet_runs = [dict(r, notes="APPLY hidden=0") for r in _client().tables["scrape_runs"]]
    rep0 = LR.collect(_client(big_residential_listings=[], big_commercial_listings=[], tiny_residential_listings=[],
                              scrape_runs=quiet_runs), hours=24, now=NOW, merged=set())
    assert rep0["fleet"]["hidden"] == 0 and not [e for e in rep0["errors"] if "hidden" in e]


def test_idle_is_judged_over_the_window_not_one_hourly_run():
    runs = _client().tables["scrape_runs"] + [
        dict(platform="gathern_liveness", started_at=_t(0.5), finished_at=_t(0.4), ok=True, rows_seen=0, rows_upserted=0, notes="scanned=0"),
        dict(platform="fleet_liveness:quiet", started_at=_t(2), finished_at=_t(2), ok=True, rows_seen=0, rows_upserted=0, notes="APPLY probed=0")]
    reg = _client().tables["ops_liveness_registry"] + [dict(platform="gathern", strategy="DIRECT_REVISIT", sla_hours=24)]
    snap = _client().tables["ops_liveness_coverage_snapshot"] + [
        dict(taken_at=SNAP_AT, platform="gathern", tbl="gathern_residential_listings", active_rows=9, verified_in_sla=9, never_verified=0)]
    rep = LR.collect(_client(scrape_runs=runs, ops_liveness_registry=reg, ops_liveness_coverage_snapshot=snap,
                             gathern_residential_listings=[]), hours=24, now=NOW, merged=set())
    s = _by(rep)
    assert s["gathern"]["mark"] == "✅"          # 200 rows probed earlier in the window
    assert s["quiet"]["mark"] == "⚠️" and s["quiet"]["why"] == ["liveness ran but probed 0 rows in the window: fleet_liveness:quiet"]


def test_a_running_job_is_neither_failed_nor_idle():
    runs = _client().tables["scrape_runs"] + [dict(platform="fleet_liveness:tiny", started_at=_t(0.1), finished_at=None, ok=None,
                                                  rows_seen=0, rows_upserted=0, notes=None)]
    rep = LR.collect(_client(scrape_runs=runs), hours=24, now=NOW, merged=set())
    j = {x["job"]: x for x in rep["jobs"]}["fleet_liveness:tiny"]
    assert j["running"] is True and j["failed_in_window"] == 0
    assert _by(rep)["tiny"]["mark"] == "✅"
    assert "| fleet_liveness:tiny | " in LR.render(rep) and "| running | 0 |" in LR.render(rep)


def test_an_unreadable_table_renders_as_unknown_never_zero():
    c = _client()
    del c.tables["big_commercial_listings"]
    del c.tables["crawl_stats_platform"]
    rep = LR.collect(c, hours=24, now=NOW, merged=set())
    s = _by(rep)
    assert s["big"]["hidden"] is None and s["tiny"]["hidden"] == 1
    assert s["big"]["brought_back"] is None and rep["fleet"]["brought_back"] is None
    assert any(e.startswith("hidden big_commercial_listings") for e in rep["errors"])
    assert any(e.startswith("crawl_stats_platform") for e in rep["errors"])
    md = LR.render(rep)
    assert "Could not read" in md and "- **big**: ? hidden · ? brought back" in md
    assert "? hidden · ? brought back · 3 deleted" in md.split("Tonight, all websites:")[1].split("\n")[0]


def test_markdown_matches_the_report_block():
    md = LR.render(LR.collect(_client(), hours=24, now=NOW, merged={5601}))
    assert "- **big**: 3 hidden · 7 brought back · 2 deleted · 90.9% checked in time ⚠️ (90.9% checked in time; 10 never checked)" in md
    assert "- **broken**: 0 hidden · 0 brought back · n/a deleted · 100.0% checked in time ❌ (job failed: fleet_liveness:broken)" in md
    assert "- **The other 1 websites:** nothing hidden tonight, all checked in time ✅" in md
    assert "📋 **Checked in time:** 91.9% (goal 100%) · never checked: 10 (goal 0) · yesterday 59.3%" in md
    assert "| fleet_liveness:big RECHECK |" in md and "| P1 | liveness_verification_sla | 1 | alerted×1 |" in md
    assert "run 90 · " in md and "#5601✓ #5699✗" in md
    assert "| big | DIRECT_REVISIT | 1100 | 3 | 7 | 2 | 90.9 | 54.5 | 10 | 3 | ⚠️ |" in md
