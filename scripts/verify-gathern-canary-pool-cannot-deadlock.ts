// UNKNOWN IS NOT DEAD, and its mirror image: a control set that can only ever fail is not safety.
//
// THE DEFECT THIS EXISTS TO PREVENT (ops_incident #168, measured in production 2026-09-11)
// ----------------------------------------------------------------------------------------
// gathern's liveness sweep proves its environment before deciding any listing's fate: it probes a
// handful of known-alive controls, and if they do not come back alive the whole run is quarantined
// (0 strikes, 0 inactivations). That gate is correct and is NOT what this barrier relaxes.
//
// The bug was in how the controls were CHOSEN. `_collect_canaries()` ranked them by
// `last_verified_alive_at` — a column written ONLY by this same sweep. A self-referential control
// set cannot recover from a stall:
//
//     the sweep quarantines -> no new last_verified_alive_at is written -> the pool ages ->
//     gathern is short-stay rental inventory, so a days-old "proven alive" row has very often been
//     delisted -> those genuine 404s read as "the source refused this egress" -> quarantine.
//
// The loop is closed and tightens on its own. From 2026-09-07 every scheduled run reported
// `CANARY FAIL 0/10 statuses[404x10]` and wrote zero strikes, while 1,431 gathern listings whose
// own detail page returns 404 stayed `production_ready` and were served to users — about 5% of that
// platform's searchable inventory. The pool's freshest entry sat five days stale.
//
// Proven by execution on 2026-09-11 — same container, same transport, same minute:
//
//     the pool this code actually returned      10/10 -> HTTP 404
//     rows the crawl had seen that morning      10/10 -> HTTP 200
//
// The source was never blocking us. Our controls were dead, and `canary_diagnosis()` reported
// "the SOURCE answered and refused this egress", which sent five days of readers to the wrong
// system — including a dispatch of the owner-authorised Saudi residential proxy, which answered
// 0/10 for exactly the same reason.
//
// WHAT THIS BARRIER MAY NOT BE MISREAD AS
// ---------------------------------------
// It does not loosen the gate. MIN_CANARIES, MIN_CANARY_ALIVE_RATE, the 3-strike grace, the anomaly
// cap and the run-level trust floor are untouched, and `canary_environment_ok` is EXECUTED below to
// pin that a fresh control set which all-404s still quarantines. The repair is to the control's
// INPUT, so the gate can answer the question it was built to ask. A stale control is not a weak
// control — it is noise that can only ever fail, which is strictly worse than having none.
//
// WHY THIS EXECUTES THE FUNCTION INSTEAD OF GREPPING IT
// ----------------------------------------------------
// AGENTS.md: every one of the five defects of 2026-09-04 had a barrier over the exact line, and
// every one of those barriers was a source-TEXT tripwire that stayed green for as long as the
// defect was live. So this file runs the REAL `choose_canaries` / `_observed_at` out of the shipped
// module against the real production shape, and the wiring assertion is read from the module's
// SYNTAX TREE rather than its text.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  // Deliberately string concatenation, not a template literal, throughout this file — see the same
  // note in scripts/verify-sanadak-absence-cannot-deactivate.ts. The mutation-proof ratchet strips
  // quoted spans in independent global passes, so a stray quote of another kind can desynchronise
  // it and make every mustCatch( call in the tail of the file invisible.
  if (ok) { console.log('  ok  ' + what); return; }
  failed += 1;
  console.log('FAIL  ' + what + (detail ? '\n      ' + detail : ''));
};

