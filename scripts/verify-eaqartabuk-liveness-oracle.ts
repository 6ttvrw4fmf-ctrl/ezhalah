// eaqartabuk's DIRECT liveness oracle must be able to say GONE, must be able to say LIVE, and
// must never turn a BLOCK into a death.
// Routine #11 (listing lifecycle), 2026-09-26, alert_event 5923 (P1 unknown_treated_as_dead).
//
// THE BUG THIS PINS
// -----------------
// scrapers/eaqartabuk/run.py called db.prune_unseen() with no `verify_gone=`, so crawl ABSENCE
// alone deactivated a listing after 3 misses. That is the inference
// docs/ops/LISTING_LIVENESS.md §1-§3 forbids: absence is EvidenceKind.ABSENCE, a candidate signal
// and never a verdict. All four rows this platform had ever deactivated carried
// last_verified_alive_at IS NULL and no GONE probe — the source had never once spoken about any
// of them, and a throttled run, a partial page and a real removal all look identical from here.
//
// THE MEASUREMENT, FROZEN (probed live 2026-09-26 through the shipped function, live controls
// INTERLEAVED with dead ones, 9/9):
//
//   pid     state                      HTML   candles-map/v1   public/v1/property
//   10221   withdrawn                   404   200  ← TRAP      403 rh_not_public
//   10306   withdrawn                    —    200  ← TRAP      403 rh_not_public
//   10181   hard-deleted                404    —               404 rh_not_found
//   8329    LIVE (in LIST page 7)       200   200              200, id echoed
//   5664/5702/5727  LIVE controls       200   200              200, id echoed
//   999999 / 1      never existed        —     —               404 rh_not_found
//
// THE ENDPOINT THE SCRAPER ITSELF CALLS "AUTHORITATIVE" WOULD HAVE LIED. `candles-map/v1` answers
// HTTP 200 with a complete record for a WITHDRAWN property. An oracle built on it — the obvious
// choice, since the ENRICH path already uses it — would have certified every dead ad ALIVE. That
// is the aqargate/abeea trap, and it is why this file executes the predicate rather than reading
// the source for the word "verify_gone".
//
// WHAT MUST NOT REGRESS
//   * a withdrawn property (403 rh_not_public) must score GONE — otherwise the oracle can never
//     retire anything, which is ops_incident #778's shape exactly (muktamel: 1,132 probes,
//     1,132 UNKNOWN, never once GONE or LIVE, and no monitor could see it);
//   * a deleted property (404 rh_not_found) must score GONE;
//   * a live property must score LIVE, and only when the payload ECHOES the id asked for;
//   * a BARE 403/404 — an edge block, a WAF, a rate-limiter, a misrouted path — must score
//     UNKNOWN. This is the destructive direction and the whole safety margin of this platform:
//     a blocked run and a withdrawn ad both answer 403, and only the application's own code
//     separates them;
//   * a timeout, a connection reset, a 5xx, a 429 and an unparseable body must all score UNKNOWN;
//   * a fetch that RAISES must score UNKNOWN — never "gone".
//
// Every assertion EXECUTES the real predicate lifted out of the shipped module — never a
// re-implementation, never a source-text grep. A source-text tripwire over these exact lines
// would have passed for every day the platform had no oracle at all.
//
// Deliberately OFFLINE — no DB, no network. Hermetic by construction.
//   node --experimental-strip-types scripts/verify-eaqartabuk-liveness-oracle.ts

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUNPY = join(ROOT, 'scrapers', 'eaqartabuk', 'run.py');

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};
const mustCatch = (label: string, caught: boolean, detail = '') => ok(label, caught, detail);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The harness LIFTS _GONE_CODES, _liveness_verdict and _verify_gone out of run.py by AST and
// execs them in a bare namespace, so none of the scraper's dependency tree (curl_cffi, supabase,
// dotenv) is needed and nothing but the shipped decision code is under test.
//
// Each mutation is applied by PATTERN and its substitution count is asserted non-zero: a mutation
// that silently matched nothing would make this file report a catch it never made.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const HARNESS = String.raw`
import ast, json, sys, time
from typing import Any, Optional

PATH = sys.argv[1]

