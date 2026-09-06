// UNKNOWN IS NOT DEAD — sanadak's deactivation path, executed rather than read.
//
// THE DEFECT THIS EXISTS TO PREVENT
// --------------------------------
// Until 2026-09-06 scrapers/sanadak/run.py called db.prune_unseen() with NO source oracle, so three
// consecutive crawl misses deactivated a listing on ABSENCE alone. docs/ops/LISTING_LIVENESS.md
// §1–§3 forbids exactly that inference: absence is EvidenceKind.ABSENCE, a candidate signal and
// never a verdict. It produced a standing P1 `unknown_treated_as_dead` (alert_event 1490 and 1623:
// 32 rows deactivated inside 48h with no source verdict recorded anywhere), and what waits at the
// end of that road is a permanent, unrecoverable delete.
//
// WHAT MAKES THIS PLATFORM'S ORACLE NON-OBVIOUS — all three measured 2026-09-06, not assumed:
//
//  1. sanadak SOFT-404s. A removed listing answers HTTP 200 with a ~144 KB app shell (no SSR
//     <title>, no listing object); a live one answers ~640–716 KB with both. 140/143 rows already
//     deactivated rendered the shell; 77/80 known-ACTIVE controls rendered a real listing. So
//     "status code == 404" is not this platform's death signal and an oracle keyed on it would
//     never deactivate anything — the failure that leaves dead inventory searchable forever.
//  2. 39 of 1,724 sanadak rows (2.3%) carry a `listing_url` whose trailing advertisement number is
//     NOT that row's own ad_number. Probing those asks a DIFFERENT listing whether THIS one is
//     alive, and three of them answered 'live' in the same sweep — three false resurrections a
//     naive oracle would have performed. Identity is therefore checked twice: the URL's trailing id
//     must equal the ad_number, and the page must then yield the object whose advertisementNumber
//     matches (`_extract_obj_for_url`, the same primitive the capture path uses).
//  3. Because "gone" here IS a 200, a source that started serving shells to our egress the way
//     dealapp does (§5.1) would turn this oracle into a mass-deactivation engine. LISTING_LIVENESS
//     §5.4 asked for an in-run positive control and recorded that nobody had built one; this
//     scraper now has it, and the canary gate is asserted and mutation-proven below.
//
// WHY THIS BARRIER EXECUTES THE FUNCTIONS INSTEAD OF GREPPING THEM
// ---------------------------------------------------------------
// AGENTS.md: every one of the five defects of 2026-09-04 had a barrier over the exact line, and
// every one of those barriers was a source-TEXT tripwire that stayed green for as long as the
// defect was live. So this file imports the REAL `_gone_verdict` / `_verify_gone` / `_canary_ok`
// out of the shipped module and runs them against injected responses. Even the wiring assertion is
// read from the module's SYNTAX TREE rather than its text, so a docstring mentioning prune_unseen
// can never be mistaken for a call site.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-sanadak-absence-cannot-deactivate: only an affirmative source answer may kill.');

const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.sanadak.run as run

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
    run._gone_verdict = gv

AD  = "SN7200987921"
URL = "https://sanadak.sa/property-details/شقة-للبيع-في-أبها-الروابي-6-غرفة-7200987921"
# A DIFFERENT listing's URL — the 2.3% of rows whose stored URL is not their own.
OTHER_URL = "https://sanadak.sa/property-details/مبنى-للإيجار-في-الرياض-الرمال-7200885815"

# The two real body shapes. LIVE carries this ad's own advertisementNumber in the flight stream,
# which is what run._extract_obj_for_url() resolves; the shell carries neither it nor a title.
LIVE_BODY = ('<html><head><title>شقة للبيع في أبها الروابي 6 غرفة</title></head><body>'
             'self.__next_f.push([1,"{\"advertisementNumber\":\"7200987921\",\"price\":900000}"])'
             + "x" * 600000 + '</body></html>')
