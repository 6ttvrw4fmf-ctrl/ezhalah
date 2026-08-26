"""Deal App fetch discriminator: is the shell response caused by our CLIENT or by our NETWORK?

Diagnosis ONLY. Never writes to the database, never touches scrape_runs/listings. A handful of
requests against a few known ids, run once on demand via wasalt-style workflow_dispatch.

THE PROBLEM (2026-08-26). dealapp detail fetches in production fail ~78-82% of the time with
`status_200_no_listing_schema`: HTTP 200, an <script id="ng-state"> block present, but no
`real-estate-listing` key inside `schemaMarkupScripts` — the same response shape a genuinely
nonexistent ad id produces. That signal is what feeds last_seen_at, so 30% of the active inventory
now looks "not seen at source" while a hand sample proved 6 of 15 of those listings are alive and
carry availability=InStock. dealapp_recover has returned `unknown=276 of 276` on EVERY run for
days, including a fresh mid-afternoon dispatch — it has never once classified anything.

From an ordinary network the same URLs return the full schema WITH a price (verified 2026-08-26:
live id 558414 price 550160.38, stale-but-alive id 382843 price 260325, bogus id 999999999 no
real-estate-listing key at all). So the parser and the classifier are correct.

RUN 1 (Actions run 32998202697) — all FOUR variants, including A-prod-exact, got the full schema
from a GitHub Actions runner: 558414 -> 550160.38 InStock, 382843 -> 260325 InStock, 548176 ->
750000 InStock, bogus control correctly no listing schema. Read at the time as "client and egress
both exonerated".

THAT VERDICT WAS WRONG, AND THE SAMPLE IS WHY. Those four ids return a data-bearing page from
every client on every network — they were picked BECAUSE they had already been confirmed alive,
so they could only ever produce a pass. Run against a real population the picture inverts:

  RUN 2 (--volume 600, Actions run 32999375439): 88.0% shell over 600 sitemap-published ids,
    FLAT across all ten deciles (81.7/80.0/96.7/80.0/95.0/83.3/91.7/91.7/85.0/95.0).
  Same ordered ids, ordinary network, system curl: 10.0% shell (54 of 60 carried the schema).

The flat decile shape is the volume probe's own decision rule for EXONERATING volume — the rate
does not climb with the request index, so sustained load is not the cause either. What is left is
the 88-vs-10 gap, which moves TWO variables at once (client AND network).

  RUN 3 (--population 60, Actions run 33000533871): every client, same runner, same ids —
    A 78.3% | B 78.3% | C 78.3% | D 78.3% | E-system-curl 83.3%, while the SAME curl binary on
    the SAME 60 ids OFF-runner gets 11.7%. The client is exonerated, egress is implicated.
  RUN 4 (--retry 60, Actions run 33001226104): 49 shells re-requested at 5s/15s/45s/120s —
    0 recovered in EVERY round, control 10/10. Off-runner the same shells recover 7/7 at once.

VERDICT (2026-08-26). dealapp serves a data-bearing page to ordinary networks and a PERMANENTLY
listing-less page to GitHub Actions egress, for the same ids at the same moment. Not the parser,
not the classifier, not the TLS profile, not headers, not the HTTP library, not the curl binary,
not volume, not concurrency, not time of day, not the URL form, not a cold render. The only
surviving variable is the runner's network egress identity.

CONSEQUENCE: last_seen_at is NOT a dealapp liveness signal — ~75% of "not seen at source" is a
false negative manufactured by where the job runs. No removal/deactivation policy can be built on
it, and none exists. There is also NO scraper-side fix: run 4 shows retries cannot recover a
permanent response, and fetch_one already makes 3 attempts. Changing egress is an owner
provider/compliance decision and is NOT to be folded into the (frozen, separate) Wasalt proxy
question. Full write-up: docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md.

NEVER DIAGNOSE THIS ON A HAND-PICKED SAMPLE AGAIN. A sample drawn from ids already known to be
alive cannot fail, so it cannot discriminate anything. PROBE_IDS below are kept only as the
fixed controls they are good for (notably the bogus id), never as the population.

WHAT THIS SEPARATES. Four client variants against the SAME ids from the SAME runner:

  A prod-exact   curl_cffi impersonate=chrome124 + the Accept/Accept-Language headers run.py sets
  B no-imp       curl_cffi with NO TLS impersonation, plain browser User-Agent
  C imp-no-hdrs  impersonate=chrome124 with curl_cffi's DEFAULT headers (no run.py overrides)
  D imp-alt      a DIFFERENT impersonation profile

A vs C isolates HEADERS. A vs B and A vs D isolate the TLS FINGERPRINT. If all four fail
identically, the client is exonerated and the cause is the runner's network/egress identity —
which is a provider/compliance question for the owner, NOT something to route around here.

Deliberately NOT a fix and NOT a workaround: this script only reports. It adds no proxy, changes
no production path, and must never be put on a schedule.
"""
from __future__ import annotations

