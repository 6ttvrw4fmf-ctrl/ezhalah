// A WASALT KILL MUST BE PROVABLE IN THE FLEET-WIDE LEDGER, NOT ONLY IN WASALT'S OWN TABLE.
//
// WHAT THIS GUARDS (measured 2026-09-06)
// --------------------------------------
// wasalt is the only DIRECT_REVISIT platform whose sweep is its own code rather than
// `db.prune_unseen`, and it recorded every per-row decision into a PRIVATE table,
// `wasalt_liveness_pilot_detail`. Nothing outside scrapers/wasalt/liveness.py reads that table.
// On 2026-09-06 both of these were true at the same moment:
//
//   · 678 of 678 rows wasalt deactivated that day had a same-day DIRECT `dead` verdict recorded;
//   · `ops_stale_inactivation_probe` held ZERO wasalt rows ALL-TIME, and
//     mon_detect_deletion_clock_without_evidence reported 7,559 wasalt rows as having "NOTHING in
//     the database recording a source verdict".
//
// The kills were evidenced. The evidence was invisible. That is the defect: an auditor who cannot
// see the evidence has to re-probe the source, and wasalt needs the Saudi residential proxy — so
// from any other egress the only honest answer to "was that kill correct?" was "unknown". Evidence
// nobody can reach is not far from evidence that does not exist.
//
// THE RULE THIS PINS: every decision wasalt's confirm step makes is mirrored into
// `ops_stale_inactivation_probe`, in the shape the DETECTOR actually joins on — `source_table` +
// `ad_number` + `verdict` — and a `failed` read is UNKNOWN there, never GONE.
//
// WHY EXECUTED, NOT GREPPED. AGENTS.md: every one of the five defects of 2026-09-04 had a barrier
// over the exact line, and every one was a source-TEXT tripwire that stayed green while the defect
// was live. So this imports the real module, replaces only its `db` seam with a recording stub, and
// runs the real `_flush_detail` against real row shapes. What it asserts is what the function did.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + (ok || !detail ? '' : ' — ' + detail));
  if (!ok) failed++;
};

console.log('verify-wasalt-kills-are-auditable-fleet-wide: the mirror, executed against a stub client.');

