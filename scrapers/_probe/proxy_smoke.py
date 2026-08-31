"""Proxy SMOKE TEST — non-destructive. Confirms a CANDIDATE Saudi residential proxy (e.g. DataImpulse)
can fetch REAL Wasalt + Souq24 listing PAGES — not the geo-block / homepage shell or an error page —
and reports a per-site real-page success rate plus the exit-IP country.

It reuses the SAME real-vs-shell checks the production scrapers use, so "real page" means exactly what
the scrapers need:
  * Wasalt  → scrapers.wasalt.liveness.get_verdict(): 'live' iff __NEXT_DATA__.propertyDetailsV3 present.
              'dead' = 200-but-no-payload (shell/removed), 'failed' = block/timeout/5xx/403.
  * Souq24  → scrapers.souq24.run.fetch_one(): returns the page only when realestate_name is non-empty;
              the sold/deleted/geo-blocked homepage shell (~242 KB) returns None.

SAFETY: it reads the candidate proxy from --proxy-env (default DATAIMPULSE_PROXY_URL) and maps it into
the in-process env the scrapers read (WASALT_PROXY_URL / SOUQ24_PROXY_URL) FOR THIS PROCESS ONLY. It does
NOT change the stored WASALT_PROXY_URL secret, so Webshare stays live and this is a pure read-only probe
(writes nothing to the DB). Point --proxy-env at WASALT_PROXY_URL to baseline Webshare (when it has GB).

  python -m scrapers._probe.proxy_smoke --proxy-env DATAIMPULSE_PROXY_URL --n 30
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))


def _sample_urls(db, table: str, n: int) -> list[str]:
    """Newest active listing_urls (newest = most likely still live, so a shell result points at the
    proxy, not a sold listing)."""
    res = db._execute(
        db.sb().table(table).select("listing_url").eq("active", True).order("id", desc=True).limit(n),
        what=f"{table}.smoke_sample",
    )
    return [x["listing_url"].strip() for x in (res.data or []) if (x.get("listing_url") or "").strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description="Non-destructive Saudi-residential proxy smoke test")
    ap.add_argument("--proxy-env", default="DATAIMPULSE_PROXY_URL",
                    help="Name of the env/secret holding the proxy URL to TEST (default DataImpulse).")
    ap.add_argument("--n", type=int, default=30, help="Sample size PER site.")
    args = ap.parse_args()

    proxy = os.environ.get(args.proxy_env, "").strip()
    if not proxy:
        print(f"✗ {args.proxy_env} is empty — set that proxy secret first, then re-run.", flush=True)
        return 1
    # Point the in-process env the scrapers read at the CANDIDATE proxy. Does NOT touch the stored secret,
    # so the live Webshare wiring is untouched. souq24.run reads its proxy at import time, so set BEFORE importing.
    os.environ["WASALT_PROXY_URL"] = proxy
    os.environ["SOUQ24_PROXY_URL"] = proxy

    from curl_cffi import requests as cc

    from scrapers.common import db

    print(f"── SMOKE TEST via {args.proxy_env} (n={args.n}/site) — read-only, Webshare secret untouched ──", flush=True)

    # ── 1) exit-IP geo / connectivity ────────────────────────────────────────────
    geo = "unknown"
    try:
        s = cc.Session(impersonate="chrome124")
        s.proxies = {"http": proxy, "https": proxy}
        j = s.get("https://ipinfo.io/json", timeout=30).json()
        geo = f"country={j.get('country')} ip={j.get('ip')} org={(j.get('org') or '')[:45]}"
    except Exception as e:
        geo = f"geo-check FAILED: {str(e)[:90]}"
    print(f"EXIT IP: {geo}", flush=True)

    # ── 2) Wasalt real-page rate (reuse production liveness check) ────────────────
    from scrapers.wasalt import liveness as wl
    wurls = _sample_urls(db, "wasalt_residential_listings", args.n) + \
        _sample_urls(db, "wasalt_commercial_listings", max(0, args.n // 3))
    wurls = wurls[: args.n]
    w_live = w_dead = w_fail = 0
    for u in wurls:
        verdict, _st, _nb = wl.get_verdict(u)
        w_live += verdict == "live"
        w_dead += verdict == "dead"
        w_fail += verdict == "failed"
    w_tot = max(1, len(wurls))
    print(f"WASALT : {len(wurls)} sampled → REAL(live)={w_live}  shell/removed(dead)={w_dead}  "
          f"blocked/timeout(failed)={w_fail}  → real-rate={100 * w_live / w_tot:.0f}%", flush=True)

    # ── 3) Souq24 real-page rate (reuse production detail fetch) ──────────────────
    from scrapers.souq24 import run as sq
    surls = _sample_urls(db, "souq24_residential_listings", args.n) + \
        _sample_urls(db, "souq24_commercial_listings", args.n)
    surls = surls[: args.n]
    s_real = s_shell = 0
    for u in surls:
        m = re.search(r"/(\d+)/", u)
        if not m:
            continue
        if sq.fetch_one(int(m.group(1))):  # returns the page ONLY for a real active listing
            s_real += 1
        else:
            s_shell += 1  # homepage shell (sold/deleted) OR datacenter geo-block
    s_tot = max(1, s_real + s_shell)
    print(f"SOUQ24 : {s_tot} sampled → REAL={s_real}  shell/none={s_shell}  → real-rate={100 * s_real / s_tot:.0f}%", flush=True)

    # ── verdict guidance ─────────────────────────────────────────────────────────
    print("\nPASS if: EXIT country=SA, Wasalt real-rate high with ~0 failed, and Souq24 real-rate high.", flush=True)
    print("FAIL (do NOT switch) if: exit country != SA, many Wasalt 'failed' (blocked/timeout), or low", flush=True)
    print("real-rate on either site (proxy IPs are datacenter-flagged and served the shell).", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