import json
import re
import os
import subprocess
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

BASE = "https://dealapp.sa"

# Known ids, established from an ordinary network on 2026-08-26 (see module docstring).
PROBE_IDS: list[tuple[str, str]] = [
    ("558414", "live-confirmed-today"),
    ("382843", "stale>=7d-but-alive-InStock"),
    ("548176", "stale>=7d-but-alive-InStock"),
    ("999999999", "bogus-control-must-have-no-listing-schema"),
]


def listing_schema(html: str) -> tuple[Optional[dict], str]:
    """Mirror of run.py::_listing_schema, plus a reason string so a failure says WHICH step died."""
    m = re.search(r'<script id="ng-state" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None, "no ng-state block at all"
    try:
        state = json.loads(m.group(1))
    except Exception as e:
        return None, f"ng-state present but unparseable: {type(e).__name__}"
    sm = state.get("schemaMarkupScripts") or {}
    raw = next((v for k, v in sm.items() if k.startswith("real-estate-listing")), None)
    if raw is None:
        return None, f"ng-state ok, NO real-estate-listing key; keys={sorted(sm.keys())[:6]}"
    try:
        return (json.loads(raw) if isinstance(raw, str) else raw), "ok"
    except Exception as e:
        return None, f"real-estate-listing present but unparseable: {type(e).__name__}"


def build(variant: str) -> cc.Session:
    if variant == "A-prod-exact":
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        return s
    if variant == "B-no-impersonation":
        s = cc.Session()
        s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                                        "Chrome/124.0.0.0 Safari/537.36"})
        return s
    if variant == "C-impersonate-default-headers":
        return cc.Session(impersonate="chrome124")
    if variant == "D-impersonate-alt-profile":
        for prof in ("chrome131", "chrome126", "chrome120", "safari17_0"):
            try:
                return cc.Session(impersonate=prof)
            except Exception:
                continue
        return cc.Session()
    raise ValueError(variant)


VARIANTS = ["A-prod-exact", "B-no-impersonation", "C-impersonate-default-headers",
            "D-impersonate-alt-profile"]


def probe(sess: cc.Session, adid: str) -> dict[str, Any]:
    url = f"{BASE}/ar/ad-details/{adid}"
    t0 = time.monotonic()
    try:
        r = sess.get(url, timeout=45, allow_redirects=True)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}",
                "ms": round((time.monotonic() - t0) * 1000)}
    schema, why = listing_schema(r.text)
    offers = (schema or {}).get("offers") or {}
    return {
        "ok": True,
        "status": r.status_code,
        "bytes": len(r.text),
        "marker_in_text": "real-estate-listing" in r.text,
        "schema_found": schema is not None,
        "price": offers.get("price"),
        "availability": offers.get("availability"),
        "reason": why,
        "ms": round((time.monotonic() - t0) * 1000),
    }


def sitemap_ids(sess: cc.Session, want: int) -> list[str]:
    """Ad ids straight from dealapp's OWN sitemap — ids the source itself publishes as live.

    This matters for the volume probe: a shell response on a sitemap id is a false negative BY
    DEFINITION, so the probe needs no database and cannot be accused of sampling dead listings.
    """
    out: list[str] = []
    seen: set[str] = set()
    try:
        idx = sess.get(f"{BASE}/sitemap.xml", timeout=40).text
    except Exception:
        return out
    for child in re.findall(r"<loc>([^<]+)</loc>", idx):
        if len(out) >= want:
            break
        try:
            body = sess.get(child, timeout=60).text
        except Exception:
            continue
        for u in re.findall(r"<loc>([^<]+)</loc>", body):
            m = re.search(r"/ad-details/(\d+)", u)
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(m.group(1))
                if len(out) >= want:
                    break
    return out


