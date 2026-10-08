"""Daily DIRECT liveness for every site with a measured oracle — the same job aqar gets (owner,
2026-09-28: «Aqar is doing a good job; we need the same job for all those websites, urgently», and
«every website must be as strong as Aqar, not weaker»).

Aqar works because every day its live listings are re-read at their own URL, three "gone" answers
in a row hide one, and a live answer clears the strikes and stamps last_verified_alive_at. A small
site's crawl only tells us an ad is still in its index; this job asks each ad's own page.

PER SITE, EVERY RUN (one matrix job per site, its own run label fleet_liveness:<site>, §9):
  1. Worklist: EVERY active row, every day — aqar's window (DIRECT_REVISIT/48h, swept daily). Struck
     rows first, then the longest since we last looked, so a run cut short reads the rows that
     matter first. One read per PACE_S; a site stops reading at BUDGET_S and says how much of its
     active set it covered, so a site too big for aqar's window is visible, never quietly partial.
     A row its own crawl proved alive DIRECTLY in the last FRESH_HOURS, with no strike, is covered
     already and not read twice.
     Live stamps and "we looked" are written every FLUSH reads, so a job that is cancelled or cut
     short keeps what it read and the next run starts where it stopped.
  2. Opening controls: MIN_CANARIES ads its crawl saw most recently must come back 'live' through the
     site's own oracle, or the site is skipped this run (liveness_trust.canary_environment_ok).
  3. Each ad is read by THE SITE'S OWN measured oracle — the same `verify_gone` its scraper hands
     to db.prune_unseen(), never a copy — and the answer goes through liveness_contract.decide():
     'gone' → a DIRECT strike, the 3rd hides it; 'live' → strikes cleared + last_verified_alive_at;
     anything else → UNKNOWN, nothing written but "we looked".
  4. Closing controls, and a per-site cap: more hides than max(KILL_FLOOR, KILL_FRAC × active) in
     one run is a broken checker or a block, not a mass delisting. Either failing, no strike and no
     hide is written (ALIVE stamps stand: a block cannot fabricate a live page, §5.4). Exception
     (2026-10-08): when EVERY control read live at both ends, an over-cap batch hides the cap's
     worth and carries the rest (gathern's capped drain); the cap itself never moves.
  5. Every hide first writes its evidence row (ops_stale_inactivation_probe, verdict GONE, the
     oracle's own reason) so mon_detect_prune_kill_without_source_verdict can account for it.

RECHECK (--struck-only, fleet-liveness-recheck.yml, 12 hours after each daily run). An ad the source
removed needs three 'gone' readings; read once a day that is three days on our site. The recheck
re-reads ONLY the rows already carrying a strike, each no sooner than REPROBE_MIN_HOURS after its
last reading (gathern's rule: three separate checks, never back-to-back), under the same controls
and cap — daily, recheck, daily: a removed ad is hidden 24 hours after its first 'gone', and a
strike that was a blip is cleared the same day. A site with no struck row is not touched.

SHADOW FIRST. A site outside APPLY decides everything and writes nothing (LIFECYCLE_ENGINEER.md,
protection 2). A site joins APPLY only after its shadow run was read: controls right, would-hides
under the cap and confirmed gone by a second transport (lifecycle-spot-check.yml).

  python -m scrapers.common.fleet_liveness --site raghdan            # outside APPLY: shadow
  python -m scrapers.common.fleet_liveness --site raghdan --shadow
"""
from __future__ import annotations

import argparse
import importlib
import math
import sys
import time
from datetime import datetime, timedelta, timezone

from scrapers.common.db import begin_run, end_run, sb
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN, EvidenceKind, decide, verification_patch
from scrapers.common.liveness_policies import FLEET_DAILY_DIRECT, policy_for
from scrapers.common.liveness_trust import MIN_CANARIES, canary_environment_ok

