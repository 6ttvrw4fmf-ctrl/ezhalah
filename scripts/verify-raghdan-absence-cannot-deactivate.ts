// UNKNOWN IS NOT DEAD — raghdan's deactivation path, executed rather than read.
//
// THE DEFECT THIS EXISTS TO PREVENT
// --------------------------------
// Until 2026-09-06 scrapers/raghdan/run.py called db.prune_unseen() with NO source oracle, so three
// consecutive crawl misses deactivated a listing on ABSENCE alone. docs/ops/LISTING_LIVENESS.md
// §1–§3 forbids exactly that inference: absence is EvidenceKind.ABSENCE, a candidate signal and
// never a verdict, because a throttled run, a truncated enumeration or a source-side index gap is
// indistinguishable from a removal. It produced a standing P1 `unknown_treated_as_dead`
// (alert_event 1487: 27 rows deactivated inside 48h with no source verdict recorded anywhere), and
// what waits at the end of that road is a permanent, unrecoverable delete.
//
// This platform is unusually exposed to the false-prune shape, which is why it was taken next.
// Its catalogue is enumerated from a multi-megabyte STREAMED sitemap under a byte/time budget
// (`_harvest_property_urls`), and that read has already been measured returning 249 of 376 URLs
// while reporting success — a short list is precisely what drives prune_unseen() to age out live
// listings. The completeness proof in the harvester makes that less likely; the oracle makes it
// unable to kill anything even when it happens.
//
// WHY THIS BARRIER EXECUTES THE FUNCTION INSTEAD OF GREPPING IT
// ------------------------------------------------------------
// AGENTS.md: every one of the five defects of 2026-09-04 had a barrier over the exact line, and
// every one of those barriers was a source-TEXT tripwire that stayed green for as long as the
// defect was live — two of them pinned the defective line as CORRECT. So this file imports the REAL
// `_gone_verdict` / `_verify_gone` / `ad_number_to_url` out of the shipped module and runs them.
// The only text assertion here is the one thing that cannot be executed without a network: that the
// prune call site actually passes the oracle.
//
// THE TRAP SPECIFIC TO THIS PLATFORM. raghdan answers a removed property with HTTP 404 and its
// generic ~39 KB site page, and a live one with HTTP 200 at 131–156 KB carrying a
// `RealEstateListing` JSON-LD block (measured 2026-09-06 over 227 DIRECT probes: 187/187 already-
// deactivated rows 404'd, 37/40 known-active controls answered 200 with the payload). So a bare
// status code is *nearly* enough — and "nearly" is the whole problem. LISTING_LIVENESS.md §5.4
// measured gathern expressing BLOCKING as its own application-rendered 404, a 100% false-death
// rate. The oracle therefore refuses to read a 404 as death when the body still carries a listing
// payload, refuses to read a 200 as life when it does not, and refuses either verdict when the
// request landed somewhere other than a property page. All three refusals are asserted below, and
// all three are mutation-proven.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUN_PY = join(ROOT, 'scrapers', 'raghdan', 'run.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-raghdan-absence-cannot-deactivate: only an affirmative source answer may kill.');

// ── The harness: runs the REAL functions and prints a JSON verdict table ─────────────────────────
// `MUTATE` (optional) is a JSON [find, replace] applied to the source of the decision function
// before it is re-defined — that is how the mutation proofs below re-introduce real defects and
// watch this barrier's own assertions go red.
const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.raghdan.run as run