def curl_probe(adid: str) -> dict[str, Any]:
    """A fifth client that shares NO code with the others: the system `curl` binary.

    It is here because it is the one client observed to succeed on this population. Plain curl on
    an ordinary network returned the full schema for 54 of 60 sitemap ids (10% shell) while the
    production client on a runner returned 88% shell over the SAME ordered ids. That is two
    variables at once -- client AND network -- so this control runs curl from the SAME runner as
    the curl_cffi variants, holding the network fixed.
    """
    url = f"{BASE}/ar/ad-details/{adid}"
    t0 = time.monotonic()
    try:
        out = subprocess.run(
            ["curl", "-sS", "--max-time", "40",
             "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
             "-H", "Accept-Language: ar,en-US;q=0.7", url],
            capture_output=True, text=True, timeout=60)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}",
                "ms": round((time.monotonic() - t0) * 1000)}
    schema, why = listing_schema(out.stdout)
    return {"ok": True, "bytes": len(out.stdout), "schema_found": schema is not None,
            "reason": why, "ms": round((time.monotonic() - t0) * 1000)}


def population_probe(n: int, interval: float) -> dict[str, Any]:
    """Every client variant against the SAME sitemap ids, from the SAME runner.

    WHY THIS EXISTS (2026-08-26, third iteration). The four-variant discriminator ran all four
    clients against FOUR HAND-PICKED ids and reported the client and the egress both exonerated.
    That verdict was an artefact of the sample: those four ids return a data-bearing page from
    every client on every network. Run against a real population the picture inverts --

        Actions runner, curl_cffi impersonate=chrome124 : 88.0% shell (600 sitemap ids)
        ordinary network, system curl                   : 10.0% shell (60 of the same ids)

    -- and the flat-across-deciles shape of that 88% rules out sustained volume as well (the
    volume probe's own decision rule: flat exonerates volume). So the cause is client or network
    after all, and the cherry-picked sample is what hid it.

    Holding the runner fixed and varying only the client is what separates the two. If a variant
    (or the plain-curl control) succeeds where A-prod-exact fails, the cause is OUR CLIENT and the
    fix is a scraper change. If every client fails at ~88% from the runner while plain curl off
    the runner succeeds, the client is genuinely exonerated and the cause is the runner's egress
    identity -- an owner provider decision, not something to route around here.
    """
    seed = build("A-prod-exact")
    ids = sitemap_ids(seed, n)
    if not ids:
        return {"error": "could not read any ad ids from the sitemap"}

    out: dict[str, Any] = {"ids_probed": len(ids), "interval_s": interval, "by_client": {}}
    for name in VARIANTS + ["E-system-curl"]:
        if name == "E-system-curl":
            results = []
            for adid in ids:
                results.append(bool(curl_probe(adid).get("schema_found")))
                time.sleep(interval)
        else:
            sess = build(name)
            results = []
            for adid in ids:
                results.append(bool(probe(sess, adid).get("schema_found")))
                time.sleep(interval)
        shell = sum(1 for x in results if not x)
        out["by_client"][name] = {
            "schema": len(results) - shell,
            "shell": shell,
            "shell_pct": round(100.0 * shell / len(results), 1),
        }
    out["reading"] = (
        "Same ids, same runner, only the client varies. A spread between clients means OUR CLIENT "
        "is the cause and the fix is a scraper change. All clients alike at ~88% -- while plain "
        "curl off-runner gets 10% on the same ids -- means the runner's EGRESS is the cause, "
        "which is an owner provider decision, not something to route around here."
    )
    return out


RETRY_DELAYS_S = [5, 15, 45, 120]


