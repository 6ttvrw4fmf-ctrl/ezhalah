"""Do the cards we serve still open the ad? A daily sample of served listing_url per website (2026-11-05).

WHY. On 2026-11-04 Dwelleo cut its catalogue from ~7,000 ads to 18. Our 4,791 served Dwelleo cards
kept their old /ar/properties/<slug> address: 15 of 15 opened «404: This page could not be found».
dead_visible_score saw it two nights running and could only say «void: known-live controls 0/5
alive» — when EVERY link of a site dies, its controls die with it, and a void row decides nothing.
This check asks the plainer question that has no controls to lose: does the served URL open a page?

WHAT IT DOES, per website with shown ads (search_listings_ar, production_ready):
  1. The site's home page must answer 200, or the website's row decides nothing (a wall, not a 404).
  2. ~20 served listing_url, one read a second, redirects followed: ok (same path, 200), moved (200 at
     another path), dead (404/410), unknown (anything else; a 403/5xx/timeout is never dead).
  3. REPAIR FIRST: a moved link whose landing keeps the ad's own last path segment on the same site is
     the site's own redirect to the new address → listing_url is rewritten to it. When most decided
     links are dead or moved, the website's crawl is re-dispatched (small-sources-sync, one comma list)
     so it stores fresh addresses for every ad, not only the sample.
  4. One row per website per night into ops_served_link_check. mon_detect_served_links_broken raises
     P1 only for what the repair could not fix (dead + moved-unrepaired >= half of decided), naming the
     website and a sample of the dead URLs; it records a repair as a self-resolving P2.
Hidden ads are never touched: a dead link is the liveness path's to hide, with its own oracle.

  python -m scrapers.common.served_link_check                    # every website, write + repair
  python -m scrapers.common.served_link_check --sites dwelleo --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from scrapers.common import http
from scrapers.common.cleanup import _landed_on_home, _probe
from scrapers.common.db import sb
from scrapers.common.dead_visible_score import registered_sites, sample, shown_count, site_list

TABLE = "ops_served_link_check"
N = 20                      # links opened per website a night
PACE_S = 1.0                # one read a second per website
MIN_DECIDED = 5             # fewer decided links than this decides nothing about the website
_SMALL_SOURCES = Path(__file__).resolve().parents[2] / ".github/workflows/small-sources-sync.yml"


def _host(u: str) -> str:
    h = urlsplit(u).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _last_segment(u: str) -> str:
    return unquote(urlsplit(u).path.rstrip("/").rsplit("/", 1)[-1])


def _ad_id_tokens(u: str) -> set[str]:
    """The ad's own id tokens in its last path segment: 8+ characters mixing letters and digits
    (dallali «7f22c416» from a UUID, erapulse «mlu12xet» from REF-MLU12XET-CD3SX). Slug words and
    short numbers are not ids (pure)."""
    return {t for t in re.split(r"[-_.]", _last_segment(u).lower())
            if len(t) >= 8 and re.search(r"\d", t) and re.search(r"[a-z]", t)}


_LOCALES = {"ar", "en"}


def _segments(u: str) -> list[str]:
    return [unquote(x) for x in urlsplit(u).path.strip("/").split("/") if x]


def _same_path_dressed(url: str, landed: str) -> bool:
    """The landing is the stored path itself, only DRESSED: a language prefix in front (macsaib
    /property/<slug> → /ar/property/<slug>) and/or one pretty segment behind (alhoshan /properties/1013 →
    /properties/1013/<عماره-للبيع-…>). Every stored segment is kept, in order, so it is the same ad. Measured
    🔧 2026-11-07: both sites read «moved» on 20 of 20 links every night; the robot rewrote them, the next
    crawl wrote the short form back, and card_parity_self_healed / served_links_self_healed re-raised daily
    (pure)."""
    s, l = _segments(url), _segments(landed)
    if not s:
        return False
    if l and l[0].lower() in _LOCALES and s[0].lower() not in _LOCALES:
        l = l[1:]
    return l[:len(s)] == s and len(l) - len(s) <= 1


def same_ad_redirect(url: str, landed: str | None) -> bool:
    """The site redirected the stored link to its new pretty address FOR THE SAME AD: same site and
    the landing's last segment carries one of the ad's own id tokens (falcon 2026-11-06: dallali
    UUID → «…-7f22c416», erapulse «…-ref-mlu12xet-cd3sx» → «…-REF-MLU12XET-CD3SX»). The customer
    lands on the ad, so the card works (pure)."""
    if not landed or _host(landed) != _host(url):
        return False
    if _same_path_dressed(url, landed):
        return True
    tail = _last_segment(landed).lower()
    if any(t in tail for t in _ad_id_tokens(url)):
        return True
    # a two-part reference whose first part has no digit (erapulse «ref-mlpbkvag-6hus9»): the last two tokens
    # joined, 10+ characters with a digit, must appear whole in the landing's last segment.
    parts = [t for t in re.split(r"[-_.]", _last_segment(url).lower()) if t]
    pair = "-".join(parts[-2:]) if len(parts) >= 2 else ""
    return len(pair) >= 10 and bool(re.search(r"\d", pair)) and pair in tail


def classify(url: str, status: int | None, landed: str | None) -> str:
    """ok / moved / dead / unknown for one opened link (pure)."""
    if status in (404, 410):
        return "dead"
    if status != 200:
        return "unknown"
    if not landed or unquote(urlsplit(landed).path.rstrip("/")) == unquote(urlsplit(url).path.rstrip("/")):
        return "ok"
    if same_ad_redirect(url, landed):
        return "ok"                 # redirected to the same ad's new address: the card opens the ad
    if _landed_on_home(url, landed):
        return "unknown"            # sent home: no answer about the ad
    return "moved"


def repairable(url: str, landed: str | None) -> bool:
    """A moved link is the site's own new address for THIS ad when it stays on the same site and keeps
    the ad's own last path segment (its slug or id). Anything else is not ours to guess (pure)."""
    seg = _last_segment(url)
    return bool(landed and seg and _host(landed) == _host(url) and seg in unquote(urlsplit(landed).path))