# Another listing's page, rendered in full — a title, but not OUR ad number.
OTHER_BODY = ('<html><head><title>مبنى للإيجار في الرياض الرمال</title></head><body>'
              'self.__next_f.push([1,"{\"advertisementNumber\":\"7200885815\",\"price\":10}"])'
              + "x" * 600000 + '</body></html>')
SHELL_BODY = '<html><head></head><body>' + "y" * 144000 + '</body></html>'

def v(status, body, ad=AD, url=URL):
    r = gv(status, body, ad, url)
    return None if r is None else r[0]

table = {
  # Every UNKNOWN shape the contract enumerates. None here means "retry", which the caller turns
  # into 'unknown'; what matters is that NONE of them is 'gone'.
  "network_error":        v(None, None),
  "401_unauthorised":     v(401, SHELL_BODY),
  "403_blocked":          v(403, SHELL_BODY),
  "407_proxy":            v(407, SHELL_BODY),
  "408_timeout":          v(408, SHELL_BODY),
  "429_throttled":        v(429, SHELL_BODY),
  "500_server":           v(500, SHELL_BODY),
  "502_server":           v(502, SHELL_BODY),
  "503_server":           v(503, SHELL_BODY),
  "504_server":           v(504, SHELL_BODY),
  "302_unresolved":       v(302, SHELL_BODY),
  "200_empty_body":       v(200, ""),
  # A page that rendered a DIFFERENT listing is not an answer about this one, in either direction.
  "200_other_listing":    v(200, OTHER_BODY),
  # The stored URL belongs to another listing: refuse before the fetch even matters.
  "url_is_another_ad":    v(200, SHELL_BODY, AD, OTHER_URL),
  "url_is_another_ad_live": v(200, OTHER_BODY, AD, OTHER_URL),
  "ad_not_numeric":       v(200, SHELL_BODY, "SN-not-a-number", URL),
  # The affirmative DEAD limbs.
  "200_shell":            v(200, SHELL_BODY),
  "404_hard":             v(404, SHELL_BODY),
  "410_hard":             v(410, SHELL_BODY),
  # The affirmative ALIVE limb.
  "200_own_listing":      v(200, LIVE_BODY),
}

# ── The whole function, executed against an injected transport: no network, no clock ────────────
import time; time.sleep = lambda *_a, **_k: None

def wire(seq, canaries=(URL,), ad=AD, url=URL):
    """seq: list of (status, body) or Exception, consumed by _oracle_fetch in order.
    The canary probe consumes from the SAME sequence, so a run whose source is shelling out is
    modelled exactly as production would see it."""
    box = list(seq)
    def fetch(u):
        if not box:
            return None, None, "sequence exhausted"
        item = box.pop(0)
        if isinstance(item, Exception):
            return None, None, "%s: %s" % (type(item).__name__, item)
        return item[0], item[1], u
    run._oracle_fetch = fetch
    run.set_liveness_canaries(list(canaries))
    return run._verify_gone(ad, url)

wired = {
  # A source that answers nothing cannot testify that anything is gone.
  "blocked_twice":       wire([(403, SHELL_BODY), (403, SHELL_BODY)])[0],
  "timeout_twice":       wire([OSError("reset"), OSError("reset")])[0],
  "5xx_twice":           wire([(500, SHELL_BODY), (503, SHELL_BODY)])[0],
  # Retries work in both directions.
  "transient_then_live": wire([(500, SHELL_BODY), (200, LIVE_BODY)])[0],
  "transient_then_gone": wire([OSError("x"), (200, SHELL_BODY), (200, LIVE_BODY)])[0],
  # The happy paths: a removal is believed only while a canary still renders a real listing.
  "removed_canary_ok":   wire([(200, SHELL_BODY), (200, LIVE_BODY)])[0],
  "alive":               wire([(200, LIVE_BODY)])[0],
  # THE §5.4 GATE. Same shell answer for the row AND for the canary = the source is serving
  # shells, not a catalogue that emptied. Nothing may be deactivated.
  "removed_canary_shell": wire([(200, SHELL_BODY), (200, SHELL_BODY)])[0],
  "removed_canary_500":   wire([(200, SHELL_BODY), (500, SHELL_BODY)])[0],
  "removed_no_canary":    wire([(200, SHELL_BODY)], canaries=())[0],
  # No URL at all is nothing DIRECT to probe.
  "no_url":               wire([], ad=AD, url="")[0],
}
canary_reason = wire([(200, SHELL_BODY), (200, SHELL_BODY)])[1]