def retry_probe(n: int, interval: float) -> dict[str, Any]:
    """Is a shell response PERMANENT for an id, or does the same id render on a later attempt?

    WHY THIS IS THE DECIDING QUESTION (2026-08-26, fourth iteration). --population held the runner
    fixed and varied the client across all five clients, including the system curl binary:

        A-prod-exact 78.3% | B-no-imp 78.3% | C-imp-no-hdrs 78.3% | D-imp-alt 78.3% | E-curl 83.3%
        the SAME curl binary on the SAME 60 ids OFF-runner: 11.7%

    so the client is exonerated and the egress is implicated. But the four curl_cffi variants
    failed on EXACTLY 47 of 60 each -- identical counts, not a spread -- which says the failure is
    DETERMINISTIC PER ID rather than a random per-request block. A per-id deterministic shell that
    depends on which network you come from is the signature of an SSR/edge render that is COLD for
    that id at that PoP, not of an anti-bot decision about who we are.

    That distinction decides who owns the fix:
      * recovers on a later attempt  -> a cold render. The fix is production's retry schedule
                                        (currently 3 attempts, ~0.8s + ~1.6s apart -- likely far
                                        too fast to outlast a cold render), which is a pure
                                        scraper change and needs nobody's approval.
      * never recovers, at any delay -> the shell is the real answer from this egress. Changing
                                        egress is an owner provider decision, and this file will
                                        say so rather than route around it.

    Method: walk n ids with the production client, keep the ones that came back shell, then
    re-request THOSE SAME ids after each delay in RETRY_DELAYS_S, reporting cumulative recovery.
    A control group of ids that succeeded first time is re-probed at the end, so "everything works
    later" cannot be mistaken for recovery when the site simply got healthier.
    """
    sess = build("A-prod-exact")
    ids = sitemap_ids(sess, n)
    if not ids:
        return {"error": "could not read any ad ids from the sitemap"}

    shells: list[str] = []
    good: list[str] = []
    for adid in ids:
        (good if probe(sess, adid).get("schema_found") else shells).append(adid)
        time.sleep(interval)

    rounds: list[dict[str, Any]] = []
    recovered: set[str] = set()
    for delay in RETRY_DELAYS_S:
        pending = [i for i in shells if i not in recovered]
        if not pending:
            break
        time.sleep(delay)
        for adid in pending:
            if probe(sess, adid).get("schema_found"):
                recovered.add(adid)
            time.sleep(interval)
        rounds.append({
            "after_delay_s": delay,
            "retried": len(pending),
            "recovered_this_round": len(recovered) - (rounds[-1]["recovered_cumulative"] if rounds else 0),
            "recovered_cumulative": len(recovered),
        })

    # Control: ids that worked first time must still work, or "recovery" is just the site healing.
    ctl = good[:10]
    ctl_ok = sum(1 for adid in ctl if probe(sess, adid).get("schema_found"))

    return {
        "ids_probed": len(ids),
        "shell_first_pass": len(shells),
        "schema_first_pass": len(good),
        "rounds": rounds,
        "recovered_total": len(recovered),
        "recovered_pct_of_shells": round(100.0 * len(recovered) / len(shells), 1) if shells else None,
        "control_first_pass_ok": f"{ctl_ok}/{len(ctl)}",
        "reading": "Recovery on a later attempt means the shell is a COLD RENDER and the fix is "
                   "production's retry schedule -- a scraper change, nobody's approval needed. "
                   "Near-zero recovery at every delay means the shell is this egress's real "
                   "answer, and changing egress is an OWNER provider decision. The control must "
                   "stay near 10/10; if it collapses too, the site itself changed and the whole "
                   "run is uninterpretable.",
    }