gv = run._gone_verdict
mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(run._gone_verdict))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(run.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    gv = ns["_gone_verdict"]

URL = "https://raghdan.sa/ar/property/26jYlDRkBslBUdF9ABpa/"
# The two real body shapes, measured 2026-09-06. Only the markers the oracle reads matter.
LIVE_BODY = ('<html><head><title>شقة للبيع | 212م²</title>'
             '<script type="application/ld+json">{"@type":"RealEstateListing"}</script></head>'
             + "x" * 130000 + '</html>')
DEAD_BODY = '<html><head><title>رغدان للعقارات</title></head>' + "y" * 39000 + '</html>'

# (verdict, reason) or None ("no answer yet — retry"). None is never death.
def v(status, body, final=URL):
    r = gv(status, body, final)
    return None if r is None else r[0]

table = {
  # Every UNKNOWN shape the contract enumerates. None here means "retry", which the caller
  # turns into 'unknown'; what matters is that NONE of them is 'gone'.
  "network_error":         v(None, None),
  "401_unauthorised":      v(401, DEAD_BODY),
  "403_blocked":           v(403, DEAD_BODY),
  "407_proxy":             v(407, DEAD_BODY),
  "408_timeout":           v(408, DEAD_BODY),
  "429_throttled":         v(429, DEAD_BODY),
  "500_server":            v(500, DEAD_BODY),
  "502_server":            v(502, DEAD_BODY),
  "503_server":            v(503, DEAD_BODY),
  "504_server":            v(504, DEAD_BODY),
  "302_unresolved":        v(302, DEAD_BODY),
  # A 200 we cannot interpret is a fetch, not an answer.
  "200_empty_body":        v(200, ""),
  "200_shell_no_payload":  v(200, "<html><body>loading…</body></html>"),
  # The gathern trap: a 404 that still serves the listing is about our read, not the listing.
  "404_still_has_payload": v(404, LIVE_BODY),
  # An unresolved redirect: we do not know where we landed, whatever the status says.
  "redirected_to_home":    v(404, DEAD_BODY, "https://raghdan.sa/ar/"),
  "redirected_200_home":   v(200, LIVE_BODY, "https://raghdan.sa/ar/"),
  # The affirmative DEAD limb this platform actually uses.
  "404_no_payload":        v(404, DEAD_BODY),
  "410_no_payload":        v(410, DEAD_BODY),
  # The affirmative ALIVE limb.
  "200_with_payload":      v(200, LIVE_BODY),
}

# ad_number → the listing's OWN url. An oracle that probes the wrong page proves nothing.
urls = {
  "firebase_id": run.ad_number_to_url("RG26jYlDRkBslBUdF9ABpa"),
  "numeric_id":  run.ad_number_to_url("RG921939188559"),
  "no_prefix":   run.ad_number_to_url("26jYlDRkBslBUdF9ABpa"),
  "empty":       run.ad_number_to_url(""),
  "none":        run.ad_number_to_url(None),
  "path_escape": run.ad_number_to_url("RG../../admin"),
}

# The real _verify_gone, executed against an injected transport: no network, no clock.
class _Stub:
    def __init__(self, seq): self.seq = list(seq)
    def get(self, url, timeout=None, allow_redirects=None):
        item = self.seq.pop(0)
        if isinstance(item, Exception): raise item
        class R:
            status_code = item[0]
            text = item[1]
            url = item[2] if len(item) > 2 else URL
        return R()

import time; time.sleep = lambda *_a, **_k: None
if mut: run._gone_verdict = gv

def vg(seq, ad="RG26jYlDRkBslBUdF9ABpa"):
    run._oracle_session = lambda: _Stub(seq)
    return run._verify_gone(ad)[0]

# THE WIRING, read from the module's own SYNTAX TREE rather than its text. A docstring that
# mentions prune_unseen is not a call site, and a call site inside a comment is not a call at all —
# a regex conflates all three, which is exactly the source-TEXT tripwire AGENTS.md warns about.
import ast
tree = ast.parse(open(run.__file__, encoding="utf-8").read())
call_sites = []
for node in ast.walk(tree):
    if not isinstance(node, ast.Call):
        continue
    f = node.func
    if isinstance(f, ast.Attribute) and f.attr == "prune_unseen":
        kw = {k.arg: (getattr(k.value, "id", None) or getattr(k.value, "attr", None))
              for k in node.keywords if k.arg}
        call_sites.append({"line": node.lineno, "verify_gone": kw.get("verify_gone")})

wired = {
  "blocked_twice":        vg([(403, DEAD_BODY), (403, DEAD_BODY)]),
  "timeout_twice":        vg([OSError("reset"), OSError("reset")]),
  "5xx_twice":            vg([(500, DEAD_BODY), (503, DEAD_BODY)]),
  "transient_then_live":  vg([(500, DEAD_BODY), (200, LIVE_BODY)]),
  "transient_then_gone":  vg([OSError("reset"), (404, DEAD_BODY)]),
  "removed":              vg([(404, DEAD_BODY)]),
  "alive":                vg([(200, LIVE_BODY)]),
  "unresolvable_ad":      vg([], ad="not-a-raghdan-ad"),
}
print(json.dumps({"table": table, "wired": wired, "urls": urls, "call_sites": call_sites}))
`;

type Result = {
  table?: Record<string, string | null>;
  wired?: Record<string, string>;
  urls?: Record<string, string | null>;
  call_sites?: { line: number; verify_gone: string | null }[];
  error?: string;
};

const runHarness = (mutate?: [string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE LAW, EXECUTED. Nothing that is not an affirmative source answer may be 'gone'.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const UNKNOWN_SHAPES = [
  'network_error', '401_unauthorised', '403_blocked', '407_proxy', '408_timeout', '429_throttled',
  '500_server', '502_server', '503_server', '504_server', '302_unresolved',
  '200_empty_body', '200_shell_no_payload', '404_still_has_payload',
  'redirected_to_home', 'redirected_200_home',
];
const GONE_SHAPES = ['404_no_payload', '410_no_payload'];

// `lawHolds` returns the list of assertions that HOLD, so a mutation proof can watch it shrink.
const lawHolds = (r: Result): string[] => {
  const t = r.table ?? {};
  const held: string[] = [];
  for (const k of UNKNOWN_SHAPES) if (t[k] !== 'gone') held.push(`unknown:${k}`);
  for (const k of GONE_SHAPES) if (t[k] === 'gone') held.push(`gone:${k}`);
  if (t['200_with_payload'] === 'live') held.push('live:200_with_payload');
  // A verdict reached off the property page is not about this listing in EITHER direction, so the
  // redirect shapes are asserted as 'unknown' outright, not merely as "not gone".
  if (t['redirected_to_home'] === 'unknown') held.push('unknown-strict:redirected_to_home');
  if (t['redirected_200_home'] === 'unknown') held.push('unknown-strict:redirected_200_home');
  return held;
};
const TOTAL = UNKNOWN_SHAPES.length + GONE_SHAPES.length + 3;

const base = runHarness();
check(!base.error, 'the shipped oracle imports and runs', base.error ?? '');

for (const k of UNKNOWN_SHAPES) {
  check(base.table?.[k] !== 'gone',
    `${k} is NOT death`,
    `_gone_verdict returned ${JSON.stringify(base.table?.[k])} — an UNKNOWN read must never deactivate`);
}
for (const k of GONE_SHAPES) {
  check(base.table?.[k] === 'gone',
    `${k} IS an affirmative source removal`,
    `returned ${JSON.stringify(base.table?.[k])} — this platform's real death signal must still kill, ` +
    'or the oracle degrades into "never deactivate anything" and dead inventory stays searchable');
}
check(base.table?.['200_with_payload'] === 'live',
  '200 carrying a RealEstateListing payload is ALIVE');
