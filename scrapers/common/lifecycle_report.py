"""Every number in the ♻️ Lifecycle Engineer's report block, computed from the database.

    python -m scrapers.common.lifecycle_report [--hours 24] [--json]

The engineer PASTES this output (docs/ops/LIFECYCLE_ENGINEER.md, "Report"); it never reasons a
number out. READ-ONLY: selects and two read-only RPCs, nothing else. Where each number comes from:

  hidden         rows now inactive whose `deactivated_at` falls in the window, counted on every
                 listing table of the latest `ops_liveness_coverage_snapshot`
  brought back   sum of `crawl_stats_platform.reactivated` over the hourly captures in the window
                 (`capture_crawl_stats()` at :50). The listing table cannot say it:
                 trg_set_deactivated_at NULLs `deactivated_at` when a row comes back.
  deleted        `purged_listings_archive` rows in the window (trg_archive_hard_delete writes one
                 per real delete). "n/a" for a site with no enabled `platform_retention_policy`
                 and no archive row: it has no deletion path, so there is nothing to count.
  % in time      latest snapshot: verified_in_sla / active_rows, both tables together. When the
                 key cannot read the snapshot, the view `ops_platform_liveness_coverage` (same
                 numbers, per site) and the tables are tried by name; "yesterday" is then "?".
  mark           ❌ the last run of one of its lifecycle jobs failed, or an open P0–P2 alert of a
                 lifecycle kind names it;  ⚠️ below 100% checked in time, listings never checked,
                 or its liveness job ran in the window and probed 0 rows while it has live rows;
                 ✅ otherwise.
                 `why` says which line fired.
  jobs           last `scrape_runs` row per lifecycle job label in the last 7 days (aqar shards
                 collapsed; a fleet_liveness RECHECK is its own job), with age and window counts
  first runs     PR numbers mentioned by lifecycle:followup / lifecycle:end rows of the last 48 h,
                 merged = a merge subject "(#N)" on origin/main (HEAD when there is no origin)

A number that could not be read prints as "?", never as 0, and the reason is listed at the top.
Not in the database, so not here (the report marks them "(hand-computed)" with the query or job
that produced them): spot-check wrong answers, cards clicked, the high-priority list, bugs
found/fixed, the rating.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
AZ = timezone(timedelta(hours=-7))  # Arizona, no DST
PAGE = 1000  # PostgREST max-rows; everything that can exceed it is paged
JOB_RE = "^(fleet_liveness:|gathern_liveness|aqar_liveness:|dealapp_|wasalt_enum|wasalt_liveness|cleanup:|verify_deletions:)"
LIVENESS_JOB_RE = re.compile("^(fleet_liveness:|gathern_liveness|aqar_liveness|dealapp_liveness|wasalt_enum|wasalt_liveness)")
LIFECYCLE_ALERT_RE = re.compile(
    "liveness|inactivation|deletion|resurrection|prune|lifecycle|stale_active|served_after_source_gone"
    "|unknown_treated_as_dead|enumeration|served_despite|dead_but_active", re.I)
LIFECYCLE_ROUTINE = "routine-11-lifecycle"  # alert_event.owner_routine: the computed fact, the regex is the fallback
PR_RE = re.compile(r"#(\d{4,6})")
MERGE_SUBJECT_RE = re.compile(r"\(#(\d+)\)\s*$", re.M)
NO_SUCH_TABLE = re.compile("PGRST205|Could not find the table|does not exist|JSON could not be generated|'code': 404", re.I)
NOTES_HIDDEN_RE = re.compile(r"\b(?:hidden|killed|inactivated)=(\d+)")  # fleet / aqar / gathern run notes
REPO = Path(__file__).resolve().parents[2]


def _all(q) -> list[dict]:
    """Page through a PostgREST query (or RPC) with Range; the server caps a single answer."""
    out: list[dict] = []
    lo = 0
    while True:
        rows = q.range(lo, lo + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out
        lo += PAGE


def _platform_of_table(tbl: str) -> str:
    return re.sub(r"_(residential|commercial)_listings$", "", tbl)


def job_key(label: str, notes: str | None) -> str:
    """One job per label; aqar's 16 shards are one job; a fleet_liveness RECHECK is its own job."""
    key = re.sub(r":\d+/\d+$", "", label)
    return key + " RECHECK" if "RECHECK" in (notes or "") else key