def volume_probe(n: int, interval: float) -> dict[str, Any]:
    """Walk N sitemap-published ids with the PRODUCTION client and report the shell rate by decile.

    THE QUESTION THIS ANSWERS (2026-08-26). The four-variant discriminator proved the production
    client on a production runner fetches known ids perfectly — so neither the client nor the
    egress explains production's ~78-82% status_200_no_listing_schema rate. The remaining
    difference is SUSTAINED VOLUME: the discriminator made 4 requests per variant; a real shard
    walks ~1,200 ids through 6 workers. If dealapp/CloudFront degrades to the app shell after some
    number of unique-id requests, the failure rate will climb with the request index instead of
    staying flat — and every one of these ids is published-live, so a shell IS a false negative.
    """
    sess = build("A-prod-exact")
    ids = sitemap_ids(sess, n)
    if not ids:
        return {"error": "could not read any ad ids from the sitemap"}

    results: list[bool] = []          # True = data-bearing
    first_shell_at: Optional[int] = None
    for i, adid in enumerate(ids, 1):
        r = probe(sess, adid)
        good = bool(r.get("schema_found"))
        results.append(good)
        if not good and first_shell_at is None:
            first_shell_at = i
        time.sleep(interval)

    size = max(1, len(results) // 10)
    deciles = []
    for d in range(0, len(results), size):
        chunk = results[d:d + size]
        if not chunk:
            continue
        deciles.append({
            "requests": f"{d + 1}-{d + len(chunk)}",
            "shell_pct": round(100.0 * sum(1 for x in chunk if not x) / len(chunk), 1),
        })
    shell_total = sum(1 for x in results if not x)
    return {
        "ids_probed": len(results),
        "interval_s": interval,
        "shell_count": shell_total,
        "shell_pct_overall": round(100.0 * shell_total / len(results), 1),
        "first_shell_at_request": first_shell_at,
        "by_decile": deciles,
        "reading": "every id here is published live in dealapp's own sitemap, so any shell is a "
                   "FALSE NEGATIVE. A flat ~0% across deciles exonerates volume; a rate that "
                   "climbs with the request index localises the cause to sustained volume and "
                   "makes throttle/backoff the fix.",
    }


def main() -> int:
    if "--population" in sys.argv:
        i = sys.argv.index("--population")
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 60
        interval = float(os.environ.get("PROBE_INTERVAL_S", "0.3"))
        print("=== DEAL APP POPULATION x CLIENT PROBE ===")
        print(json.dumps(population_probe(n, interval), indent=2, ensure_ascii=False))
        return 0

    if "--retry" in sys.argv:
        i = sys.argv.index("--retry")
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 60
        interval = float(os.environ.get("PROBE_INTERVAL_S", "0.3"))
        print("=== DEAL APP SHELL-PERMANENCE (RETRY) PROBE ===")
        print(json.dumps(retry_probe(n, interval), indent=2, ensure_ascii=False))
        return 0

    if "--volume" in sys.argv:
        i = sys.argv.index("--volume")
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 150
        interval = float(os.environ.get("PROBE_INTERVAL_S", "0.3"))
        print("=== DEAL APP VOLUME PROBE ===")
        print(json.dumps(volume_probe(n, interval), indent=2, ensure_ascii=False))
        return 0

    report: dict[str, Any] = {"base": BASE, "variants": {}}
    for variant in VARIANTS:
        try:
            sess = build(variant)
        except Exception as e:
            report["variants"][variant] = {"build_error": f"{type(e).__name__}: {e}"}
            continue
        rows = {}
        for adid, tag in PROBE_IDS:
            rows[f"{adid} ({tag})"] = probe(sess, adid)
            time.sleep(1.0)          # polite: one request per second, per variant
        report["variants"][variant] = rows

    # Verdict: did ANY variant get a data-bearing page for a known-live id?
    live_ids = [f"{i} ({t})" for i, t in PROBE_IDS if "alive" in t or "live" in t]
    winners = [v for v, rows in report["variants"].items()
               if isinstance(rows, dict)
               and any(isinstance(rows.get(k), dict) and rows[k].get("schema_found") for k in live_ids)]
    report["variants_that_got_real_data"] = winners
    report["verdict"] = (
        "CLIENT-SIDE: at least one client variant works from this runner — compare A against the "
        "winners to see whether TLS fingerprint or headers is the discriminator."
        if winners else
        "NETWORK/EGRESS-SIDE: no client variant obtained a listing schema for a known-live id from "
        "this runner, so the client is exonerated and the runner's egress identity is the cause. "
        "That is an owner decision about provider/egress, not something to route around here."
    )
    print("=== DEAL APP FETCH DISCRIMINATOR ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