# ── The wiring, read from the SYNTAX TREE (a docstring is not a call site) ──────────────────────
import ast
tree = ast.parse(open(run.__file__, encoding="utf-8").read())
call_sites = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
       and node.func.attr == "prune_unseen":
        kw = {k.arg: (getattr(k.value, "id", None) or getattr(k.value, "attr", None))
              for k in node.keywords if k.arg}
        call_sites.append({"line": node.lineno, "verify_gone": kw.get("verify_gone")})
canary_calls = [n.lineno for n in ast.walk(tree)
                if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "set_liveness_canaries"]

print(json.dumps({"table": table, "wired": wired, "call_sites": call_sites,
                  "canary_calls": canary_calls, "canary_reason": canary_reason}))
`;

type Result = {
  table?: Record<string, string | null>;
  wired?: Record<string, string>;
  call_sites?: { line: number; verify_gone: string | null }[];
  canary_calls?: number[];
  canary_reason?: string;
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

const UNKNOWN_SHAPES = [
  'network_error', '401_unauthorised', '403_blocked', '407_proxy', '408_timeout', '429_throttled',
  '500_server', '502_server', '503_server', '504_server', '302_unresolved', '200_empty_body',
  '200_other_listing', 'url_is_another_ad', 'url_is_another_ad_live', 'ad_not_numeric',
];
const GONE_SHAPES = ['200_shell', '404_hard', '410_hard'];
// The identity shapes are asserted STRICTLY as 'unknown', not merely as "not gone": reading another
// listing's live page as 'live' is a false RESURRECTION, which is the other half of this failure.
const STRICT_UNKNOWN = ['200_other_listing', 'url_is_another_ad', 'url_is_another_ad_live',
                        'ad_not_numeric'];

const lawHolds = (r: Result): string[] => {
  const t = r.table ?? {};
  const held: string[] = [];
  for (const k of UNKNOWN_SHAPES) if (t[k] !== 'gone') held.push(`unknown:${k}`);
  for (const k of GONE_SHAPES) if (t[k] === 'gone') held.push(`gone:${k}`);
  for (const k of STRICT_UNKNOWN) if (t[k] === 'unknown') held.push(`strict:${k}`);
  if (t['200_own_listing'] === 'live') held.push('live:200_own_listing');
  return held;
};
const TOTAL = UNKNOWN_SHAPES.length + GONE_SHAPES.length + STRICT_UNKNOWN.length + 1;

const base = runHarness();
check(!base.error, 'the shipped oracle imports and runs', base.error ?? '');

for (const k of UNKNOWN_SHAPES) {
  check(base.table?.[k] !== 'gone', `${k} is NOT death`,
    `_gone_verdict returned ${JSON.stringify(base.table?.[k])} — an UNKNOWN read must never deactivate`);
}
for (const k of GONE_SHAPES) {
  check(base.table?.[k] === 'gone', `${k} IS an affirmative source removal`,
    `returned ${JSON.stringify(base.table?.[k])} — this platform's real death signal is the 200 ` +
    'app shell; if it stops killing, removed inventory stays searchable forever');
}
for (const k of STRICT_UNKNOWN) {
  check(base.table?.[k] === 'unknown',
    `${k} is UNKNOWN, not a verdict about this listing`,
    `returned ${JSON.stringify(base.table?.[k])} — 39 of 1,724 rows store another listing's URL; ` +
    "reading that page as 'live' resurrects a row on someone else's evidence");
}
check(base.table?.['200_own_listing'] === 'live',
  '200 whose flight stream carries THIS ad number is ALIVE (the self-heal limb)');