def lift(mutations=()):
    src = open(PATH, encoding="utf-8").read()
    tree = ast.parse(src)
    lines = src.splitlines(keepends=True)
    want = {"_liveness_verdict", "_verify_gone"}
    chunks = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_GONE_CODES" for t in node.targets):
            chunks.append("".join(lines[node.lineno - 1:node.end_lineno]))
        elif isinstance(node, ast.FunctionDef) and node.name in want:
            chunks.append("".join(lines[node.lineno - 1:node.end_lineno]))
    if len(chunks) != 3:
        raise SystemExit(f"LIFT FAILED: expected _GONE_CODES + 2 functions, found {len(chunks)}. "
                         f"The oracle was renamed or removed from {PATH}.")
    code = "\n".join(chunks)
    for old, new in mutations:
        if old not in code:
            raise SystemExit(f"MUTATION MATCHED NOTHING: {old!r}")
        code = code.replace(old, new)
    ns = {"Any": Any, "Optional": Optional, "time": time}
    exec(compile(code, PATH + " (lifted)", "exec"), ns)
    return ns

class StubResponse:
    def __init__(self, status, body, unparseable=False):
        self.status_code = status
        self._body = body
        self._unparseable = unparseable
    def json(self):
        if self._unparseable:
            raise ValueError("not json")
        return self._body

class StubSession:
    """Stands in for curl_cffi. The script is a list of responses or exceptions, in order."""
    def __init__(self, script):
        self.script = list(script)
        self.calls = 0
    def get(self, url, timeout=None):
        self.calls += 1
        item = self.script[min(self.calls - 1, len(self.script) - 1)]
        if isinstance(item, Exception):
            raise item
        return item

def run(mutations=()):
    ns = lift(mutations)
    verdict = ns["_liveness_verdict"]
    out = {}

    # ── the frozen measurement, through the PURE decision ──
    out["withdrawn_403"]   = verdict(403, {"code": "rh_not_public", "message": "x"}, "10221")[0]
    out["deleted_404"]     = verdict(404, {"code": "rh_not_found", "message": "x"}, "10181")[0]
    out["live_200"]        = verdict(200, {"id": 8329, "title": "t"}, "8329")[0]
    out["live_200_strid"]  = verdict(200, {"id": "5664", "title": "t"}, "5664")[0]

    # ── the destructive direction: a block is not a death ──
    out["bare_403"]        = verdict(403, {"code": "rest_forbidden"}, "10221")[0]
    out["bare_403_html"]   = verdict(403, None, "10221")[0]
    out["bare_404"]        = verdict(404, {"code": "rest_no_route"}, "10221")[0]
    out["bare_404_html"]   = verdict(404, None, "10221")[0]
    out["http_429"]        = verdict(429, None, "10221")[0]
    out["http_500"]        = verdict(500, None, "10221")[0]
    out["http_503"]        = verdict(503, None, "10221")[0]
    out["http_401"]        = verdict(401, None, "10221")[0]
    out["no_answer"]       = verdict(None, None, "10221")[0]
    out["unparseable_200"] = verdict(200, None, "10221")[0]
    out["id_mismatch"]     = verdict(200, {"id": 9999}, "8329")[0]

    # ── the reason must be recorded, not just the verdict (prune_unseen persists it) ──
    out["reason_withdrawn"] = verdict(403, {"code": "rh_not_public"}, "10221")[1]
    out["reason_bare"]      = verdict(403, {"code": "rest_forbidden"}, "10221")[1]

    # ── the FETCH leg, executed against injected failures ──
    vg = ns["_verify_gone"]
    ns["DETAIL"] = "https://stub.invalid/p"
    ns["time"] = type("T", (), {"sleep": staticmethod(lambda *_: None)})()

    def with_session(script):
        s = StubSession(script)
        ns["_session"] = lambda: s
        return s

    with_session([ConnectionResetError("reset")])
    out["fetch_all_reset"] = vg("ET10181")[0]

    with_session([TimeoutError("timeout")])
    out["fetch_timeout"] = vg("ET10181")[0]

    # a transient failure followed by a real answer must reach that answer
    s = with_session([ConnectionResetError("reset"),
                      StubResponse(404, {"code": "rh_not_found"})])
    out["fetch_reset_then_gone"] = vg("ET10181")[0]
    out["fetch_retried"] = s.calls

    with_session([StubResponse(200, {"id": 8329})])
    out["fetch_live"] = vg("ET8329")[0]

    with_session([StubResponse(500, None)])
    out["fetch_5xx"] = vg("ET8329")[0]

    with_session([StubResponse(200, None, unparseable=True)])
    out["fetch_unparseable"] = vg("ET8329")[0]

    out["bad_ad_number"] = vg("XX12")[0]
    out["empty_ad_number"] = vg("")[0]
    return out