# platform → its scraper's own measured oracle, exactly what it hands to db.prune_unseen():
#   "module:attr"      a verify_gone(ad_number) -> (verdict, reason)
#   "module:factory()" a factory that takes a positive-control row and returns that callable
#                      (`_make_verify_gone(control)`, the canary-gated shape 30 scrapers share)
# A site starts in shadow and joins APPLY only after its shadow run was read.
SITES: dict[str, str] = {
    **{p: f"scrapers.{p}.run:_probe.verify_gone" for p in (
        "aldarim", "aqaralriyadh", "hajer", "jazwtn", "souq24")},
    **{p: f"scrapers.{p}.run:_verify_gone" for p in (
        "akariyoun", "aljassim", "almotmkenah", "alshawaf", "aqaralsaudia", "aqargate", "bossbih",
        "daryusuf", "eaqartabuk", "ebriza", "eilmalriyada", "hasaad", "moftah", "nufouth", "raghdan",
        "sakani", "snam", "suwar")},
    **{p: f"scrapers.{p}.run:verify_gone" for p in ("wadod",)},
    # 2026-10-08: its oracle needs the label taxonomy the crawl reads; this factory reads it itself.
    "shatri": "scrapers.shatri.run:_fleet_verify_gone()",
    **{p: f"scrapers.{p}.run:_make_verify_gone()" for p in (
        "abaad", "albdah", "alsaedan", "azure", "dwelleo", "ego", "expattrusted", "flow",
        "gomenassat", "hazim", "ialqarawi", "ibaax", "justsa", "livingcompound", "marksa",
        "ksaaqar", "muhaysini", "nofodh", "qmra", "rakez", "razre", "reinvest", "remaxsa", "rightcompound",
        "sadiqeltajer", "safa",
        # 2026-10-02: removal oracles written that day (measured on each site's own pages), shadow
        # until their first run is read.
        "aqarnajran", "fahadalshahri", "remal", "shmoualshmal", "wslnaa",
        "sakan", "sanadak", "sodasyat", "sokok", "sukna", "tamyaz", "tuba", "villassa",
        # 2026-10-08: the Nuzul tenants (goldendeal engine). Their oracle used to be built only
        # inside the crawl, so 345 ads (goldendeal 293, maqam 42, yameen 10) were never checked.
        "goldendeal", "maqam", "yameen",
        # 2026-10-08: its crawl reads the API from CI daily (1,290 records); the old "403 CONNECT"
        # note was this container's egress. 1,283 ads, never checked.
        "mustqr")},
}

# NOT here, and why (shadow run 36490769167, 2026-09-28): mizlaj, nowaisiry, eastabha and muktamel —
# their oracles have no "live" answer by design (a 200 is UNKNOWN), so no control can ever pass and
# nothing could be verified; alrifai — its "live" needs the crawl's own catalogue of that run; masar — one listing, and the control gate needs five.

# Sites whose shadow run was read and found right (liveness_policies.FLEET_DAILY_DIRECT — the same
# list makes them DIRECT_REVISIT). Everything else only decides.
APPLY: frozenset[str] = frozenset(FLEET_DAILY_DIRECT)

PACE_S = 1.0            # at most one read a second per site
# Per site per run, inside the job's 350-minute ceiling. It was 95 minutes: dwelleo (11,137 ads at
# ~1.6 s a read) covered 30% a day and nofodh 57%, so neither could ever meet its 48 h window.
BUDGET_S = 320 * 60
FLUSH = 200             # reads between writes of what is already known (live stamps, "we looked")
CONTROL_HOURS = 48
# A row its own crawl already read DIRECTLY within FRESH_HOURS (last_verified_alive_at — only the
# liveness contract writes it) and that carries no strike was checked today: reading it again adds
# requests, not evidence («cheapest proof first», LIFECYCLE_ENGINEER.md). It counts as covered, so a
# big site whose crawl opens every ad (dwelleo: 11k detail records a day) is read only where the
# crawl did not reach — struck rows, and rows it has not proven alive since yesterday.
# 12, not 24 (2026-10-02 merge): this job runs daily and stamps what it reads, so a 24 h window let
# a row it stamped yesterday skip today's read: a removed ad would then be found a day late and the
# row's proof would reach the 48 h edge. Only tonight's crawl proof (crawls run before 07:17 UTC)
# counts; the daily read still reaches every other row.
FRESH_HOURS = 12
KILL_FLOOR, KILL_FRAC = 3, 0.10
REPROBE_MIN_HOURS = 6   # a struck row's next reading waits at least this long (gathern/liveness.py)
PAGE = 1000             # PostgREST's max rows per request
_VERDICT = {"gone": DEAD, "live": ALIVE}


def oracle_for(spec: str, control: dict | None):
    module, attr = spec.split(":")
    obj = importlib.import_module(module)
    for part in attr.removesuffix("()").split("."):
        obj = getattr(obj, part)
    return obj(control) if attr.endswith("()") else obj


