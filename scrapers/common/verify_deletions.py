"""Post-delete spot-check: re-probe a sample of recently hard-deleted listings and confirm the
source agrees they are actually gone (barrier 11, owner-directed safety audit 2026-08-22).

cleanup.py's final pre-delete recheck is the primary defense against a false deletion, but it is
only as good as that SAME code path. This is a SECOND, INDEPENDENT verification, run some time
after the fact, reusing the same dead-marker registry — built to catch a systematic bug in the
recheck logic itself (a URL-construction error, a dead-marker regex that stopped matching after a
site redesign) that a single delete-time check could not see, since it would fool both checks
identically if they were the same code path at the same moment. Running this DAYS after the delete,
against the SAME dead_marker function, is a real second opinion, not a rerun of the first one.

NEVER restores anything automatically: a 'live' verdict means an already-deleted row's OWN
listing_url now serves live content again. The original row is gone — manufacturing one back from
a re-probe would itself be a guess (the row's other fields are lost), so this raises a P0
(mon_detect_deleted_but_source_live) for a human to investigate and decide the repair, per the
same source-truth rules as any other data restoration.

LEGACY BACK-AUDIT MODE (--legacy, added 2026-08-24 with barrier 14). The retired `aqar_cleanup`
path hard-deleted 21,371 rows and wrote no per-row evidence at all, so there is no
cleanup_deletion_log to sample. ops_hard_deleted_listing_backaudit reconstructs what identity
survived in other ops snapshots; this mode re-probes the 65 of those rows that still carry a source
key and writes an honest verdict back.

It refuses to guess in the one place this mode could: only ONE of those 65 rows kept its real
listing_url, so the rest have to be addressed by a URL BUILT from ad_number, and a built URL that
the platform does not actually serve would 404 for a perfectly live listing — manufacturing "dead"
out of a bad guess. So the URL form is CALIBRATED first, against listings that are currently live in
our own DB: if the built form does not serve those, no built-URL verdict is emitted at all and every
such row stays `inconclusive`. Same rule as everywhere else in this system: 403/429/5xx/timeout
proves nothing in either direction, and missing evidence is never a reason to call a row dead — nor
to restore it.

Usage:
  python -m scrapers.common.verify_deletions --platform gathern --sample 40 --days 30
  python -m scrapers.common.verify_deletions --platform wasalt --legacy --sample 100
"""
from __future__ import annotations

import argparse
import random
import re
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import PLATFORMS, _probe, verdict
from scrapers.common.db import begin_run, end_run, sb


