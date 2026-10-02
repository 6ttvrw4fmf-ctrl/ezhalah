"""Paced fill: the aqar deep fill reads EVERY page of a slice, but adds a bounded number of new rows.

WHY (coverage audit 2026-09-28, re-measured 2026-10-02). The deep fill stopped at 150 pages per
(type × deal × city) slice while aqar paginates to ceil(numberOfItems / 20): Riyadh apartments for
rent publish 22,413 ads (1,121 pages), Jeddah apartments for sale 25,048 (1,253 pages), and we held
4,888 and 5,238 of them. Reading every page closes that gap, but writing it in one go is the
2026-09-21 disk incident again (~3 GB in minutes filled the disk before autoscale could react). So:

  * NEW ads (not in our table) are written only while the WORKFLOW RUN's budget lasts. The budget
    is one pool shared by every parallel shard, drawn through the DB (aqar_fill_claim), so 100
    machines cannot each spend it. Whatever is left over is deferred, not lost.
  * RESUME is derived from what we already hold: the next run walks the same pages, and the ads the
    last run wrote are now held, so the budget goes to the next ones. No page cursor to drift when
    aqar inserts ads above it.
  * HELD ads are re-enriched (PRICE = SOURCE refresh, the deep fill's job since 2026-08-04) only
    once their last capture is `refresh_after_days` old, so a run every 12 h does not rewrite the
    whole table every 12 h. Inactive held ads are always re-read, exactly as before.

A fill that cannot prove it is inside its budget writes no new rows (fail closed).
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from scrapers.aqar.discover import LISTING_RE, PAGE_SIZE
from scrapers.common import db


def ad_number(url: str) -> Optional[str]:
    m = LISTING_RE.search(url)
    return m.group(1) if m else None


def run_key(platform: str) -> str:
    """One budget per WORKFLOW run: every shard of the run passes the same FILL_RUN_KEY."""
    return os.environ.get("FILL_RUN_KEY") or f"local:{platform}:{os.getpid()}:{int(time.time())}"


def claim(key: str, budget: int, want: int) -> int:
    """Draw up to `want` new rows from this run's shared budget; returns how many were granted."""
    return int(db._execute(
        db.sb().rpc("aqar_fill_claim", {"p_run_key": key, "p_budget": budget, "p_want": want}),
        what="aqar_fill_claim").data or 0)


def held(table: str, ads: list[str]) -> dict[str, dict]:
    """{ad_number: {raw_captured_at, active}} for the ads we already hold. 200 ids per query."""
    out: dict[str, dict] = {}
    for i in range(0, len(ads), 200):
        rows = db._execute(
            db.sb().table(table).select("ad_number, raw_captured_at, active").in_("ad_number", ads[i:i + 200]),
            what=f"{table}.held").data or []
        out.update({str(r["ad_number"]): r for r in rows})
    return out


class PacedFill:
    """Per-process view of one run's fill: which discovered URLs to enrich, and what was deferred.

    new_budget < 0 and refresh_after_days <= 0 is the sweeps' behaviour (enrich everything found,
    no DB lookups), so the 3-page sweeps are unchanged.
    """

    def __init__(self, table: str, *, new_budget: int, refresh_after_days: int, key: str):
        self.table, self.new_budget, self.refresh_after_days, self.key = (
            table, new_budget, refresh_after_days, key)
        self.stats = {"new_granted": 0, "new_deferred": 0, "refreshed": 0, "fresh_skipped": 0,
                      "slices_short": 0}

    @property
    def active(self) -> bool:
        return self.new_budget >= 0 or self.refresh_after_days > 0

    def _take(self, want: int) -> int:
        if want <= 0:
            return 0
        if self.new_budget < 0:
            return want
        try:
            return max(0, min(want, claim(self.key, self.new_budget, want)))
        except Exception as e:  # noqa: BLE001 — no proof of budget => no new rows
            print(f"   ⚠ aqar_fill_claim failed ({str(e)[:120]}) — writing NO new rows this slice", flush=True)
            return 0

    def select(self, urls: list[str], now: Optional[datetime] = None) -> list[str]:
        """The URLs of one slice to enrich now, in page order (newest pages first)."""
        if not self.active:
            return urls
        ads = [ad_number(u) for u in urls]
        have = held(self.table, [a for a in ads if a])
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=self.refresh_after_days)
        new_urls, keep = [], []
        for url, ad in zip(urls, ads):
            row = have.get(ad) if ad else None
            if row is None:
                new_urls.append(url)
            elif (self.refresh_after_days <= 0 or not row.get("active")
                  or not row.get("raw_captured_at")
                  or datetime.fromisoformat(row["raw_captured_at"]) <= cutoff):
                keep.append(url)
            else:
                self.stats["fresh_skipped"] += 1
        granted = self._take(len(new_urls))
        self.stats["new_granted"] += granted          # an upper bound: a failed enrich writes nothing
        self.stats["new_deferred"] += len(new_urls) - granted
        self.stats["refreshed"] += len(keep)
        chosen = set(keep) | set(new_urls[:granted])
        return [u for u in urls if u in chosen]

    def note_walk(self, outcome, start_page: int, max_pages: int) -> None:
        """Count a slice whose walk ended before the source's own last page (blocked, cut short)."""
        if outcome is None or outcome.source_items is None:
            return
        want = -(-outcome.source_items // PAGE_SIZE)
        if max_pages > 0:
            want = min(want, max_pages)
        if outcome.fetch_failed or start_page - 1 + outcome.pages_fetched < want:
            self.stats["slices_short"] += 1

    def notes(self) -> Optional[str]:
        if not self.active:
            return None
        s = self.stats
        return (f"paced_fill new_granted={s['new_granted']} new_deferred={s['new_deferred']} "
                f"refreshed={s['refreshed']} fresh_skipped={s['fresh_skipped']} "
                f"slices_short={s['slices_short']} budget={self.new_budget} key={self.key}")