const HARNESS = String.raw`
import json, os, sys, textwrap, inspect
sys.path.insert(0, os.getcwd())
import scrapers.wasalt.liveness as W

MUT = json.loads(os.environ["MUTATE"]) if os.environ.get("MUTATE") else None
if MUT:
    find, repl = MUT
    src = textwrap.dedent(inspect.getsource(W._mirror_probe_evidence))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    # Compile INTO the module's own namespace, not a dict() copy of it. A copy is snapshotted
    # before run() installs the stub client, so the mutant would resolve the REAL db module and
    # write nowhere - making every mutation "caught" for the wrong reason and the control fail.
    # That is exactly what happened on the first draft of this file, and the control caught it.
    # (No backticks anywhere in this harness: it is a String.raw template literal.)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), W.__dict__)

# ── the stub client: records every insert, answers identity lookups from a fixture ───────────────
IDENT = {
    101: {"id": 101, "ad_number": "WS-AAA", "listing_url": "https://wasalt.com/x/101"},
    102: {"id": 102, "ad_number": "WS-BBB", "listing_url": "https://wasalt.com/x/102"},
    103: {"id": 103, "ad_number": "WS-CCC", "listing_url": "https://wasalt.com/x/103"},
    # 104 exists in the sweep but has NO ad_number — it must not produce an unjoinable ledger row.
    104: {"id": 104, "ad_number": None, "listing_url": ""},
    # 105 carries a verdict string the ledger vocabulary does not know. The DEFAULT decides its
    # fate, and an untested default is how "unrecognised" quietly becomes "confirmed dead".
    105: {"id": 105, "ad_number": "WS-EEE", "listing_url": "https://wasalt.com/x/105"},
}

class Res:
    def __init__(self, data): self.data = data

class Q:
    def __init__(self, tbl, sink, mode="ident"):
        self.tbl, self.sink, self.mode, self.ids, self.payload = tbl, sink, mode, [], None
    def select(self, *a, **k): return self
    def in_(self, col, ids): self.ids = list(ids); return self
    def insert(self, payload):
        self.mode = "insert"; self.payload = payload; return self

class SB:
    def __init__(self, sink): self.sink = sink
    def table(self, name): return Q(name, self.sink)

class StubDB:
    def __init__(self, fail_ident=False, fail_insert=False):
        self.inserts, self.fail_ident, self.fail_insert = [], fail_ident, fail_insert
    def sb(self): return SB(self)
    def _execute(self, q, what=""):
        if q.mode == "insert":
            if self.fail_insert: raise RuntimeError("insert boom")
            self.inserts.append({"table": q.tbl, "rows": q.payload})
            return Res(q.payload)
        if self.fail_ident: raise RuntimeError("ident boom")
        return Res([IDENT[i] for i in q.ids if i in IDENT])

def run(rows, **kw):
    stub = StubDB(**kw)
    real = W.db
    W.db = stub
    try:
        W._flush_detail(rows)
    finally:
        W.db = real
    return stub

def ledger(stub):
    out = []
    for ins in stub.inserts:
        if ins["table"] == "ops_stale_inactivation_probe":
            out.extend(ins["rows"])
    return out

def private(stub):
    return [r for ins in stub.inserts if ins["table"] == "wasalt_liveness_pilot_detail" for r in ins["rows"]]

R = lambda lid, v, gs=200: {"tbl": "wasalt_residential_listings", "listing_id": lid,
                            "head_status": gs, "get_status": gs, "get_verdict": v,
                            "nbytes": 1234, "has_property_details": v == "live"}

out = {}

# 1. The three verdicts, through the real function.
s = run([R(101, "dead"), R(102, "live"), R(103, "failed"), R(105, "blocked_by_proxy")])
led = {r["ad_number"]: r for r in ledger(s)}
out["dead_is_GONE"]     = led.get("WS-AAA", {}).get("verdict")
out["live_is_LIVE"]     = led.get("WS-BBB", {}).get("verdict")
out["failed_is_UNKNOWN"] = led.get("WS-CCC", {}).get("verdict")
# A verdict string this vocabulary has never seen must default to UNKNOWN. check_hybrid could grow
# a fourth value tomorrow (a proxy-block state, say); whichever way the default falls decides
# whether that becomes evidence for a kill.
out["unrecognised_is_UNKNOWN"] = led.get("WS-EEE", {}).get("verdict")
out["keyed_on_ad_number"] = sorted(led)
out["source_table_set"]  = sorted({r.get("source_table") for r in ledger(s)})
out["carries_listing_id"] = all(r.get("listing_id") for r in ledger(s))
out["oracle_named"]      = sorted({r.get("oracle") for r in ledger(s)})
out["note_nonempty"]     = all((r.get("note") or "").strip() for r in ledger(s))

# 2. The private table is still written — the mirror is ADDITIVE, never a replacement.
out["private_still_written"] = len(private(s))

# 3. A row whose ad_number cannot be resolved writes NOTHING to the ledger. A probe row under the
#    wrong (or a null) key is worse than none: it reads as evidence about some other listing.
s2 = run([R(104, "dead")])
out["unresolvable_writes_nothing"] = len(ledger(s2))
out["unresolvable_still_private"]  = len(private(s2))

# 4. Failure paths: neither an identity-lookup failure nor an insert failure may raise, and neither
#    may invent a ledger row. Monitoring must never break the lifecycle it observes.
try:
    s3 = run([R(101, "dead")], fail_ident=True)
    out["ident_failure_raises"] = False
    out["ident_failure_wrote"]  = len(ledger(s3))
except Exception as e:
    out["ident_failure_raises"] = True; out["ident_failure_wrote"] = -1
try:
    s4 = run([R(101, "dead")], fail_insert=True)
    out["insert_failure_raises"] = False
except Exception:
    out["insert_failure_raises"] = True

# 5. Empty input is a no-op, not a crash.
try:
    run([]); out["empty_ok"] = True
except Exception:
    out["empty_ok"] = False

print(json.dumps(out))
`;

