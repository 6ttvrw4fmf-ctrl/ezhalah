"""A DORMANT platform that crawls real listings again goes back to 'active' — by itself.

OWNER DOWN-RULE (2026-09-24, amended 2026-09-26): a site that is down on its own side is set
`platform_registry.status = 'dormant'` (listings, logo and platform count all leave), it is re-probed
EVERY day, and it comes back on its own the day it serves real listings again.

Until 2026-09-27 nothing did the "comes back" half. The dormant gate's own migration
(20260925005252) says a platform "flips itself back on the next successful crawl + sync", but the
gate reads `status`, and no code ever wrote 'active' back — a recovered site stayed hidden until a
human noticed.

This runs as the last job of small-sources-sync.yml, i.e. right after the daily crawl, which already
re-crawls every dormant source (that crawl IS the re-probe). Only a run that started inside THIS
workflow run counts, so a good crawl from before a platform was put down can never bring it back.
Once 'active', the logo and count return at once and the listings return on the next
sync_search_listings_ar.

ponytail: "real listings" = the crawl ended ok with rows_upserted > 0 (the scrapers already demote a
0-row run to ok=false). A site that serves one placeholder listing under every id would pass; the
junior engineer's §5.3 content check is what catches that, and it can set the platform dormant again.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from typing import Any, Optional


def is_back(latest_run: Optional[dict[str, Any]], since: datetime) -> bool:
    """The platform's newest scrape_runs row is from this crawl, ended ok, and upserted listings."""
    return bool(
        latest_run
        and datetime.fromisoformat(latest_run["started_at"]) >= since
        and latest_run["ok"]
        and (latest_run["rows_upserted"] or 0) > 0
    )


def main() -> None:
    from scrapers.common.db import _execute, sb

    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="ISO time this workflow run started")
    since = datetime.fromisoformat(ap.parse_args().since)

    dormant = _execute(
        sb().table("platform_registry").select("platform,notes").eq("status", "dormant"),
        what="dormant platforms",
    ).data
    for p in dormant:
        runs = _execute(
            sb().table("scrape_runs").select("id,started_at,ok,rows_upserted")
            .eq("platform", p["platform"]).order("started_at", desc=True).limit(1),
            what=f"{p['platform']} latest run",
        ).data
        run = runs[0] if runs else None
        if not is_back(run, since):
            print(f"still down: {p['platform']} (latest run {run and run['id']}, ok={run and run['ok']})")
            continue
        now = datetime.now(timezone.utc)
        note = (f"ACTIVE again {now.date()} (auto, small-sources-sync): scrape_runs #{run['id']} ended ok "
                f"with {run['rows_upserted']} listings. " + (p["notes"] or ""))
        _execute(
            sb().table("platform_registry")
            .update({"status": "active", "notes": note, "updated_at": now.isoformat()})
            .eq("platform", p["platform"]).eq("status", "dormant"),
            what=f"{p['platform']} dormant -> active",
        )
        print(f"::notice::{p['platform']} is back: dormant -> active (scrape_runs #{run['id']}, "
              f"{run['rows_upserted']} listings). Logo + count return now; listings on the next sync.")


if __name__ == "__main__":
    main()