def broken(row: dict) -> bool:
    """Most decided links do not open the ad (pure). The detector applies the same line in SQL."""
    decided = row["ok"] + row["moved"] + row["dead"]
    return decided >= MIN_DECIDED and 2 * (row["dead"] + row["moved"]) >= decided


# THE ADDRESS THE CUSTOMER OPENS, not the one we store (🔗 Click Guardian 2026-11-09). src/lib/adLocale.ts
# never opens Gathern's unprefixed /view/… (7 of 280 live units answered it with a redirect home, backlog
# 768): the Arabic app opens /ar/view/…, the English app /en/view/…. This check read the stored /view/ and
# called two live units dead on night 11-08 (gathern 174185/unit/246182 + 246183: bare 404 on /view/ from
# CI twice, while gathern's liveness read their /ar/view/ ALIVE at 02:38 and the crawl listed them at 04:21;
# the customer journey's own evidence shows a gathern card opening gathern.co/ar/view/…). The check now
# opens what the Arabic app opens, so a «dead» is a page a customer would really hit.
_GATHERN_VIEW = re.compile(r"^(https?://(?:www\.)?gathern\.co)(?:/(?:ar|en))?(/view/.*)$", re.I)


def customer_url(url: str) -> str:
    """The URL the Arabic app opens for a stored listing_url (pure; mirrors localizeAdUrl(url, 'ar'))."""
    m = _GATHERN_VIEW.match(url or "")
    return f"{m.group(1)}/ar{m.group(2)}" if m else url


def open_link(url: str) -> tuple[int | None, str | None]:
    """(status, landed URL). wasalt and walled reads go through the deletion tier's own transport
    (cleanup._probe: wasalt's browser, the fallback profiles), which reports status only."""
    if "wasalt." in url:
        return _probe(url)[0], None
    try:
        r = http.session().get(url, timeout=25, allow_redirects=True)
        status, landed = r.status_code, str(getattr(r, "url", "") or url)
    except Exception:  # noqa: BLE001 — unreadable is no opinion
        status, landed = None, None
    if status is None or status in http.BLOCK_STATUSES:
        return _probe(url)[0], None
    return status, landed