// A live read is what SELF-HEALS a wrongly-struck row back to missing_count = 0. An oracle that
// never says 'live' silently loses the restore leg while still looking safe.
check(base.table?.['redirected_200_home'] !== 'live',
  'a 200 reached by redirecting off the property path is not a live listing either',
  'the oracle would certify a listing alive from a page that is not the listing');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE ORACLE PROBES THE LISTING'S OWN URL. Only DIRECT evidence may kill (§2), and "direct"
//    means this listing's page — an ad_number the scraper cannot resolve must yield no verdict.
// ─────────────────────────────────────────────────────────────────────────────────────────────
check(base.urls?.firebase_id === 'https://raghdan.sa/ar/property/26jYlDRkBslBUdF9ABpa/',
  'a Firebase-id ad_number resolves to its own detail URL', String(base.urls?.firebase_id));
check(base.urls?.numeric_id === 'https://raghdan.sa/ar/property/921939188559/',
  'a numeric ad_number resolves to its own detail URL', String(base.urls?.numeric_id));
for (const k of ['no_prefix', 'empty', 'none', 'path_escape']) {
  check(base.urls?.[k] === null,
    `an unresolvable ad_number (${k}) yields no URL rather than a guessed one`,
    `got ${JSON.stringify(base.urls?.[k])}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE WHOLE FUNCTION, EXECUTED against an injected transport (retries included).
// ─────────────────────────────────────────────────────────────────────────────────────────────
for (const k of ['blocked_twice', 'timeout_twice', '5xx_twice']) {
  check(base.wired?.[k] === 'unknown',
    `_verify_gone: ${k} exhausts its retries as 'unknown'`,
    `returned ${JSON.stringify(base.wired?.[k])} — a source we could not reach is not a dead listing`);
}
check(base.wired?.transient_then_live === 'live',
  "_verify_gone: a transient 5xx followed by a live read is 'live' (retries work)");
check(base.wired?.transient_then_gone === 'gone',
  "_verify_gone: a dropped connection followed by a 404 is 'gone'");
check(base.wired?.removed === 'gone', "_verify_gone: a removed property is 'gone'");
check(base.wired?.alive === 'live', "_verify_gone: a served property is 'live'");
check(base.wired?.unresolvable_ad === 'unknown',
  "_verify_gone: an ad_number with no listing URL is 'unknown', never a kill on an unprobed row");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. THE WIRING. An oracle nothing calls is decoration — and this is the exact regression that
//    would silently restore the original defect (absence alone deactivating).
// ─────────────────────────────────────────────────────────────────────────────────────────────
const sites = base.call_sites ?? [];
check(sites.length > 0,
  'the module still calls prune_unseen at least once (the path this barrier guards exists)',
  'no prune_unseen call found in the syntax tree — either the prune moved, or this barrier is ' +
  'now guarding nothing and would pass vacuously');
const unwired = sites.filter((s) => s.verify_gone !== '_verify_gone');
check(unwired.length === 0,
  `EVERY prune_unseen call site on this platform carries the oracle (${sites.length} found)`,
  `line(s) ${unwired.map((s) => s.line).join(', ')} prune WITHOUT verify_gone=_verify_gone — a ` +
  'second, unevidenced prune path deactivating on absence alone beside the good one is the exact ' +
  'shape already found on gathern and dealapp (ops_incident #84)');
// The old rationale, in prose, is the thing that made the defect look intentional. It must be gone.
const src = readFileSync(RUN_PY, 'utf8');
check(!/prune listings that were active before but weren't seen this crawl\./.test(src),
  'the bare "prune what we did not see" rationale is gone from the prune comment');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect, re-introduced into the SHIPPED source and
// executed. A mutant that leaves `lawHolds()` complete means the assertions above are blind.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string]) => {
  const r = runHarness(mutate);
  if (r.error) { check(false, `(mutation) ${what}`, r.error); return; }
  const held = lawHolds(r);
  check(held.length < TOTAL, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — every assertion above still passed with the defect present, so this barrier ' +
    'is asserting the bug rather than the rule');
};

// The original defect, in its purest form: treat any non-answer as a removal.
mustCatch('a blocked/throttled read being treated as death',
  ['if status != 200:\n        return None', 'if status != 200:\n        return "gone", "mutant"']);
// A network error is the one shape that must never even reach a verdict.
mustCatch('a network error resolving to a verdict instead of a retry',
  ['if status is None:\n        return None', 'if status is None:\n        return "gone", "mutant"']);
// The gathern trap (LISTING_LIVENESS.md §5.4): a 404 that still serves the listing read as death.
mustCatch('a 404 that still carries the listing payload being read as a not-found',
  ['return "unknown", f"HTTP {status} whose body still carries a RealEstateListing payload"',
   'return "gone", "mutant"']);
// A 200 shell is a fetch, not an answer — the dealapp shape (LISTING_LIVENESS.md §5.1).
mustCatch('a 200 shell with no listing payload being resolved instead of held',
  ['return "unknown", f"200 without a listing payload ({len(body)} bytes — shell/interstitial)"',
   'return "gone", "mutant"']);
// An unresolved redirect: we do not know where we landed.
mustCatch('an unresolved redirect being judged instead of held',
  ['return "unknown", f"redirected off the property path to {final_url[:120]!r}"',
   'return "live", "mutant"']);
// The opposite failure, which is how an oracle silently stops protecting anything: if the real
// death signal stops killing, raghdan keeps serving removed ads and the barrier must say so.
mustCatch('the real 404 death signal no longer deactivating',
  ['return "gone", f"HTTP {status} and no listing payload (source does not serve this property)"',
   'return "unknown", "mutant"']);
// And the restore leg: an oracle that never says 'live' cannot self-heal a wrongly-struck row.
mustCatch('the live limb no longer certifying a served listing',
  ['return "live", f"200 with a RealEstateListing JSON-LD payload ({len(body)} bytes)"',
   'return "unknown", "mutant"']);

console.log(failed === 0
  ? '\n✅ verify-raghdan-absence-cannot-deactivate: absence selects candidates; only the source kills.'
  : `\n❌ verify-raghdan-absence-cannot-deactivate: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