def job_site(label: str) -> str | None:
    head, _, rest = label.partition(":")
    if head in ("fleet_liveness", "cleanup", "verify_deletions"):
        return rest or None
    if head == "aqar_liveness":
        return _platform_of_table(rest.split(":")[0]) if rest else "aqar"
    for p in ("gathern", "dealapp", "wasalt"):
        if label.startswith(p):
            return p
    return None


def merged_pr_numbers(repo: Path | None = None) -> set[int] | None:
    """PRs merged to main, read from merge subjects "... (#N)". None when git cannot answer."""
    for ref in ("origin/main", "HEAD"):
        try:
            out = subprocess.run(["git", "log", ref, "--format=%s", "-n", "5000"], capture_output=True,
                                 text=True, timeout=60, cwd=str(repo or REPO))
        except Exception:
            return None
        if out.returncode == 0:
            return {int(m) for m in MERGE_SUBJECT_RE.findall(out.stdout)}
    return None


def _age_h(iso: str | None, now: datetime) -> float | None:
    if not iso:
        return None
    return round((now - datetime.fromisoformat(iso)).total_seconds() / 3600, 1)


def _az(iso: str | None) -> str:
    return datetime.fromisoformat(iso).astimezone(AZ).strftime("%m-%d %H:%M") if iso else "none"


def _pct(num: int, den: int) -> float:
    return round(100.0 * num / den, 1) if den else 100.0