def small_sources() -> set[str]:
    try:
        return set(re.findall(r"^\s*-\s*\{\s*source:\s*([\w-]+)", _SMALL_SOURCES.read_text(), re.M))
    except OSError:
        return set()


def check_site(client, platform: str, shown: int, *, rng: random.Random, night: str, write: bool,
               pace: float = PACE_S) -> dict:
    row = {"night": night, "platform": platform, "shown": shown, "sampled": 0, "ok": 0, "moved": 0,
           "repaired": 0, "dead": 0, "unknown": 0, "home_status": None, "dead_sample": [], "note": None}
    picked = [r for r in sample(client, platform, shown, N, rng) if str(r.get("listing_url") or "").startswith("http")]
    if not picked:
        row["note"] = "no served link to open"
        return row
    u = urlsplit(picked[0]["listing_url"])
    row["home_status"], _ = open_link(f"{u.scheme}://{u.netloc}/")
    if row["home_status"] != 200:
        row["note"] = f"home page answered {row['home_status']}: nothing decided (a wall is not a 404)"
        return row
    for r in picked:
        time.sleep(pace)
        opened = customer_url(r["listing_url"])
        status, landed = open_link(opened)
        kind = classify(opened, status, landed)
        row["sampled"] += 1
        row[kind] += 1
        if kind == "moved":
            # falcon 2026-11-06: the alert names dead_sample only, so a site whose links all «moved»
            # (dallali 16/17, erapulse 20/20) gave nobody the landing page to act on. Print it.
            print(f"  moved {platform}: {r['listing_url']} -> {landed}", flush=True)
        if kind == "dead" and len(row["dead_sample"]) < 5:
            row["dead_sample"].append(r["listing_url"])
        if kind == "moved" and repairable(r["listing_url"], landed):
            row["repaired"] += 1
            if write:
                client.table(r["table"]).update({"listing_url": landed}).eq("id", r["id"]).execute()
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description="Do served cards still open the ad? A daily sample per website")
    ap.add_argument("--sites", nargs="*")
    ap.add_argument("--pace", type=float, default=PACE_S)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="print the rows; no rewrite, no write")
    a = ap.parse_args()

    client = sb()
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    run = [os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID")]
    run_url = f"{run[0]}/{run[1]}/actions/runs/{run[2]}" if all(run) else None
    crawlable = small_sources()
    rows: list[dict] = []
    # ponytail: one website after another, ~20 s each (~1 h for the fleet); a thread per site if it gets tight.
    for p in site_list(a.sites) or registered_sites(client):
        shown = shown_count(client, p)
        if not shown:
            continue
        try:
            row = check_site(client, p, shown, rng=rng, night=night, write=not a.dry_run, pace=a.pace)
        except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet; its row says so
            row = {"night": night, "platform": p, "shown": shown, "sampled": 0, "ok": 0, "moved": 0,
                   "repaired": 0, "dead": 0, "unknown": 0, "home_status": None, "dead_sample": [],
                   "note": f"error: {type(e).__name__}: {e}"[:300]}
        row["redispatched"] = broken(row) and p in crawlable
        row["run_url"] = run_url
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    redispatch = sorted(r["platform"] for r in rows if r["redispatched"])
    # The workflow dispatches ONE small-sources-sync run with this comma list (never one per site).
    with open("served-link-redispatch.txt", "w", encoding="utf-8") as f:
        f.write(",".join(redispatch))
    if rows and not a.dry_run:
        client.table(TABLE).upsert(rows, on_conflict="night,platform").execute()
    print(f"{len(rows)} websites checked; broken: {[r['platform'] for r in rows if broken(r)]}; "
          f"re-dispatch: {redispatch or 'none'}", flush=True)
    return 0 if any(r["sampled"] for r in rows) or not rows else 1


if __name__ == "__main__":
    sys.exit(main())