def read(oracle, ad_number: str) -> tuple[str, str]:
    """The site's own answer mapped onto the contract's three values. A raising oracle is UNKNOWN."""
    try:
        out = oracle(ad_number)
    except Exception as e:  # noqa: BLE001 — a broken read is never evidence of death
        return UNKNOWN, f"oracle raised {type(e).__name__}: {e}"
    said, why = out if isinstance(out, tuple) else (out, "")
    return _VERDICT.get(said, UNKNOWN), why


def kill_cap(active: int) -> int:
    return max(KILL_FLOOR, math.ceil(KILL_FRAC * active))


def tables_for(client, site: str) -> dict[str, int]:
    """{table: active rows} for the site's tables that exist."""
    out = {}
    for t in (f"{site}_residential_listings", f"{site}_commercial_listings"):
        try:
            out[t] = client.table(t).select("id", count="exact").eq("active", True).limit(1).execute().count or 0
        except Exception:  # noqa: BLE001 — a site with one vertical has one table
            continue
    return out


def struck(client, site: str) -> int:
    """How many of the site's active rows carry a strike — what a recheck has to read."""
    return sum(client.table(t).select("id", count="exact").eq("active", True).gt("missing_count", 0)
               .limit(1).execute().count or 0 for t in tables_for(client, site))


def _rows(client, table: str, cols: str, *, order: list[tuple[str, bool]], limit: int, since=None) -> list[dict]:
    out: list[dict] = []
    while len(out) < limit:
        q = client.table(table).select(cols).eq("active", True)
        if since:
            q = q.gte("last_seen_at", since)
        for col, desc in order:
            q = q.order(col, desc=desc, nullsfirst=not desc)
        n = min(PAGE, limit - len(out))
        page = q.range(len(out), len(out) + n - 1).execute().data or []
        out += [dict(r, _table=table) for r in page if r.get("ad_number")]
        if len(page) < n:
            break
    return out


def controls(client, tables) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(hours=CONTROL_HOURS)).isoformat()
    ctl = []
    for t in tables:
        ctl += _rows(client, t, "ad_number, listing_url, last_seen_at", order=[("last_seen_at", True)],
                     limit=MIN_CANARIES, since=since)
    if len(ctl) < MIN_CANARIES:
        # The site's crawl has not seen MIN_CANARIES ads in CONTROL_HOURS (its crawl is failing —
        # dwelleo and muhaysini, 2026-09-29..10-02). Without this the run had 0/0 controls,
        # quarantined itself, and its whole active set went unchecked for days while the job read
        # green. Fall back to the ads the crawl saw MOST recently, however long ago. Still crawl
        # evidence, never last_verified_alive_at (that pool is self-referential); a stale control
        # that is really gone only fails the gate, so this can quarantine more runs, never fewer.
        have = {r["ad_number"] for r in ctl}
        for t in tables:
            ctl += [r for r in _rows(client, t, "ad_number, listing_url, last_seen_at",
                                     order=[("last_seen_at", True)], limit=MIN_CANARIES)
                    if r["ad_number"] not in have]
    return sorted(ctl, key=lambda r: r.get("last_seen_at") or "", reverse=True)[:MIN_CANARIES]


def controls_ok(ctl, oracle) -> tuple[bool, str]:
    ok, why, _all = _controls_read(ctl, oracle)
    return ok, why


def _controls_read(ctl, oracle) -> tuple[bool, str, bool]:
    """(gate passed, why, EVERY control read live). The third value gates the capped drain."""
    reads = [read(oracle, r["ad_number"]) for r in ctl]
    alive = sum(v == ALIVE for v, _ in reads)
    # The first two misses, in the oracle's own words: a quarantine must say WHY (block, timeout,
    # redesign) or the next engineer re-runs it blind.
    miss = "; ".join([f"{r['ad_number']}: {why[:120]}" for r, (v, why) in zip(ctl, reads) if v != ALIVE][:2])
    return (canary_environment_ok(alive, len(ctl)),
            f"controls {alive}/{len(ctl)} live" + (f" ({miss})" if miss else ""),
            len(ctl) >= MIN_CANARIES and alive == len(ctl))


def _fresh(r: dict, since: datetime) -> bool:
    """Directly proven alive since `since` and not under a strike (see FRESH_HOURS)."""
    v = r.get("last_verified_alive_at")
    return not r.get("missing_count") and bool(v) and datetime.fromisoformat(v) >= since