for (const k of ['blocked_twice', 'timeout_twice', '5xx_twice']) {
  check(base.wired?.[k] === 'unknown', `_verify_gone: ${k} exhausts its retries as 'unknown'`,
    `returned ${JSON.stringify(base.wired?.[k])} — a source we could not reach is not a dead listing`);
}
check(base.wired?.transient_then_live === 'live',
  "_verify_gone: a transient 5xx followed by a live read is 'live' (retries work)");
check(base.wired?.transient_then_gone === 'gone',
  "_verify_gone: a dropped connection followed by a shell (canary alive) is 'gone'");
check(base.wired?.removed_canary_ok === 'gone', "_verify_gone: a removed listing is 'gone'");
check(base.wired?.alive === 'live', "_verify_gone: a served listing is 'live'");
check(base.wired?.no_url === 'unknown',
  "_verify_gone: a row with no listing_url is 'unknown' — there is nothing DIRECT to probe");

// ── The §5.4 in-run positive control ──────────────────────────────────────────────────────────
check(base.wired?.removed_canary_shell === 'unknown',
  'a removal is WITHHELD when the canary also shells out (the source is serving shells, not empty)',
  `returned ${JSON.stringify(base.wired?.removed_canary_shell)} — this is the dealapp failure mode ` +
  '(LISTING_LIVENESS.md §5.1) and on this platform it would deactivate the entire probed cohort');
check(base.wired?.removed_canary_500 === 'unknown',
  'a removal is WITHHELD when the canary cannot be reached at all');
check(base.wired?.removed_no_canary === 'unknown',
  'a removal is WITHHELD when no canary was supplied (the gate fails CLOSED, not open)');
check(/withheld/.test(base.canary_reason ?? ''),
  'the withheld verdict says WHY, so a held run is auditable rather than silent',
  JSON.stringify(base.canary_reason));

// ── The wiring ────────────────────────────────────────────────────────────────────────────────
const sites = base.call_sites ?? [];
check(sites.length > 0, 'the module still calls prune_unseen (the path this barrier guards exists)',
  'no prune_unseen call found in the syntax tree — this barrier would pass vacuously');
const unwired = sites.filter((s) => s.verify_gone !== '_verify_gone');
check(unwired.length === 0,
  `EVERY prune_unseen call site on this platform carries the oracle (${sites.length} found)`,
  `line(s) ${unwired.map((s) => s.line).join(', ')} prune WITHOUT verify_gone=_verify_gone`);
check((base.canary_calls ?? []).length > 0,
  'the run arms the canary before pruning (an unarmed gate withholds every removal)',
  'set_liveness_canaries() is never called, so the oracle could not deactivate anything at all');

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
mustCatch('a network error resolving to a verdict instead of a retry',
  ['if status is None:\n        return None', 'if status is None:\n        return "gone", "mutant"']);
// The identity guard, both halves — this is the false-resurrection direction.
mustCatch("another listing's URL being probed as if it were this row's",
  ['if _url_ad_number(url or "") != sid:', 'if False:']);
mustCatch('a page that rendered a different listing being resolved instead of held',
  ['return "unknown", f"200 rendered a page we could not resolve to {sid} ({len(body)} bytes)"',
   'return "live", "mutant"']);
// An empty body is a fetch, not an answer.
mustCatch('an empty 200 body being read as the app shell (i.e. as a removal)',
  ['return "unknown", "200 with an empty body"', 'return "gone", "mutant"']);
// The opposite failure: the real death signal stops killing and removed ads stay searchable.
mustCatch('the real 200-shell death signal no longer deactivating',
  ['return "gone", f"200 app shell with no listing and no SSR title ({len(body)} bytes)"',
   'return "unknown", "mutant"']);
// And the restore leg: an oracle that never says 'live' cannot self-heal a wrongly-struck row.
mustCatch('the live limb no longer certifying a served listing',
  ['return "live", f"200 rendering advertisementNumber {sid} ({len(body)} bytes)"',
   'return "unknown", "mutant"']);

console.log(failed === 0
  ? '\n✅ verify-sanadak-absence-cannot-deactivate: absence selects candidates; only the source kills.'
  : `\n❌ verify-sanadak-absence-cannot-deactivate: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