const HARNESS = String.raw`
import json, os, sys, types, ast, inspect, textwrap
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.getcwd())

_sb = types.ModuleType("supabase")
_sb.Client = type("Client", (), {})
_sb.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

try:
    import scrapers.gathern.liveness as lv
    from scrapers.common.liveness_trust import canary_environment_ok
except Exception as exc:
    print(json.dumps({"error": "import failed: %s: %s" % (type(exc).__name__, exc)}))
    sys.exit(0)

choose = lv.choose_canaries
mut = os.environ.get("MUTATE")
if mut:
    fname, find, repl = json.loads(mut)
    target = getattr(lv, fname)
    src = textwrap.dedent(inspect.getsource(target))
    if find not in src:
        print(json.dumps({"error": "mutation target not found in %s: %r" % (fname, find)}))
        sys.exit(0)
    ns = dict(lv.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    setattr(lv, fname, ns[fname])
    # Rebind through the module so a mutated helper is seen by its caller too.
    choose = lv.choose_canaries if fname == "choose_canaries" else ns.get("choose_canaries", lv.choose_canaries)
    if fname != "choose_canaries":
        src2 = textwrap.dedent(inspect.getsource(lv.choose_canaries))
        ns2 = dict(lv.__dict__)
        exec(compile(src2, "<rebound>", "exec"), ns2)
        choose = ns2["choose_canaries"]

NOW = datetime(2026, 9, 11, 14, 0, tzinfo=timezone.utc)

def row(rid, seen=None, verified=None, url=None):
    return {
        "id": rid,
        "ad_number": "G%d" % rid,
        "listing_url": ("https://gathern.co/view/%d/unit/%d" % (rid, rid)) if url is None else url,
        "last_seen_at": seen.isoformat() if isinstance(seen, datetime) else seen,
        "last_verified_alive_at": verified.isoformat() if isinstance(verified, datetime) else verified,
    }

# The EXACT production shape on 2026-09-11: every candidate's freshest observation is 2026-09-06,
# and all ten of these rows were genuinely delisted.
STALE_AT = datetime(2026, 9, 6, 10, 29, 47, tzinfo=timezone.utc)
stale = [row(i, seen=STALE_AT, verified=STALE_AT) for i in range(10)]
fresh = [row(100 + i, seen=NOW - timedelta(hours=9)) for i in range(10)]
fresh_verified = [row(200 + i, verified=NOW - timedelta(hours=2)) for i in range(10)]

AGE = lv.CANARY_MAX_AGE_HOURS
inside = row(1, seen=NOW - timedelta(hours=AGE - 1))
outside = row(2, seen=NOW - timedelta(hours=AGE + 1))

def ids(rows):
    return [r["id"] for r in rows]

out = {
    "production_deadlock": ids(choose(stale, 10, now=NOW)),
    "fresh_usable": ids(choose(fresh, 10, now=NOW)),
    "prefers_fresh": ids(choose(stale + fresh, 10, now=NOW)),
    "fresh_verified": ids(choose(fresh_verified, 10, now=NOW)),
    "age_bound": ids(choose([inside, outside], 10, now=NOW)),
    "no_url": ids(choose([row(1, seen=NOW, url="   ")], 10, now=NOW)),
    "no_timestamp": ids(choose([row(1)], 10, now=NOW)),
    "unparseable": ids(choose([row(1, seen="not-a-timestamp")], 10, now=NOW)),
    "cap": len(choose([row(100 + i, seen=NOW - timedelta(hours=i % 24)) for i in range(40)], 10, now=NOW)),
    # Ordering is load-bearing INSIDE the window, not just at its edge: when there are more
    # eligible rows than the run wants, the freshest are the least likely to have died since the
    # observation, so they are the controls that actually test the transport rather than the
    # inventory. Ages deliberately spread across the bound; limit 3 of 5.
    "ranking": ids(choose([row(1, seen=NOW - timedelta(hours=40)),
                           row(2, seen=NOW - timedelta(hours=1)),
                           row(3, seen=NOW - timedelta(hours=20)),
                           row(4, seen=NOW - timedelta(hours=5)),
                           row(5, seen=NOW - timedelta(hours=10))], 3, now=NOW)),
    "age_hours": AGE,
    # The gate itself, executed. These are NOT mutated by anything above; they pin that this
    # repair did not relax the thresholds the canary feeds.
    "gate": {
        "all_controls_refused": canary_environment_ok(0, 10),
        "half_refused": canary_environment_ok(5, 10),
        "healthy": canary_environment_ok(6, 10),
        "empty_pool": canary_environment_ok(0, 0),
        "below_min_canaries": canary_environment_ok(4, 4),
    },
}

# Wiring, from the syntax tree: the fetch path must route through the pure selection, or the fix
# is decoration and the deadlock returns through the query.
tree = ast.parse(inspect.getsource(lv._collect_canaries))
out["collect_calls_choose"] = any(
    isinstance(n, ast.Call) and getattr(n.func, "id", None) == "choose_canaries"
    for n in ast.walk(tree))
tree2 = ast.parse(inspect.getsource(lv._run_canary))
out["run_canary_calls_collect"] = any(
    isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_collect_canaries"
    for n in ast.walk(tree2))

print(json.dumps(out))
`;