def _update(client, table: str, ids: list, patch: dict) -> None:
    for i in range(0, len(ids), 200):
        client.table(table).update(patch).in_("id", ids[i:i + 200]).execute()


def run_site(site: str, *, shadow: bool, struck_only: bool = False) -> dict:
    spec = SITES[site]
    shadow = shadow or site not in APPLY
    client = sb()
    if struck_only and not struck(client, site):
        return {"site": site, "skipped": "no struck row"}
    policy = policy_for(site)
    now = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    run_id = begin_run(f"fleet_liveness:{site}")
    st = {"site": site, "shadow": shadow, "active": 0, "probed": 0, ALIVE: 0, DEAD: 0, UNKNOWN: 0,
          "verified": 0, "struck": 0, "hidden": 0, "would_hide": [], "quarantined": None, "covered": 0.0,
          "fresh": 0}
    try:
        tables = tables_for(client, site)
        st["active"] = sum(tables.values())
        ctl = controls(client, tables)
        oracle = oracle_for(spec, ctl[0] if ctl else None)
        ok, why, open_all = _controls_read(ctl, oracle)
        if not ok:
            st["quarantined"] = f"opening {why}: the site is not answering truthfully, nothing read"
        else:
            order = [("missing_count", True), ("last_liveness_probe_at", False)]
            work = []
            for t in tables:
                work += _rows(client, t, "id, ad_number, listing_url, missing_count, last_liveness_probe_at, "
                              "last_verified_alive_at", order=order, limit=st["active"])
            since = datetime.now(timezone.utc) - timedelta(hours=FRESH_HOURS)
            st["fresh"] = sum(_fresh(r, since) for r in work)
            work = [r for r in work if not _fresh(r, since)]
            work.sort(key=lambda r: (-(r.get("missing_count") or 0), r.get("last_liveness_probe_at") or ""))
            if struck_only:
                rested = (datetime.now(timezone.utc) - timedelta(hours=REPROBE_MIN_HOURS)).isoformat()
                work = [r for r in work if (r.get("missing_count") or 0) > 0
                        and (r.get("last_liveness_probe_at") or "") < rested]
            alive, looked, dead_side = [], [], []
            last = -math.inf

            def flush() -> None:
                # A live answer and "we looked" need no closing control (a block cannot fabricate a
                # live page, §5.4), so they are written as the run goes: on 2026-10-02 six jobs were
                # cancelled mid-run and every read they had made (dwelleo: 37 minutes) was lost.
                if shadow:
                    return
                for t in tables:
                    ids = [r["id"] for r, _ in alive if r["_table"] == t]
                    if ids:
                        stamp = verification_patch(alive[0][1], now_iso=now)
                        _update(client, t, ids, {"missing_count": 0, "last_liveness_probe_at": now, **stamp})
                    _update(client, t, [r["id"] for r in looked if r["_table"] == t],
                            {"last_liveness_probe_at": now})
                st["verified"] += len(alive)
                alive.clear()
                looked.clear()

            for r in work:
                if time.monotonic() - started > BUDGET_S:
                    break
                # PACE_S is a RATE (at most one read per PACE_S), not a pause added to each read:
                # sleeping a full second after a 1.5 s read halved how much of a site fits the budget.
                time.sleep(max(0.0, last + PACE_S - time.monotonic()))
                last = time.monotonic()
                v, why = read(oracle, r["ad_number"])
                st["probed"] += 1
                st[v] += 1
                d = decide(v, strikes=int(r.get("missing_count") or 0), policy=policy, evidence=EvidenceKind.DIRECT)
                if d.action == "reset":
                    alive.append((r, d))
                elif d.action in ("strike", "deactivate"):
                    dead_side.append((r, d, why))
                else:
                    looked.append(r)
                if len(alive) + len(looked) >= FLUSH:
                    flush()
            due = len(work) if struck_only else st["active"]
            done = st["probed"] + (0 if struck_only else st["fresh"])
            st["covered"] = round(100.0 * done / due, 1) if due else 100.0
            kills = [x for x in dead_side if x[1].action == "deactivate"]
            st["would_hide"] = [f"{r['_table']}:{r['id']} {r.get('listing_url')} — {why}" for r, _, why in kills]
            ok, why, close_all = _controls_read(ctl, oracle)
            cap = kill_cap(st["active"])
            if not ok:
                st["quarantined"] = f"closing {why}: no strike or hide written"
            elif len(kills) > cap and open_all and close_all:
                # CAPPED DRAIN (2026-10-08, gathern's design: «one run hides at most the kill cap; a
                # bigger backlog hides the cap's worth and carries the rest»). The cap is unchanged
                # and never raised. Before, an over-cap batch hid nothing, every run, forever: justsa
                # read the same 24 ads gone on their own page in three separate runs (10-07 daily,
                # recheck, 10-08 daily) with its controls live, and kept them on screen because 24 > 10.
                # Only when EVERY known-live control read live at BOTH ends of the run; otherwise the
                # over-cap batch is quarantined exactly as before. The carried rows keep their strikes.
                carried = kills[cap:]
                dead_side = [x for x in dead_side if not any(x is k for k in carried)]
                looked += [r for r, _, _ in carried]
                st["drained"] = f"{len(kills)} hides > cap {cap}: every control live at both ends, " \
                                f"hiding {cap}, {len(carried)} carried to the next run"
            elif len(kills) > cap:
                st["quarantined"] = f"{len(kills)} hides > cap {cap}: no strike or hide written"
            if st["quarantined"]:
                looked += [r for r, _, _ in dead_side]
            flush()
            if not shadow:
                if not st["quarantined"]:
                    # Stamped when the run ENDS, never earlier than the read: REPROBE_MIN_HOURS
                    # then holds even for a site whose run lasted hours.
                    done = datetime.now(timezone.utc).isoformat()
                    for r, d, why in dead_side:
                        patch = {"missing_count": d.strikes, "last_liveness_probe_at": done}
                        if d.action == "deactivate":
                            client.table("ops_stale_inactivation_probe").insert({
                                "source_table": r["_table"], "listing_id": r["id"], "ad_number": r["ad_number"],
                                "listing_url": r.get("listing_url") or "", "verdict": "GONE",
                                "oracle": f"fleet_liveness.{site}", "note": f"{d.reason} · {why}"}).execute()
                            # Dated here, not by trg_set_deactivated_at, which 27 platforms'
                            # tables lack (2026-10-03; db.prune_unseen says why).
                            patch["active"] = False
                            patch["deactivated_at"] = done
                            st["hidden"] += 1
                        else:
                            st["struck"] += 1
                        client.table(r["_table"]).update(patch).eq("id", r["id"]).execute()
        note = (f"{'SHADOW' if shadow else 'APPLY'}{' RECHECK' if struck_only else ''} active={st['active']} probed={st['probed']} "
                f"covered={st['covered']}% fresh={st['fresh']} alive={st[ALIVE]} dead={st[DEAD]} unknown={st[UNKNOWN]} "
                f"verified={st['verified']} struck={st['struck']} hidden={st['hidden']} "
                f"would_hide={len(st['would_hide'])}"
                + (f" | QUARANTINED: {st['quarantined']}" if st["quarantined"] else "")
                + (f" | DRAIN: {st['drained']}" if st.get("drained") else ""))
        print(f"{site}: {note}", flush=True)
        for line in st["would_hide"][:20]:
            print(f"  would hide: {line}", flush=True)
        end_run(run_id, ok=True, rows_seen=st["probed"], rows_upserted=st["verified"] + st["hidden"],
                notes=note, allow_empty=True)
        return st
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=st["probed"], rows_upserted=0, notes=f"error: {e}")
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="Daily DIRECT liveness for every site with a measured oracle")
    ap.add_argument("--site", action="append", choices=sorted(SITES), help="default: every site")
    ap.add_argument("--shadow", action="store_true", help="decide and report, write nothing")
    ap.add_argument("--struck-only", action="store_true",
                    help="re-read only the rows already carrying a strike (the recheck between daily runs)")
    ap.add_argument("--plan", nargs="?", const="", default=None, metavar="SITE",
                    help="write the matrix (SITE, or every site) as sites=<json> to $GITHUB_OUTPUT and exit")
    a = ap.parse_args()
    if a.plan is not None:
        import json
        import os
        sites = [a.plan] if a.plan else sorted(SITES)
        with open(os.environ.get("GITHUB_OUTPUT", "/dev/stdout"), "a", encoding="utf-8") as f:
            f.write(f"sites={json.dumps(sites)}\n")
        return 0
    failed = 0
    for site in a.site or sorted(SITES):
        try:
            run_site(site, shadow=a.shadow, struck_only=a.struck_only)
        except Exception as e:  # noqa: BLE001 — one site failing never stops the rest
            print(f"✗ {site}: {e}", flush=True)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