def collect(client, *, hours: int, now: datetime, merged: set[int] | None = None) -> dict:
    """Read everything the report needs. Each section fails on its own: a section that could not
    be read is listed under `errors` and its numbers render as "?", never as 0."""
    since = now - timedelta(hours=hours)
    since_iso = since.isoformat()
    errors: list[str] = []

    def section(name, fn, default):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - every section must still print
            errors.append(f"{name}: {str(e)[:160]}")
            return default

    registry = section("ops_liveness_registry", lambda: _all(
        client.table("ops_liveness_registry").select("platform,strategy,sla_hours").order("platform")), [])

    def _snapshot(before_iso: str | None):
        q = client.table("ops_liveness_coverage_snapshot").select("taken_at")
        if before_iso:
            q = q.lte("taken_at", before_iso)
        head = q.order("taken_at", desc=True).limit(1).execute().data or []
        if not head:
            return None, []
        taken = head[0]["taken_at"]
        rows = _all(client.table("ops_liveness_coverage_snapshot")
                    .select("platform,tbl,active_rows,verified_in_sla,never_verified")
                    .eq("taken_at", taken).order("tbl"))
        return taken, rows

    taken_at, cov = section("ops_liveness_coverage_snapshot", lambda: _snapshot(None), (None, []))
    y_taken_at, ycov = section("ops_liveness_coverage_snapshot(yesterday)",
                               lambda: _snapshot((now - timedelta(hours=24)).isoformat()), (None, []))
    tables: dict[str, list[str]] = defaultdict(list)
    for r in cov:
        tables[r["platform"]].append(r["tbl"])
    if not cov:
        view = section("ops_platform_liveness_coverage", lambda: _all(
            client.table("ops_platform_liveness_coverage")
            .select("platform,strategy,sla_hours,active,verified_in_sla,never_verified,as_of").order("platform")), [])
        if view:
            errors.append("ops_liveness_coverage_snapshot returned 0 rows (this key cannot read it?): coverage read from "
                          "the view ops_platform_liveness_coverage, tables tried by name, «yesterday» unavailable")
            taken_at = max((r.get("as_of") or "" for r in view), default=None) or None
            cov = [dict(platform=r["platform"], tbl=None, active_rows=r.get("active"),
                        verified_in_sla=r.get("verified_in_sla"), never_verified=r.get("never_verified")) for r in view]
            registry = registry or [dict(platform=r["platform"], strategy=r.get("strategy"), sla_hours=r.get("sla_hours"))
                                    for r in view]
            for r in view:
                tables[r["platform"]] = [f"{r['platform']}_{kind}_listings" for kind in ("residential", "commercial")]
    if not registry and not cov:
        errors.append("ops_liveness_registry, ops_liveness_coverage_snapshot and ops_platform_liveness_coverage all "
                      "returned 0 rows: no website could be listed")

    hidden_by_table: dict[str, int | None] = {}
    for p, tbls in list(tables.items()):
        for tbl in list(tbls):
            try:
                hidden_by_table[tbl] = (client.table(tbl).select("id", count="exact", head=True)
                                        .eq("active", False).gte("deactivated_at", since_iso).execute().count)
            except Exception as e:  # noqa: BLE001
                if cov and cov[0]["tbl"] is None and NO_SUCH_TABLE.search(str(e)):
                    tbls.remove(tbl)  # a name tried under the view fallback that this site does not have
                    continue
                errors.append(f"hidden {tbl}: {str(e)[:160]}")
                hidden_by_table[tbl] = None

    def _back():
        ids = [r["id"] for r in _all(client.table("crawl_stats_run").select("id")
                                     .gte("captured_at", since_iso).order("id"))]
        if not ids:  # hourly capture: none in the window means unreadable or dead, never "0 came back"
            raise RuntimeError("no crawl_stats_run capture in the window: brought back is unknown")
        out: dict[str, int] = defaultdict(int)
        for r in _all(client.table("crawl_stats_platform").select("platform,reactivated")
                      .in_("run_id", ids).order("run_id")):
            out[r["platform"]] += int(r.get("reactivated") or 0)
        return dict(out)
    back = section("crawl_stats_platform", _back, None)

    def _deleted():
        out: dict[str, int] = defaultdict(int)
        for r in _all(client.table("purged_listings_archive").select("source_table")
                      .gte("deleted_at", since_iso).order("id")):
            out[_platform_of_table(r["source_table"])] += 1
        return dict(out)
    deleted = section("purged_listings_archive", _deleted, None)
    retention = section("platform_retention_policy", lambda: {
        r["platform"] for r in _all(client.table("platform_retention_policy").select("platform,enabled")
                                    .eq("enabled", True).order("platform"))}, set())
    if deleted == {} and not retention:  # both empty = this key sees neither ledger, not a quiet fleet
        errors.append("platform_retention_policy and purged_listings_archive both returned 0 rows: deleted is unknown")
        deleted = None
    ledger_rows = section("ops_lifecycle_ledger_rows_not_deleted()",
                          lambda: _all(client.rpc("ops_lifecycle_ledger_rows_not_deleted", {})), None)

    jobs_since = (now - timedelta(days=7)).isoformat()
    runs = section("scrape_runs", lambda: _all(
        client.table("scrape_runs").select("platform,started_at,finished_at,ok,rows_seen,rows_upserted,notes")
        .gte("started_at", jobs_since).filter("platform", "imatch", JOB_RE).order("started_at", desc=True)), [])
    alerts = section("alert_event", lambda: _all(
        client.table("alert_event").select("severity,kind,platform,owner_routine").is_("resolved_at", "null")
        .in_("severity", ["P0", "P1", "P2"]).order("id")), None)
    unverified = section("mon_unverified_inactivations_24h", lambda: (
        client.table("mon_unverified_inactivations_24h").select("*").execute().data or [{}])[0], {})
    matrix = section("ops_platform_protection_matrix()", lambda: (
        client.rpc("ops_platform_protection_matrix", {}).execute().data or []), None)
    followups = section("ops_daily_engineer_run", lambda: _all(
        client.table("ops_daily_engineer_run").select("id,run_at,phase,report,notes")
        .gte("run_at", (now - timedelta(hours=48)).isoformat())
        .in_("phase", ["lifecycle:followup", "lifecycle:end"]).order("run_at", desc=True)), [])

    return aggregate(dict(
        hours=hours, now=now, since=since, errors=errors, registry=registry, taken_at=taken_at, cov=cov,
        tables=dict(tables), y_taken_at=y_taken_at, ycov=ycov, hidden_by_table=hidden_by_table, back=back,
        deleted=deleted, retention=retention, ledger_rows=ledger_rows, runs=runs, alerts=alerts,
        unverified=unverified, matrix=matrix, followups=followups,
        merged=merged if merged is not None else merged_pr_numbers()))