muts = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
print(json.dumps(run([(m[0], m[1]) for m in muts])))
`;

type Result = Record<string, string | number>;
const exec = (mutations: [string, string][] = []): Result => {
  const raw = execFileSync('python3', ['-c', HARNESS, RUNPY, JSON.stringify(mutations)], {
    encoding: 'utf8', timeout: 60_000,
  });
  return JSON.parse(raw);
};

console.log('eaqartabuk DIRECT liveness oracle — executing the lifted predicate\n');

// ─── 1. The shipped oracle, against every shape the source really produces ───────────────────
const m = exec();

console.log('  the measured truth table:');
ok('a withdrawn property (403 rh_not_public) scores GONE', m.withdrawn_403 === 'gone', String(m.withdrawn_403));
ok('a deleted property (404 rh_not_found) scores GONE', m.deleted_404 === 'gone', String(m.deleted_404));
ok('a live property (200, id echoed) scores LIVE', m.live_200 === 'live', String(m.live_200));
ok('a live property whose id arrives as a string scores LIVE', m.live_200_strid === 'live', String(m.live_200_strid));

console.log('\n  UNKNOWN IS NOT DEAD — every non-answer:');
for (const [label, key] of [
  ['a 403 with a non-removal code (WAF / rest_forbidden)', 'bare_403'],
  ['a 403 with an unparseable body (an edge block)', 'bare_403_html'],
  ['a 404 with a non-removal code (rest_no_route)', 'bare_404'],
  ['a 404 with an unparseable body', 'bare_404_html'],
  ['HTTP 429 (rate-limited)', 'http_429'],
  ['HTTP 500', 'http_500'],
  ['HTTP 503', 'http_503'],
  ['HTTP 401', 'http_401'],
  ['no answer at all', 'no_answer'],
  ['a 200 we cannot parse', 'unparseable_200'],
  ['a 200 for a DIFFERENT property', 'id_mismatch'],
] as const) {
  ok(`${label} scores UNKNOWN`, m[key] === 'unknown', String(m[key]));
}

console.log('\n  the fetch leg, against injected failures:');
ok('every attempt resetting scores UNKNOWN', m.fetch_all_reset === 'unknown', String(m.fetch_all_reset));
ok('every attempt timing out scores UNKNOWN', m.fetch_timeout === 'unknown', String(m.fetch_timeout));
ok('a 5xx on every attempt scores UNKNOWN', m.fetch_5xx === 'unknown', String(m.fetch_5xx));
ok('an unparseable 200 scores UNKNOWN', m.fetch_unparseable === 'unknown', String(m.fetch_unparseable));
ok('a reset FOLLOWED by a real answer reaches that answer', m.fetch_reset_then_gone === 'gone', String(m.fetch_reset_then_gone));
ok('…and it did so by retrying, not by guessing', Number(m.fetch_retried) >= 2, `${m.fetch_retried} calls`);
ok('a live answer through the real fetch leg scores LIVE', m.fetch_live === 'live', String(m.fetch_live));
ok('an ad_number carrying no numeric id scores UNKNOWN', m.bad_ad_number === 'unknown', String(m.bad_ad_number));
ok('an empty ad_number scores UNKNOWN', m.empty_ad_number === 'unknown', String(m.empty_ad_number));

console.log('\n  the kill states its reason (prune_unseen persists it as evidence):');
ok('the GONE reason names the code that killed', String(m.reason_withdrawn).includes('rh_not_public'), String(m.reason_withdrawn));
ok('the UNKNOWN reason says what arrived instead', String(m.reason_bare).includes('rest_forbidden'), String(m.reason_bare));

// ─── 2. MUTATIONS — each must break something this file asserts ───────────────────────────────
console.log('\n  mutations (each must be CAUGHT):');

// 2a. THE DESTRUCTIVE DIRECTION: treat a bare 403 as a removal. A blocked run would then
//     deactivate live listings in bulk — the single worst outcome this platform can produce.
{
  const mut = exec([[
    'if code in _GONE_CODES:',
    'if code in _GONE_CODES or status == 403:',
  ]]);
  mustCatch('a BARE 403 read as death — a WAF block becomes a mass deactivation',
    mut.bare_403 === 'gone' && mut.bare_403_html === 'gone',
    `bare_403=${mut.bare_403}, bare_403_html=${mut.bare_403_html}`);
  ok('…and the barrier above asserts the shipped code does NOT do that', m.bare_403 === 'unknown');
}

// 2b. A 5xx / timeout read as death — the "UNKNOWN IS NOT DEAD" violation in its purest form.
{
  const mut = exec([[
    'return "unknown", f"HTTP {status}"',
    'return "gone", f"HTTP {status}"',
  ]]);
  mustCatch('a 5xx read as death — an outage becomes a deletion clock',
    mut.http_500 === 'gone' && mut.http_503 === 'gone' && mut.http_429 === 'gone',
    `500=${mut.http_500}, 503=${mut.http_503}, 429=${mut.http_429}`);
}

// 2c. Dropping the withdrawn limb: the oracle can then never retire a withdrawn ad. This is
//     ops_incident #778's shape — an oracle that answers UNKNOWN forever and looks healthy.
{
  const mut = exec([['    "rh_not_public",', '']]);
  mustCatch('dropping rh_not_public — the oracle can never retire a withdrawn property',
    mut.withdrawn_403 === 'unknown', String(mut.withdrawn_403));
}

// 2d. Dropping the deleted limb.
{
  const mut = exec([['    "rh_not_found",', '']]);
  mustCatch('dropping rh_not_found — a hard-deleted property reads UNKNOWN forever',
    mut.deleted_404 === 'unknown', String(mut.deleted_404));
}

// 2e. THE candles-map TRAP, in predicate form: believing any 200 without checking the id. The
//     withdrawn ids 10221/10306 answer 200 on that endpoint, so an oracle that trusts a bare 200
//     certifies dead ads ALIVE and nothing on this platform is ever retired again.
{
  const mut = exec([['        if got != pid:', '        if False:']]);
  mustCatch('trusting a 200 without the id echo — a 200 for another property reads LIVE',
    mut.id_mismatch === 'live', String(mut.id_mismatch));
}

// 2f. An oracle that can never say LIVE never self-heals, so a live listing absent from three
//     crawls stays dead. (prune_unseen's 'live' branch is what restores it.)
{
  const mut = exec([['        return "live", f"200 public record, id {pid} echoed"',
                     '        return "unknown", "disabled"']]);
  mustCatch('an oracle that can never say LIVE — self-heal is dead and a live row stays killed',
    mut.live_200 === 'unknown' && mut.fetch_live === 'unknown',
    `live_200=${mut.live_200}, fetch_live=${mut.fetch_live}`);
}

// 2g. A raising fetch read as death.
{
  const mut = exec([['            last = f"{type(e).__name__}: {str(e)[:80]}"',
                     '            return "gone", "fetch raised"']]);
  mustCatch('a fetch that RAISES read as death — a network fault becomes a removal',
    mut.fetch_all_reset === 'gone' && mut.fetch_timeout === 'gone',
    `reset=${mut.fetch_all_reset}, timeout=${mut.fetch_timeout}`);
}

// ─── 3. The oracle must actually be HANDED to prune_unseen ────────────────────────────────────
// A perfect oracle nobody calls is decoration. This is the one clause that must read the call
// site, and it reads it by AST — the argument really being passed, not the string "verify_gone"
// appearing somewhere in the file (it appears in this platform's comments several times).
{
  const wired = execFileSync('python3', ['-c', String.raw`
import ast, sys
tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())
hits = []
for node in ast.walk(tree):
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "prune_unseen"):
        kw = {k.arg: k.value for k in node.keywords}
        v = kw.get("verify_gone")
        hits.append(isinstance(v, ast.Name) and v.id == "_verify_gone")
print("YES" if hits and all(hits) else f"NO ({len(hits)} call site(s))")
`, RUNPY], { encoding: 'utf8' }).trim();
  ok('every db.prune_unseen() call site is handed verify_gone=_verify_gone', wired === 'YES', wired);
}

console.log(
  failed === 0
    ? '\nPASS — the oracle can say GONE, can say LIVE, turns no block into a death, and is wired ' +
      'into every prune_unseen call site. 7 mutations caught, including a bare 403 read as death.'
    : `\nFAIL — ${failed} assertion(s)`,
);
process.exit(failed === 0 ? 0 : 1);
