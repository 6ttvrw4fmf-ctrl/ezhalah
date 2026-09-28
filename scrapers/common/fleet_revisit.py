"""FLEET REVISIT — prove listings alive on platforms whose crawl never opens a listing's own page.

WHY (owner, 2026-09-25: "build proper direct listing checks ... and verify each one actually works
in production"). `db.mark_direct_alive` lets a crawl record a direct read it already made. A
LIST-ONLY crawl (feed, search or API page) makes none, so those platforms stayed at 0% verified no
matter how healthy they were. Each of them already owns a validated per-listing oracle — the
`verify_gone` it hands to `prune_unseen` — which only ever runs on rows that reached grace. This job
runs that SAME oracle on a rotating slice of ordinary active rows.

WHAT IT MAY WRITE, and nothing else:
  * `last_verified_alive_at` — via `liveness_contract.direct_alive_patch`, only on a 'live' verdict,
    only on a row that is still active at write time;
  * `last_liveness_probe_at` — on every row it looked at, whatever the verdict ("we looked" is not
    evidence of life; it keeps a probed row from sitting at the head of the worklist forever).
It never writes `active`, `missing_count` or `last_seen_at`, and a 'gone' verdict is only counted:
removal stays with the platform's own guarded prune path. `revisit_verify()` factories are expected
to pass a canary that always refuses, so their oracle cannot even return 'gone' here.

A PLATFORM JOINS BY DEFINING `revisit_verify()` in its `scrapers/<platform>/run.py`: a zero-arg
factory returning `ad_number -> (verdict, reason)`. Discovery is by that shape; there is no list to
keep up to date.

Usage:
  python -m scrapers.common.fleet_revisit                     # every platform, default slice
  python -m scrapers.common.fleet_revisit --platform goldendeal --limit 50 --dry-run
"""
from __future__ import annotations

import argparse
import importlib
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db  # noqa: E402
from scrapers.common.liveness_contract import direct_alive_patch  # noqa: E402

Verify = Callable[[str], tuple[str, str]]
KINDS = ("residential", "commercial")
_HOOK = re.compile(r"^def revisit_verify\(\s*\)", re.M)


def refuse_removals() -> tuple[bool, str]:
    """Canary for revisit factories: removals are never decided by this job."""
    return False, "fleet_revisit never removes a listing; only the platform's own prune path does"


def discover(root: Path = ROOT) -> list[str]:
    """Platforms whose run.py defines `revisit_verify()` — found by shape, sorted."""
    return sorted(p.parent.name for p in root.glob("*/run.py") if _HOOK.search(p.read_text("utf-8")))


def _tables(platform: str) -> list[str]:
    out = []
    for kind in KINDS:
        t = f"{platform}_{kind}_listings"
        try:
            db._execute(db.sb().table(t).select("id").limit(1), what=f"{t}.revisit_exists", tries=2)
            out.append(t)
        except Exception:  # noqa: BLE001 — a platform with one table is normal
            pass
    return out


def worklist(platform: str, limit: int) -> list[tuple[str, str]]:
    """(table, ad_number) for the least-recently VERIFIED active rows, never-verified first."""
    rows: list[tuple[str, str, Optional[str]]] = []
    for t in _tables(platform):
        got = db._execute(
            db.sb().table(t).select("ad_number,last_verified_alive_at")
            .eq("active", True).order("last_verified_alive_at", desc=False, nullsfirst=True).limit(limit),
            what=f"{t}.revisit_worklist").data or []
        rows += [(t, r["ad_number"], r.get("last_verified_alive_at")) for r in got if r.get("ad_number")]
    rows.sort(key=lambda r: (r[2] is not None, r[2] or ""))
    return [(t, a) for t, a, _ in rows[:limit]]


def revisit(platform: str, verify: Verify, work: list[tuple[str, str]], *, dry_run: bool = False) -> dict:
    """Run `verify` over `work`; write only what the module docstring allows. Returns the tally."""
    tally = {"checked": 0, "live": 0, "gone": 0, "unknown": 0, "stamped": 0}
    live: dict[str, list[str]] = {}
    looked: dict[str, list[str]] = {}
    for tbl, ad in work:
        try:
            verdict, _why = verify(ad)
        except Exception:  # noqa: BLE001 — an oracle that raised knows nothing
            verdict = "unknown"
        verdict = verdict if verdict in ("live", "gone") else "unknown"
        tally["checked"] += 1
        tally[verdict] += 1
        looked.setdefault(tbl, []).append(ad)
        if verdict == "live":
            live.setdefault(tbl, []).append(ad)
    if dry_run:
        return tally
    now = datetime.now(timezone.utc).isoformat()
    for tbl, ads in looked.items():
        for i in range(0, len(ads), 200):
            db._execute(db.sb().table(tbl).update({"last_liveness_probe_at": now})
                        .in_("ad_number", ads[i:i + 200]).eq("active", True),
                        what=f"{tbl}.revisit_probed")
    for tbl, ads in live.items():
        for i in range(0, len(ads), 200):
            db._execute(db.sb().table(tbl).update(direct_alive_patch(now_iso=now))
                        .in_("ad_number", ads[i:i + 200]).eq("active", True),
                        what=f"{tbl}.revisit_alive")
            tally["stamped"] += len(ads[i:i + 200])
    return tally


def run_platform(platform: str, limit: int, dry_run: bool) -> dict:
    mod = importlib.import_module(f"scrapers.{platform}.run")
    verify: Verify = mod.revisit_verify()
    work = worklist(platform, limit)
    run_id = None if dry_run else db.begin_run(f"{platform}_revisit")
    try:
        tally = revisit(platform, verify, work, dry_run=dry_run)
    except Exception as e:
        if run_id is not None:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"fleet_revisit failed: {type(e).__name__}: {str(e)[:200]}")
        raise
    if run_id is not None:
        # A revisit where the oracle answered nothing at all is a broken checker, not a quiet day.
        ok = tally["checked"] == 0 or tally["unknown"] < tally["checked"]
        db.end_run(run_id, ok=ok, rows_seen=tally["checked"], rows_upserted=tally["stamped"],
                   notes=" ".join(f"{k}={v}" for k, v in tally.items()))
    return tally


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--platform", help="one platform (default: every platform with revisit_verify)")
    ap.add_argument("--limit", type=int, default=400, help="rows per platform per run")
    ap.add_argument("--dry-run", action="store_true", help="check, but write nothing")
    args = ap.parse_args()
    platforms = [args.platform] if args.platform else discover()
    failed = 0
    for p in platforms:
        try:
            t = run_platform(p, args.limit, args.dry_run)
            print(f"  {p}: " + " ".join(f"{k}={v}" for k, v in t.items()), flush=True)
        except Exception as e:  # noqa: BLE001 — one platform must not stop the fleet
            failed += 1
            print(f"  ✗ {p}: {type(e).__name__}: {str(e)[:200]}", flush=True)
    print(f"fleet_revisit: {len(platforms)} platform(s), {failed} failed", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