type Row = Record<string, unknown>;
const run = (mutate?: [string, string]): Row => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Row;
};

// The judgement, as independent facts. A mutation must SHRINK this set.
const holds = (r: Row): string[] => {
  const h: string[] = [];
  if (r.dead_is_GONE === 'GONE') h.push('dead-is-gone');
  if (r.live_is_LIVE === 'LIVE') h.push('live-is-live');
  if (r.failed_is_UNKNOWN === 'UNKNOWN') h.push('failed-is-unknown');
  if (JSON.stringify(r.keyed_on_ad_number) === JSON.stringify(['WS-AAA', 'WS-BBB', 'WS-CCC', 'WS-EEE']))
    h.push('keyed-on-ad-number');
  if (r.unrecognised_is_UNKNOWN === 'UNKNOWN') h.push('unrecognised-is-unknown');
  if (JSON.stringify(r.source_table_set) === JSON.stringify(['wasalt_residential_listings']))
    h.push('source-table-set');
  if (r.carries_listing_id === true) h.push('carries-listing-id');
  if (r.note_nonempty === true) h.push('note-nonempty');
  if (r.private_still_written === 4) h.push('private-still-written');
  if (r.unresolvable_writes_nothing === 0) h.push('unresolvable-writes-nothing');
  if (r.unresolvable_still_private === 1) h.push('unresolvable-still-private');
  if (r.ident_failure_raises === false && r.ident_failure_wrote === 0) h.push('ident-failure-safe');
  if (r.insert_failure_raises === false) h.push('insert-failure-safe');
  if (r.empty_ok === true) h.push('empty-ok');
  return h;
};

const base = run();
check(!base.error, 'the module imports and the mirror runs', String(base.error ?? ''));
if (base.error) { console.log('\n❌ harness failed.'); process.exit(1); }

check(base.dead_is_GONE === 'GONE',
  'a DEAD read is written to the fleet ledger as GONE', String(base.dead_is_GONE));
check(base.live_is_LIVE === 'LIVE',
  'a LIVE read is written as LIVE — the ledger records proof of life, not only removals',
  String(base.live_is_LIVE));
check(base.failed_is_UNKNOWN === 'UNKNOWN',
  'a FAILED read is UNKNOWN in the ledger, never GONE',
  `returned ${JSON.stringify(base.failed_is_UNKNOWN)} — a read that failed is a statement about us, ` +
  'and writing it as GONE would manufacture evidence for a kill nothing confirmed');
check(base.unrecognised_is_UNKNOWN === 'UNKNOWN',
  'a verdict string the ledger vocabulary does not know defaults to UNKNOWN, never GONE',
  `returned ${JSON.stringify(base.unrecognised_is_UNKNOWN)} — check_hybrid can grow a fourth ` +
  'verdict (a proxy-block state, say); the default decides whether that becomes kill evidence');
check(JSON.stringify(base.keyed_on_ad_number) === JSON.stringify(['WS-AAA', 'WS-BBB', 'WS-CCC', 'WS-EEE']),
  'rows are keyed on the REAL ad_number resolved from the table',
  `got ${JSON.stringify(base.keyed_on_ad_number)} — mon_detect_deletion_clock_without_evidence ` +
  'joins on source_table + ad_number, so a row keyed any other way is invisible to it');
check(base.carries_listing_id === true, 'each row also carries its listing_id');
check(JSON.stringify(base.oracle_named) === JSON.stringify(['wasalt.liveness.check_hybrid']),
  'each row names the oracle that produced it', JSON.stringify(base.oracle_named));
