"""One-shot diagnostic: dump RAW structural evidence from real muktamel.com listing pages.

WHY THIS EXISTS (2026-09-03): after fixing the _NodeWorker deadlock (see run.py), a real crawl
against muktamel.com completed cleanly but found 0 live listings — every non-dead id came back
"unparseable_or_no_offer" (scrapers/common/tests + the fetch-outcome counter in run.py). That is
consistent with the site's page structure having changed since this scraper was written for
Nuxt 2's `window.__NUXT__=` IIFE. This script proves what the CURRENT structure actually is,
straight from the runner (this repo's sandbox cannot reach muktamel.com — outbound is blocked),
so the rebuilt parser is built from real evidence, not a guess.

It fetches each given id ONCE, and prints, per id:
  - HTTP status, final URL (redirect target)
  - content length
  - whether the OLD marker (`window.__NUXT__=`) is present
  - whether newer Nuxt3-shaped markers are present (`__NUXT_DATA__`, `useNuxtApp`, `window.__NUXT__`
    as a plain object literal instead of an IIFE, `<script type="application/json"`)
  - every `<script ...>` tag's opening attributes (id/type/src) in document order — this alone
    usually reveals which framework/hydration payload is really on the page
  - a bounded snippet (first 4000 chars) of whichever script tag looks most likely to carry the
    listing payload (largest inline <script> body), for manual/agent inspection

This is diagnostic-only: it writes NOTHING to the database and stores NOTHING beyond the CI log.

Usage: python -m scrapers.muktamel.diag_page_structure --ids 24000,24001,24005
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

# Reuse the REAL production Node worker (same eval, same protocol, same timeout) rather than
# reimplementing it — the question this script answers is "what does OUR parser actually get back
# from a real page today", not "could some other parser work".
from scrapers.muktamel.run import _extract_nuxt, _nuxt_via_node  # noqa: E402

BASE = "https://www.muktamel.com"

_SCRIPT_TAG_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)


def _session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def dump_one(s: cc.Session, listing_id: int) -> None:
    url = f"{BASE}/real-estates/{listing_id}"
    print(f"\n{'=' * 90}\nID {listing_id}  GET {url}")
    try:
        r = s.get(url, timeout=45, allow_redirects=True)
    except Exception as e:
        print(f"  EXC {type(e).__name__}: {e}")
        return
    print(f"  status={r.status_code}  final_url={r.url}  len={len(r.text)}")
    html = r.text

    has_old_nuxt2 = "window.__NUXT__=" in html
    has_nuxt_data_tag = "__NUXT_DATA__" in html
    has_app_json_ld = 'application/ld+json' in html
    print(f"  markers: window.__NUXT__=... : {has_old_nuxt2}   __NUXT_DATA__ : {has_nuxt_data_tag}"
          f"   application/ld+json : {has_app_json_ld}")

    m = re.search(r'name="generator"\s+content="([^"]+)"', html, re.I)
    print(f"  <meta generator>: {m.group(1) if m else '(none found)'}")

    scripts = _SCRIPT_TAG_RE.findall(html)
    print(f"  {len(scripts)} <script> tags:")
    biggest = None
    biggest_len = -1
    for attrs, body in scripts:
        attrs_clean = " ".join(attrs.split())
        print(f"    <script {attrs_clean[:120]}>  body_len={len(body)}")
        if len(body) > biggest_len:
            biggest_len = len(body)
            biggest = (attrs_clean, body)

    if biggest and biggest_len > 200:
        attrs_clean, body = biggest
        print(f"\n  --- largest inline <script {attrs_clean[:80]}> (first 4000 chars) ---")
        print(body[:4000])
        print("  --- end snippet ---")
    else:
        print("\n  (no substantial inline <script> body found)")

    # Fallback: print a slice of raw body HTML around the first occurrence of a plausible
    # listing-data anchor, in case the payload isn't in a <script> tag at all (e.g. pure SSR HTML,
    # a data-* attribute blob, or a different hydration mechanism entirely).
    anchor = re.search(r"real-estate|offer|listing|__NUXT|__DATA__", html, re.I)
    if anchor:
        start = max(0, anchor.start() - 200)
        print(f"\n  --- raw HTML around first '{anchor.group(0)}' match (400 chars) ---")
        print(html[start:start + 600])
        print("  --- end ---")

    # THE decisive test: actually run the real production parser (same _NodeWorker, same eval,
    # same NODE_PARSE_TIMEOUT) against this exact page and show what it really gets back, instead
    # of guessing from a truncated raw snippet.
    print("\n  --- real parser result (_extract_nuxt + _nuxt_via_node, as run.py uses it) ---")
    nuxt_src = _extract_nuxt(html)
    if not nuxt_src:
        print("  _extract_nuxt() found NO window.__NUXT__= payload at all (regex/</script> miss).")
        return
    print(f"  _extract_nuxt() ok, {len(nuxt_src)} chars")
    parsed = _nuxt_via_node(nuxt_src)
    if parsed is None:
        print("  _nuxt_via_node() returned None — the node eval() failed, timed out, or threw.")
        print("  --- raw one-shot node eval probe (bypasses the production worker's silent catch) ---")
        raw_node_eval_probe(nuxt_src)
        return
    print(f"  _nuxt_via_node() ok — top-level keys: {sorted(parsed.keys())}")
    addr = parsed.get("addressJson")
    print(f"  addressJson: {'present, keys=' + str(sorted(addr.keys())) if isinstance(addr, dict) else addr!r}")
    offer = parsed.get("offer")
    if offer is None:
        print("  offer: None  <-- THIS is why fetch_one() calls it unparseable_or_no_offer")
    elif isinstance(offer, dict):
        print(f"  offer: dict, {len(offer)} keys: {sorted(offer.keys())}")
        for k in ("isAvailable", "price", "type", "dealType", "address"):
            print(f"    offer[{k!r}] = {offer.get(k)!r}")
    else:
        print(f"  offer: unexpected type {type(offer).__name__}: {offer!r}"[:500])


# Same eval strategy as production's _NODE_WORKER_JS (window.__NUXT__= -> globalThis.__N=, then
# (0, eval)(src)), but this is a ONE-SHOT `node -e` invocation with the real error surfaced instead
# of swallowed — production's `catch (e) { outStr = ""; }` cannot tell "threw a RangeError" apart
# from "threw nothing in particular", which is exactly the ambiguity blocking root-causing this.
_RAW_EVAL_PROBE_JS = r"""
const fs = require('fs');
const body = fs.readFileSync(0, 'utf8');
const t0 = Date.now();
try {
  let src = body.replace(/^window\.__NUXT__=/, 'globalThis.__N=');
  globalThis.__N = undefined;
  (0, eval)(src);
  const N = globalThis.__N || {};
  const d0 = (N.data && N.data[0]) || {};
  console.log('EVAL_OK ms=' + (Date.now() - t0));
  console.log('top-level N keys: ' + JSON.stringify(Object.keys(N)));
  console.log('data length: ' + (Array.isArray(N.data) ? N.data.length : typeof N.data));
  console.log('data[0] keys: ' + JSON.stringify(Object.keys(d0)));
  console.log('data[0].offer present: ' + ('offer' in d0));

  // Now reproduce the PRODUCTION worker's exact remaining steps (build `out`, JSON.stringify it)
  // to find out whether eval() succeeding is NOT the whole story -- the real failure could be in
  // the stringify step (circular structure, a function/getter value, excessive depth) which the
  // eval-only test above cannot see.
  const st = N.state || {};
  const out = {
    offer: d0.offer || null,
    initialPhotos: d0.offerInitialPhotos || [],
    lazyPhotos: d0.offerLazyPhotos || [],
    addressJson: st.addressJson || null,
  };
  console.log('offer typeof: ' + typeof out.offer);
  if (out.offer && typeof out.offer === 'object') {
    console.log('offer keys: ' + JSON.stringify(Object.keys(out.offer)));
    for (const k of Object.keys(out.offer)) {
      const v = out.offer[k];
      console.log('  offer.' + k + ' : ' + typeof v + (typeof v === 'function' ? ' <-- A FUNCTION VALUE' : ''));
    }
  }
  try {
    const t1 = Date.now();
    const s = JSON.stringify(out, (k, v) => v === undefined ? null : v);
    console.log('STRINGIFY_OK ms=' + (Date.now() - t1) + ' len=' + s.length);
  } catch (e2) {
    console.log('STRINGIFY_THREW name=' + e2.name + ' message=' + String(e2.message).slice(0, 300));
  }
} catch (e) {
  console.log('EVAL_THREW ms=' + (Date.now() - t0));
  console.log('name: ' + e.name);
  console.log('message: ' + String(e.message).slice(0, 500));
  console.log('stack (first 3 lines): ' + String(e.stack).split('\n').slice(0, 3).join(' | '));
}
"""


def raw_node_eval_probe(nuxt_src: str) -> None:
    import subprocess
    try:
        r = subprocess.run(
            ["node", "-e", _RAW_EVAL_PROBE_JS],
            input=nuxt_src, capture_output=True, text=True, timeout=60)
        print(r.stdout.strip() or "(no stdout)")
        if r.stderr.strip():
            print("  stderr: " + r.stderr.strip()[:1000])
    except subprocess.TimeoutExpired:
        print("  raw eval probe itself TIMED OUT after 60s — eval() is genuinely hanging on this payload.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True, help="comma-separated listing ids to dump")
    args = ap.parse_args()
    ids = [int(x) for x in args.ids.split(",") if x.strip()]
    s = _session()
    for lid in ids:
        dump_one(s, lid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