def aggregate(raw: dict) -> dict:
    """Pure: raw rows in, the report dict out. The rulebook's lines, applied as data."""
    now, since = raw["now"], raw["since"]
    sites: dict[str, dict] = {}

    def site(p):
        return sites.setdefault(p, dict(
            platform=p, strategy=None, sla_hours=None, tables=[], active=0, verified_in_sla=0,
            never_verified=0, hidden=0, brought_back=0, deleted=0, ledger_not_deleted=0,
            jobs=[], alerts={}, why=[]))

    for r in raw["registry"]:
        s = site(r["platform"])
        s["strategy"], s["sla_hours"] = r.get("strategy"), r.get("sla_hours")
    for r in raw["cov"]:
        s = site(r["platform"])
        s["active"] += int(r.get("active_rows") or 0)
        s["verified_in_sla"] += int(r.get("verified_in_sla") or 0)
        s["never_verified"] += int(r.get("never_verified") or 0)
    for p, s in sites.items():
        s["tables"] = list(raw["tables"].get(p, []))
        counts = [raw["hidden_by_table"].get(t) for t in s["tables"]]
        s["hidden"] = None if (not counts or any(c is None for c in counts)) else sum(int(c) for c in counts)
    # The tables are the truth for "hidden", but a key that cannot see inactive rows reads 0 on every
    # one. The jobs' own notes (hidden= / killed= / inactivated=) say whether anything was hidden.
    notes_hidden = sum(int(n) for r in raw["runs"] if r["started_at"] >= since.isoformat()
                       for n in NOTES_HIDDEN_RE.findall(r.get("notes") or ""))
    if sites and notes_hidden and not any(s["hidden"] for s in sites.values()):
        raw["errors"].append(f"listing tables show 0 hidden rows while the window's job notes report {notes_hidden} hidden: "
                             "this key cannot see inactive rows, hidden is unknown")
        for s in sites.values():
            s["hidden"] = None

    ypct: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))
    for r in raw["ycov"]:
        a, v = ypct[r["platform"]]
        ypct[r["platform"]] = (a + int(r.get("active_rows") or 0), v + int(r.get("verified_in_sla") or 0))

    back, deleted, ledger_rows = raw["back"], raw["deleted"], raw["ledger_rows"]
    ledger: dict[str, int] | None = None
    if ledger_rows is not None:
        ledger = defaultdict(int)
        for r in ledger_rows:
            ledger[_platform_of_table(r["source_table"])] += 1
    for p, s in sites.items():
        s["brought_back"] = None if back is None else int(back.get(p, 0))
        if deleted is None:
            s["deleted"] = None
        elif p in raw["retention"] or p in deleted:
            s["deleted"] = int(deleted.get(p, 0))
        else:
            s["deleted"] = "n/a"
        s["ledger_not_deleted"] = None if ledger is None else int(ledger.get(p, 0))

    # Jobs: the latest row per job key; counts inside the window. ok NULL + no finished_at = running.
    jobs: dict[str, dict] = {}
    for r in raw["runs"]:
        key = job_key(r["platform"], r.get("notes"))
        j = jobs.get(key)
        if j is None:
            j = jobs[key] = dict(job=key, site=job_site(r["platform"]), last_started_at=r["started_at"],
                                 last_finished_at=r.get("finished_at"), ok=r.get("ok"),
                                 running=r.get("ok") is None and not r.get("finished_at"),
                                 rows_seen=r.get("rows_seen"), rows_upserted=r.get("rows_upserted"),
                                 note=(r.get("notes") or "")[:100], age_h=_age_h(r["started_at"], now),
                                 runs_in_window=0, failed_in_window=0, rows_seen_in_window=0)
        if r["started_at"] >= since.isoformat():
            j["runs_in_window"] += 1
            j["failed_in_window"] += 1 if r.get("ok") is False else 0
            j["rows_seen_in_window"] += int(r.get("rows_seen") or 0)
    for j in jobs.values():
        if j["site"] in sites:
            sites[j["site"]]["jobs"].append(j["job"])

    # Alerts: open P0–P2 by (severity, kind); lifecycle kinds also land on their site.
    alert_rows = raw["alerts"]
    by_kind: dict[tuple, dict] = {}
    if alert_rows is not None:
        for a in alert_rows:
            k = (a.get("severity"), a.get("kind"))
            e = by_kind.setdefault(k, dict(severity=k[0], kind=k[1], n=0, platforms=defaultdict(int)))
            e["n"] += 1
            e["platforms"][a.get("platform") or "-"] += 1
            p = _platform_of_table(a.get("platform") or "")  # alert.platform is sometimes a TABLE name
            lifecycle = a.get("owner_routine") == LIFECYCLE_ROUTINE or LIFECYCLE_ALERT_RE.search(a.get("kind") or "")
            if p in sites and lifecycle:
                sites[p]["alerts"][a["kind"]] = sites[p]["alerts"].get(a["kind"], 0) + 1
    alerts_out = sorted((dict(e, platforms=dict(sorted(e["platforms"].items(), key=lambda kv: -kv[1])[:5]))
                         for e in by_kind.values()), key=lambda e: (e["severity"], -e["n"]))

    # The site mark, from the rulebook's own lines.
    for p, s in sites.items():
        s["pct_in_time"] = _pct(s["verified_in_sla"], s["active"])
        y = ypct.get(p)  # .get: indexing a defaultdict would invent a 100% yesterday
        s["pct_in_time_yesterday"] = _pct(y[1], y[0]) if y else None
        failed = [j for j in s["jobs"] if jobs[j]["ok"] is False]
        if failed:
            s["why"].append("job failed: " + ", ".join(failed))
        if s["alerts"]:
            s["why"].append("open alert: " + ", ".join(f"{k}×{n}" for k, n in sorted(s["alerts"].items())))
        mark = "❌" if s["why"] else ""
        if not mark:
            if s["active"] and s["verified_in_sla"] < s["active"]:
                s["why"].append(f"{s['pct_in_time']}% checked in time")
            if s["never_verified"]:
                s["why"].append(f"{s['never_verified']} never checked")
            idle = [j for j in s["jobs"] if LIVENESS_JOB_RE.search(j) and s["active"] and jobs[j]["runs_in_window"]
                    and not jobs[j]["rows_seen_in_window"] and not jobs[j]["running"] and jobs[j]["ok"] is not False]
            if idle:
                s["why"].append("liveness ran but probed 0 rows in the window: " + ", ".join(idle))
            mark = "⚠️" if s["why"] else "✅"
        s["mark"] = mark

    def _sort_hidden(s):
        return -1 if s["hidden"] is None else s["hidden"]

    ordered = sorted(sites.values(), key=lambda s: (-_sort_hidden(s), s["platform"]))
    listed = [s for s in ordered if s["mark"] != "✅" or (s["hidden"] or 0) > 0
              or (s["brought_back"] or 0) > 0 or (isinstance(s["deleted"], int) and s["deleted"] > 0)]

    def _sum(key):
        vals = [s[key] for s in sites.values()]
        if not vals or any(v is None for v in vals):
            return None
        return sum(v for v in vals if isinstance(v, int))

    y_active = sum(a for a, _ in ypct.values())
    y_verified = sum(v for _, v in ypct.values())
    active = sum(s["active"] for s in sites.values())
    verified = sum(s["verified_in_sla"] for s in sites.values())
    fleet = dict(
        sites=len(sites), hidden=_sum("hidden"), brought_back=_sum("brought_back"), deleted=_sum("deleted"),
        deleted_na_sites=sum(1 for s in sites.values() if s["deleted"] == "n/a"),
        active=active, verified_in_sla=verified,
        pct_in_time=_pct(verified, active) if sites else None,
        never_checked=sum(s["never_verified"] for s in sites.values()) if sites else None,
        snapshot_taken_at=raw["taken_at"], yesterday_taken_at=raw["y_taken_at"],
        pct_in_time_yesterday=_pct(y_verified, y_active) if raw["ycov"] else None,
        sites_at_100=sum(1 for s in sites.values() if s["verified_in_sla"] >= s["active"]),
        unverified_inactivations_24h=raw["unverified"].get("unverified_inactivations_24h"),
        ledger_rows_not_deleted=None if ledger_rows is None else len(ledger_rows),
        protected=None if raw["matrix"] is None else sum(1 for m in raw["matrix"] if m.get("final_status") == "PROTECTED"),
        sites_in_matrix=None if raw["matrix"] is None else len(raw["matrix"]),
        gathern_checked=sum(j["rows_seen_in_window"] for j in jobs.values() if j["job"] == "gathern_liveness"),
    )

    merged = raw["merged"]
    fu_out = []
    for r in raw["followups"]:
        text = (r.get("report") or "") + " " + (r.get("notes") or "")
        prs = sorted({int(n) for n in PR_RE.findall(text)})
        fu_out.append(dict(id=r["id"], run_at=r["run_at"], phase=r["phase"], prs=[
            dict(pr=n, merged=None if merged is None else (n in merged)) for n in prs]))

    return dict(hours=raw["hours"], now=now.isoformat(), since=since.isoformat(), errors=raw["errors"],
                fleet=fleet, sites=ordered, listed=[s["platform"] for s in listed],
                other_count=len(sites) - len(listed), jobs=sorted(jobs.values(), key=lambda j: j["job"]),
                alerts=alerts_out, followups=fu_out)