type Result = {
  production_deadlock?: number[];
  fresh_usable?: number[];
  prefers_fresh?: number[];
  fresh_verified?: number[];
  age_bound?: number[];
  no_url?: number[];
  no_timestamp?: number[];
  unparseable?: number[];
  cap?: number;
  ranking?: number[];
  age_hours?: number;
  gate?: Record<string, boolean>;
  collect_calls_choose?: boolean;
  run_canary_calls_collect?: boolean;
  error?: string;
};

const runHarness = (mutate?: [string, string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

// The law this barrier defends, as a set of named properties. A mutant that leaves ALL of them
// holding means the assertions below are blind and the barrier is asserting the bug.
const lawHolds = (r: Result): string[] => {
  const held: string[] = [];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (eq(r.production_deadlock, [])) held.push('production_deadlock');
  if ((r.fresh_usable ?? []).length === 10) held.push('fresh_usable');
  if ((r.prefers_fresh ?? []).length > 0 && (r.prefers_fresh ?? []).every((i) => i >= 100)) {
    held.push('prefers_fresh');
  }
  if ((r.fresh_verified ?? []).length === 10) held.push('fresh_verified');
  if (eq(r.age_bound, [1])) held.push('age_bound');
  if (eq(r.no_url, [])) held.push('no_url');
  if (eq(r.no_timestamp, [])) held.push('no_timestamp');
  if (eq(r.unparseable, [])) held.push('unparseable');
  if (r.cap === 10) held.push('cap');
  if (eq(r.ranking, [2, 4, 5])) held.push('ranking');
  return held;
};
const TOTAL = 10;

const base = runHarness();
check(!base.error, 'the shipped selection imports and runs', base.error ?? '');

check(JSON.stringify(base.production_deadlock) === '[]',
  'the exact production shape (every candidate 5 days stale) yields NO controls',
  'returned ' + JSON.stringify(base.production_deadlock) + ' — these ten rows were genuinely ' +
  'delisted, so probing them can only ever quarantine the run, forever');
check((base.fresh_usable ?? []).length === 10,
  'a row the crawl saw this morning IS a usable control (the self-reference is broken)',
  'returned ' + JSON.stringify(base.fresh_usable));
check((base.prefers_fresh ?? []).every((i) => i >= 100) && (base.prefers_fresh ?? []).length === 10,
  'given both, the freshest source observations are chosen',
  'returned ' + JSON.stringify(base.prefers_fresh));
check((base.fresh_verified ?? []).length === 10,
  'a FRESH verification stamp still counts — the stronger signal was not discarded',
  'returned ' + JSON.stringify(base.fresh_verified));
check(JSON.stringify(base.age_bound) === '[1]',
  'the age bound admits ' + (base.age_hours ?? '?') + 'h-old observations and rejects older ones',
  'returned ' + JSON.stringify(base.age_bound));
check(JSON.stringify(base.no_url) === '[]',
  'a row with no probeable URL is not a control, however fresh');
check(JSON.stringify(base.no_timestamp) === '[]',
  'a row the source was never observed serving is not a control');
check(JSON.stringify(base.unparseable) === '[]',
  'an unreadable timestamp is UNKNOWN — it must never default to "observed just now"',
  'returned ' + JSON.stringify(base.unparseable));
check(base.cap === 10, 'the pool is capped at the requested size', 'returned ' + String(base.cap));
check(JSON.stringify(base.ranking) === '[2,4,5]',
  'when more rows are eligible than the run wants, the FRESHEST are chosen, freshest-first',
  'returned ' + JSON.stringify(base.ranking) + ' — expected the 1h, 5h and 10h rows in that ' +
  'order; ranking oldest-first would hand the gate the controls closest to natural death');

// ── The gate is UNCHANGED. This is the half that proves the fix is not a loosening. ──────────
const gate = base.gate ?? {};
check(gate.all_controls_refused === false,
  'a FRESH control set that all-404s still QUARANTINES — a real block is still caught',
  'canary_environment_ok(0, 10) returned ' + String(gate.all_controls_refused) +
  ' — if this ever passes, the repair has become a bypass');
check(gate.half_refused === false,
  '50% of controls alive is still below the 60% floor -> quarantine');
check(gate.healthy === true,
  'a healthy environment still passes, so the sweep can actually do its job');
check(gate.empty_pool === false,
  'an EMPTY pool fails CLOSED: no control is not permission to remove anything');
check(gate.below_min_canaries === false,
  'fewer than MIN_CANARIES controls can never be enough, whatever their rate');

// ── Wiring: the pure selection must actually be on the path. ─────────────────────────────────
check(base.collect_calls_choose === true,
  '_collect_canaries routes through choose_canaries (else the deadlock returns via the query)',
  'no call to choose_canaries found in the syntax tree — this barrier would pass vacuously');
check(base.run_canary_calls_collect === true,
  '_run_canary still draws its controls from _collect_canaries');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect, re-introduced into the SHIPPED source and
// executed against the real production shape.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string, string]) => {
  const r = runHarness(mutate);
  if (r.error) { check(false, '(mutation) ' + what, r.error); return; }
  const held = lawHolds(r);
  check(held.length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every assertion above still passed with the defect present, so this ' +
    'barrier is asserting the bug rather than the rule');
};

// The original defect, verbatim: rank on the column only this sweep writes, so the control set is
// self-referential and a stalled sweep can never re-open the gate.
mustCatch('the control set becoming self-referential again (last_verified_alive_at only)',
  ['_observed_at', 'for col in ("last_seen_at", "last_verified_alive_at"):',
   'for col in ("last_verified_alive_at",):']);
// The other half of the same defect: no age bound, so five-day-old corpses are "controls".
mustCatch('a stale control being admitted (the age bound removed)',
  ['choose_canaries', 'if seen is None or seen < cutoff:', 'if seen is None:']);
// Ranking backwards picks the stalest rows — the deadlock with extra steps.
mustCatch('the pool being ranked oldest-first',
  ['choose_canaries', 'fresh.sort(key=lambda pair: pair[0], reverse=True)',
   'fresh.sort(key=lambda pair: pair[0])']);
// A control we cannot probe is not a control; counting it degrades the rate for no reason.
mustCatch('an unprobeable row being counted as a control',
  ['choose_canaries', 'if not (row.get("listing_url") or "").strip():', 'if False:']);
// The UNKNOWN direction: an unreadable timestamp must not read as "observed just now".
mustCatch('an unparseable timestamp being treated as a fresh observation',
  ['_observed_at', 'except ValueError:\n            continue',
   'except ValueError:\n            ts = datetime(2026, 9, 11, 14, 0, tzinfo=timezone.utc)']);
// And the opposite failure: a gate that admits everything cannot protect anything.
mustCatch('the age bound being widened until it admits the stale pool anyway',
  ['choose_canaries', 'cutoff = now - timedelta(hours=max_age_hours)',
   'cutoff = now - timedelta(days=3650)']);

console.log(failed === 0
  ? '\n✅ verify-gathern-canary-pool-cannot-deadlock: controls are fresh source observations; ' +
    'the gate still fails closed.'
  : '\n❌ verify-gathern-canary-pool-cannot-deadlock: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