check(base.note_nonempty === true,
  'each row carries a WHY, not just a verdict',
  'ops_incident #84: recording only the verdict makes a kill unfalsifiable from the record');
check(base.private_still_written === 4,
  'the private detail table is STILL written — the mirror is additive, not a replacement',
  'wasalt-specific fields (head vs get, property-details presence) have no column in the shared ledger');
check(base.unresolvable_writes_nothing === 0,
  'a row whose ad_number cannot be resolved writes NOTHING to the ledger',
  'a probe row under a null or wrong key is worse than none: it reads as evidence about another listing');
check(base.unresolvable_still_private === 1,
  '…while its private detail row is still kept, so the decision is not lost');
check(base.ident_failure_raises === false && base.ident_failure_wrote === 0,
  'an identity-lookup failure neither raises nor invents a ledger row',
  'monitoring must never fail the lifecycle it observes, and must never guess a key');
check(base.insert_failure_raises === false,
  'a ledger insert failure never breaks the sweep');
check(base.empty_ok === true, 'an empty batch is a no-op');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — real ways this mirror could start lying, executed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const TOTAL = holds(base).length;
const mustCatch = (what: string, mutate: [string, string]) => {
  const r = run(mutate);
  if (r.error) { check(false, '(mutation) ' + what, String(r.error)); return; }
  check(holds(r).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every assertion above still held with the defect present');
};

// THE one that matters most: a read that FAILED recorded as a confirmed removal. That would let a
// proxy outage write 'GONE' evidence for thousands of live listings — manufacturing exactly the
// proof the deletion gate looks for.
mustCatch('a failed read being recorded as a confirmed removal',
  ['"verdict": _LEDGER_VERDICT.get(r.get("get_verdict"), "UNKNOWN"),',
   '"verdict": "GONE",']);
// Defaulting an unrecognised verdict to GONE instead of UNKNOWN — the same defect, subtler.
mustCatch('an unrecognised verdict defaulting to GONE',
  ['_LEDGER_VERDICT.get(r.get("get_verdict"), "UNKNOWN")',
   '_LEDGER_VERDICT.get(r.get("get_verdict"), "GONE")']);
// Writing a row with no resolvable ad_number: unjoinable at best, misattributed at worst.
mustCatch('writing a ledger row for a listing whose ad_number could not be resolved',
  ['            if not who or not who.get("ad_number"):\n                continue',
   '            if False:\n                continue']);
// Keying the ledger on something the detector does not join on.
mustCatch('keying the ledger row on the listing_id instead of the ad_number',
  ['"ad_number": who["ad_number"],', '"ad_number": str(r["listing_id"]),']);
// Losing the source_table, which is half the detector's join.
mustCatch('dropping the source_table from the ledger row',
  ['"source_table": tbl,', '"source_table": None,']);
// A verdict with no reason — ops_incident #84's lesson.
mustCatch('recording a verdict with no reason attached',
  ['                "note": (f"head={r.get(\'head_status\')} get={r.get(\'get_status\')} "',
   '                "note": ("" and f"head={r.get(\'head_status\')} get={r.get(\'get_status\')} "']);
// An identity-lookup failure guessing a key rather than skipping.
mustCatch('an identity-lookup failure being swallowed into a guessed key',
  ['            continue\n', '            ident = {i: {"id": i, "ad_number": "GUESS"} for i in ids}\n']);

// CONTROL — the judgement is not always-red.
const control = run(['"oracle": "wasalt.liveness.check_hybrid",',
                     '"oracle": "wasalt.liveness.check_hybrid",  # same value, moved comment']);
check(holds(control).length === TOTAL,
  '(control) an irrelevant edit does NOT trip the judgement',
  'the rules go red on any change at all, so their red would carry no information');

console.log(failed === 0
  ? '\n✅ verify-wasalt-kills-are-auditable-fleet-wide: every wasalt decision lands in the shared ledger, and a failed read is never a removal.'
  : '\n❌ verify-wasalt-kills-are-auditable-fleet-wide: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