def _n(v) -> str:
    return "?" if v is None else str(v)


def render(rep: dict) -> str:
    f = rep["fleet"]
    now = datetime.fromisoformat(rep["now"])
    out = [f"# ♻️ Lifecycle numbers · last {rep['hours']} h · computed {now.astimezone(AZ):%Y-%m-%d %H:%M} Arizona"
           f" · coverage snapshot {_az(f['snapshot_taken_at'])} AZ", ""]
    if rep["errors"]:
        out += ["**⚠️ Could not read (these numbers are «?», never 0):**"] + [f"- {e}" for e in rep["errors"]] + [""]
    y = f["pct_in_time_yesterday"]
    out += [
        f"📋 **Checked in time:** {_n(f['pct_in_time'])}% (goal 100%) · never checked: {_n(f['never_checked'])} (goal 0)"
        f" · yesterday {_n(y)}%" + (f" (snapshot {_az(f['yesterday_taken_at'])} AZ)" if y is not None else "")
        + f" · websites at 100%: {f['sites_at_100']} of {f['sites']}",
        f"♻️ **Tonight, all websites:** {_n(f['hidden'])} hidden · {_n(f['brought_back'])} brought back"
        f" · {_n(f['deleted'])} deleted (n/a on {f['deleted_na_sites']} websites with no deletion path)",
        f"🛡️ **Websites fully protected:** {_n(f['protected'])} of {_n(f['sites_in_matrix'])}",
        f"🔴 **Gathern:** {f['gathern_checked']} ads checked (gathern_liveness rows_seen in the window)",
        f"🧾 mon_unverified_inactivations_24h: **{_n(f['unverified_inactivations_24h'])}** (must be 0)"
        f" · intended deletions not done (ops_lifecycle_ledger_rows_not_deleted): **{_n(f['ledger_rows_not_deleted'])}**",
        "", "🌐 **Each website** (most hidden first):"]
    by_name = {s["platform"]: s for s in rep["sites"]}
    for p in rep["listed"]:
        s = by_name[p]
        why = f" ({'; '.join(s['why'])})" if s["why"] else ""
        out.append(f"- **{p}**: {_n(s['hidden'])} hidden · {_n(s['brought_back'])} brought back · {_n(s['deleted'])} deleted"
                   f" · {s['pct_in_time']}% checked in time {s['mark']}{why}")
    other_hidden = "nothing hidden tonight" if f["hidden"] is not None else "hidden unknown (see above)"
    out += [f"- **The other {rep['other_count']} websites:** {other_hidden}, all checked in time ✅", "",
            "⚙️ **Lifecycle jobs** (last run per job, last 7 days; times Arizona):", "",
            "| job | last run | age h | ok | rows_seen | runs in window | rows in window | failed in window | note |",
            "|---|---|---|---|---|---|---|---|---|"]
    for j in rep["jobs"]:
        ok = "running" if j["running"] else {True: "✅", False: "❌"}.get(j["ok"], "?")
        note = j["note"].replace("|", "/")
        out.append(f"| {j['job']} | {_az(j['last_started_at'])} | {_n(j['age_h'])} | {ok} | {_n(j['rows_seen'])}"
                   f" | {j['runs_in_window']} | {j['rows_seen_in_window']} | {j['failed_in_window']} | {note} |")
    out += ["", "🚨 **Open P0–P2 alerts by kind:**", "", "| severity | kind | open | platforms (top 5) |", "|---|---|---|---|"]
    for a in rep["alerts"]:
        plats = ", ".join(f"{p}×{n}" for p, n in a["platforms"].items())
        out.append(f"| {a['severity']} | {a['kind']} | {a['n']} | {plats} |")
    out += ["", "🔁 **First runs of yesterday's fixes** (lifecycle:followup / lifecycle:end rows, last 48 h; ✓ merged on main, ✗ not merged, ? git unavailable):", ""]
    for r in rep["followups"]:
        prs = " ".join(f"#{x['pr']}{'✓' if x['merged'] else ('?' if x['merged'] is None else '✗')}" for x in r["prs"]) or "(no PR mentioned)"
        out.append(f"- run {r['id']} · {_az(r['run_at'])} · {r['phase']}: {prs}")
    out += ["", "📊 **All websites** (run-log table):", "",
            "| website | strategy | active | hidden | brought back | deleted | % in time | yesterday | never checked | ledger not deleted | mark | why |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in rep["sites"]:
        out.append(f"| {s['platform']} | {s['strategy'] or '?'} | {s['active']} | {_n(s['hidden'])} | {_n(s['brought_back'])}"
                   f" | {_n(s['deleted'])} | {s['pct_in_time']} | {_n(s['pct_in_time_yesterday'])} | {s['never_verified']}"
                   f" | {_n(s['ledger_not_deleted'])} | {s['mark']} | {'; '.join(s['why'])} |")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--json", action="store_true", help="print the machine-readable report instead of markdown")
    args = ap.parse_args(argv)
    from scrapers.common.db import sb
    rep = collect(sb(), hours=args.hours, now=datetime.now(UTC))
    sys.stdout.write(json.dumps(rep, ensure_ascii=False, indent=1, default=str) + "\n" if args.json else render(rep))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