def window_and_sample(client, platform: str, days: int, sample: int) -> tuple[int, int, list[dict]]:
    """Returns (rows in the window BEFORE the listing_url filter, rows that HAVE a listing_url,
    sampled rows). The middle value is counted before sampling, so "how many deletions can never
    be verified" stays exact no matter how few of them the sample happens to draw.

    The pre-filter count is what lets run() tell the two very different meanings of "sampled 0"
    apart. Without it, "this platform deleted nothing, so there is nothing to verify" (the safest
    state there is) and "we deleted rows we can never verify because none carries a listing_url"
    (a real defect) are the same number, and RC-B reports both as a blocked source."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = (client.table("cleanup_deletion_log")
            .select("id, platform, source_table, listing_id, listing_url, deleted_at")
            .eq("platform", platform).gte("deleted_at", since).execute().data or [])
    window_total = len(rows)
    rows = [r for r in rows if (r.get("listing_url") or "").strip()]
    with_url = len(rows)
    if with_url > sample:
        rows = random.sample(rows, sample)
    return window_total, with_url, rows


def sample_recent_deletions(client, platform: str, days: int, sample: int) -> list[dict]:
    """Pulls the full deletion-log window for this platform, then samples in Python — kept
    separate from the network loop so the sampling logic is unit-testable without a real DB or
    network, and so a future stratified-sampling change (e.g. weight toward older deletions,
    where a systematic bug would have had the most time to matter) only touches this function."""
    return window_and_sample(client, platform, days, sample)[2]


def classify(rows: list[dict], dead_marker, probe=None) -> list[dict]:
    """Pure-ish function (network isolated behind `probe`, injectable for tests): re-fetches each
    row's own listing_url and classifies it with the SAME verdict() function cleanup.py's delete
    step uses. 'dead' = still gone, correctly deleted. 'live' = FALSE DELETION, the finding this
    whole script exists to catch. 'unknown' = inconclusive (403/429/5xx/timeout/network error) —
    reported, never treated as either verdict; a block does not vindicate or condemn a past delete.

    `probe` resolves to the module-level `_probe` at CALL time via the `probe or _probe` line
    below, not at import time — deliberately, so a test (or future caller) that monkeypatches this
    module's `_probe` name is honored even though `run()` never passes `probe=` explicitly. A
    `probe=_probe` default argument would bind the real network function once, at import, and
    silently ignore any later monkeypatch."""
    probe = probe or _probe
    out = []
    for r in rows:
        status, body = probe(r["listing_url"])
        v = verdict(status, body, dead_marker)
        out.append({**r, "http_status": status, "verify_verdict": v})
    return out


def run(platform: str, *, days: int = 30, sample: int = 40) -> dict:
    client = sb()
    reg = PLATFORMS.get(platform)
    dead_marker = (reg or {}).get("dead_marker")
    run_id = begin_run(f"verify_deletions:{platform}")
    stats = {"platform": platform, "sampled": 0, "still_dead": 0, "live": 0, "unknown": 0}
    try:
        if dead_marker is None:
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                     notes="no dead-check registered for this platform — nothing to verify")
            return stats

        window_total, with_url, rows = window_and_sample(client, platform, days, sample)
        stats["sampled"] = len(rows)
        stats["window_total"] = window_total
        stats["unverifiable"] = window_total - with_url

        # A platform that deleted nothing in the window has nothing to verify, and that is the
        # SAFEST state this job can report — but rows_seen=0 makes RC-B demote the run to
        # ok=False with "blocked/empty source?", which is how verify_deletions:aqar and
        # verify_deletions:wasalt read as failing every week while cleanup:aqar/cleanup:wasalt
        # were (correctly) aborting on their anomaly gate and had never hard-deleted a single
        # row. Opt out of RC-B for that one case ONLY, and prove it from the pre-filter count so
        # a genuinely broken run can still never borrow the exemption.
        if window_total == 0:
            end_run(run_id, ok=True, rows_seen=0, rows_upserted=0, allow_empty=True,
                    notes=(f"sampled=0 still_dead=0 live=0 unknown=0 | no deletions logged for "
                           f"this platform in the last {days}d — nothing to verify"))
            print(f"✓ verify_deletions {platform}: no deletions in the last {days}d window — "
                  f"nothing to verify", flush=True)
            return stats

        # Deletions DID happen but not one of them carries a listing_url, so no probe can ever
        # be built: these rows can never be shown to have been correctly deleted. That is a real
        # defect in whatever wrote them, not an empty window, and it must stay red.
        if not rows:
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                    notes=(f"{window_total} deletion(s) in the last {days}d window but NONE has a "
                           f"listing_url — these deletions are unverifiable"))
            return stats

        results = classify(rows, dead_marker)

        log_rows = []
        for r in results:
            v = r["verify_verdict"]
            if v == "dead":
                stats["still_dead"] += 1
            elif v == "live":
                stats["live"] += 1
            else:
                stats["unknown"] += 1
            log_rows.append({
                "deletion_log_id": r["id"], "platform": platform, "source_table": r["source_table"],
                "listing_id": r["listing_id"], "listing_url": r["listing_url"],
                "deleted_at": r["deleted_at"], "http_status": r["http_status"], "verdict": v,
            })
        if log_rows:
            for i in range(0, len(log_rows), 200):
                client.table("cleanup_deletion_verification").insert(log_rows[i:i + 200]).execute()

        unverifiable_note = (f" unverifiable={stats['unverifiable']}"
                             if stats["unverifiable"] else "")
        end_run(run_id, ok=True, rows_seen=stats["sampled"], rows_upserted=stats["live"],
                 notes=(f"sampled={stats['sampled']} still_dead={stats['still_dead']} "
                        f"live={stats['live']} unknown={stats['unknown']}{unverifiable_note}"))
        print(f"✓ verify_deletions {platform}: sampled={stats['sampled']} "
              f"still_dead={stats['still_dead']} live={stats['live']} unknown={stats['unknown']}",
              flush=True)
        if stats["live"]:
            print(f"  ⚠ {stats['live']} deleted row(s) now serve LIVE content on their own "
                  f"original URL — a false deletion. Logged to cleanup_deletion_verification; "
                  f"mon_detect_deleted_but_source_live raises a P0 from it.", flush=True)
        return stats
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")
        raise


# ── Legacy back-audit ────────────────────────────────────────────────────────────────────────────
BACKAUDIT_TABLE = "ops_hard_deleted_listing_backaudit"

# Rows the back-audit may still learn something about. 'dead' and 'live' are settled; a row with no
# surviving source key is settled too ('unverifiable_no_source_key') and must never be re-classified
# by guesswork. 'inconclusive' is retried because a block is a statement about the probe, not the row.
BACKAUDIT_OPEN = ("unaudited", "inconclusive")

# How many known-live listings to test the built-URL form against before trusting any built URL.
CALIBRATION_CONTROLS = 8


def build_probe_url(platform: str, ad_number: str | None, listing_url: str | None) -> str | None:
    """The row's OWN url when it survived; otherwise one built from ad_number — which is only ever
    used after calibrate_url_form() proves the platform serves that form. wasalt ad numbers are
    'WST<digits>' and its canonical page is /en/property/<slug>-<digits>; the id-only form is what
    we calibrate. Any other platform returns None: no key, no probe, no verdict."""
    if (listing_url or "").strip():
        return listing_url.strip()
    if platform != "wasalt":
        return None
    m = re.search(r"(\d{4,})", ad_number or "")
    return f"https://wasalt.sa/en/property/{m.group(1)}" if m else None


def calibrate_url_form(client, platform: str, *, controls: int = CALIBRATION_CONTROLS,
                       probe=None) -> tuple[str, dict]:
    """Decide whether a BUILT url can be trusted, using listings that are live in our DB right now.

    Returns one of:
      'valid'       — the source served the built form for every control whose real url it served,
                      so a 404 on a built url means the listing is genuinely gone.
      'invalid'     — the source served real urls but not built ones: the form is wrong, and every
                      404 it produces would be an artefact. No built-url verdicts are emitted.
      'unreachable' — the source did not serve the controls' REAL urls either (403/429/5xx/timeout),
                      so nothing can be concluded about anything this run.

    This exists because the alternative — trusting a constructed URL — is exactly how a back-audit
    manufactures false 'dead' verdicts for listings that are still live."""
    probe = probe or _probe
    reg = PLATFORMS.get(platform) or {}
    tables = reg.get("tables") or []
    rows: list[dict] = []
    for t in tables:
        got = (client.table(t).select("id, ad_number, listing_url")
               .eq("active", True).limit(controls).execute().data or [])
        rows.extend(r for r in got if (r.get("listing_url") or "").strip()
                    and (r.get("ad_number") or "").strip())
        if len(rows) >= controls:
            break
    rows = rows[:controls]
    detail = {"controls": len(rows), "real_ok": 0, "built_ok": 0, "built_tested": 0}
    if not rows:
        return "unreachable", detail

    for r in rows:
        real_status, _ = probe(r["listing_url"])
        if real_status != 200:
            continue
        detail["real_ok"] += 1
        built = build_probe_url(platform, r.get("ad_number"), None)
        if not built:
            continue
        detail["built_tested"] += 1
        built_status, _ = probe(built)
        if built_status == 200:
            detail["built_ok"] += 1

    if detail["real_ok"] == 0:
        return "unreachable", detail
    if detail["built_tested"] == 0 or detail["built_ok"] < detail["built_tested"]:
        return "invalid", detail
    return "valid", detail


def run_legacy(platform: str, *, sample: int = 100, probe=None) -> dict:
    """Re-probe the recoverable-key population of ops_hard_deleted_listing_backaudit and record what
    the source says now. NEVER restores a row: a restore needs the whole row, and all this can prove
    is that a URL is live. A 'live' verdict raises P0 through mon_detect_deleted_but_source_live."""
    client = sb()
    probe = probe or _probe
    reg = PLATFORMS.get(platform)
    dead_marker = (reg or {}).get("dead_marker")
    run_id = begin_run(f"backaudit:{platform}")
    stats = {"platform": platform, "candidates": 0, "probed": 0,
             "dead": 0, "live": 0, "inconclusive": 0, "calibration": "not_run"}
    try:
        if dead_marker is None:
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                    notes="no dead-check registered for this platform — nothing to verify")
            return stats

        tables = (reg or {}).get("tables") or []
        rows = (client.table(BACKAUDIT_TABLE)
                .select("id, source_table, listing_id, ad_number, listing_url, verdict")
                .in_("verdict", list(BACKAUDIT_OPEN)).execute().data or [])
        rows = [r for r in rows if r.get("source_table") in tables][:sample]
        stats["candidates"] = len(rows)
        if not rows:
            end_run(run_id, ok=True, rows_seen=0, rows_upserted=0, notes="no open back-audit rows")
            print(f"✓ backaudit {platform}: no open rows", flush=True)
            return stats

        form, cal = calibrate_url_form(client, platform, probe=probe)
        stats["calibration"] = form
        print(f"  calibration: {form} {cal}", flush=True)

        for r in rows:
            url = build_probe_url(platform, r.get("ad_number"), r.get("listing_url"))
            built = not (r.get("listing_url") or "").strip()
            if not url or (built and form != "valid"):
                # Not a verdict, and deliberately not written as one: an unusable URL says nothing
                # about the listing. Left open so a later run with a working probe can settle it.
                stats["inconclusive"] += 1
                client.table(BACKAUDIT_TABLE).update({
                    "probed_at": datetime.now(timezone.utc).isoformat(), "verdict": "inconclusive",
                    "note": f"url form {form}; no trustworthy probe url for this row",
                }).eq("id", r["id"]).execute()
                continue

            status, body = probe(url)
            v = verdict(status, body, dead_marker)          # dead | live | unknown
            mapped = {"dead": "dead", "live": "live"}.get(v, "inconclusive")
            stats["probed"] += 1
            stats[mapped] += 1
            client.table(BACKAUDIT_TABLE).update({
                "probed_at": datetime.now(timezone.utc).isoformat(), "http_status": status,
                "verdict": mapped,
                "note": f"probed {'own' if not built else 'built'} url; form={form}",
            }).eq("id", r["id"]).execute()

        end_run(run_id, ok=True, rows_seen=stats["candidates"], rows_upserted=stats["live"],
                notes=(f"calibration={form} probed={stats['probed']} dead={stats['dead']} "
                       f"live={stats['live']} inconclusive={stats['inconclusive']}"))
        print(f"✓ backaudit {platform}: candidates={stats['candidates']} probed={stats['probed']} "
              f"dead={stats['dead']} live={stats['live']} inconclusive={stats['inconclusive']}",
              flush=True)
        if stats["live"]:
            print(f"  ⚠ {stats['live']} legacy-deleted row(s) are LIVE at source — false deletions. "
                  f"They are NOT auto-restored: the deleted rows' other fields are gone, and "
                  f"rebuilding a listing from a probe would be the same guessing the legacy path "
                  f"did. mon_detect_deleted_but_source_live raises P0 from these rows.", flush=True)
        return stats
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")
        raise


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Post-delete spot-check: re-probe a sample of recently hard-deleted listings")
    ap.add_argument("--platform", required=True)
    ap.add_argument("--days", type=int, default=30, help="lookback window over cleanup_deletion_log")
    ap.add_argument("--sample", type=int, default=40, help="max rows to re-probe per run")
    ap.add_argument("--legacy", action="store_true",
                    help="back-audit ops_hard_deleted_listing_backaudit (the retired aqar_cleanup "
                         "path's deletions) instead of the engine's own deletion log")
    args = ap.parse_args()
    if args.legacy:
        run_legacy(args.platform, sample=args.sample)
    else:
        run(args.platform, days=args.days, sample=args.sample)
    return 0


if __name__ == "__main__":
    sys.exit(main())
