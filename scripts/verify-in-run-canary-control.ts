// THE IN-RUN POSITIVE CONTROL — executed, including every way it must FAIL CLOSED.
//
// WHAT THIS GUARDS
// ----------------
// docs/ops/LISTING_LIVENESS.md §5.4 named this instrument and recorded that it did not exist. It
// exists now (scrapers/common/liveness_canary.py) and raghdan + sanadak both gate their death
// verdicts on it, so its failure modes are now load-bearing on whether live listings survive.
//
// The measured incident it answers: gathern's oracle alive-rate fell 75% -> 0.5% over three days
// because the SOURCE began serving 404s to our egress. 302 rows were inactivated on 09-01 and 106
// more on 09-02 before the batch-size cap finally tripped on 09-03. A size cap asks "is this batch
// too big to believe?"; it cannot ask "is this run's evidence worth anything?". The canary asks the
// second question, FIRST, against listings the source served us minutes earlier.
//
// THE ONE-WAY PROPERTY THIS DEPENDS ON. A blocked environment can manufacture a 404 or an empty
// shell; it cannot manufacture a live listing page. So canaries coming back ALIVE is evidence the
// environment is honest. That asymmetry is why `ok() == false` must never be read as "the listings
// are dead" — it means the run learned nothing it may act on.
//
// Everything below EXECUTES the real class against injected probes. Per AGENTS.md, a source-TEXT
// barrier over this file would pass for the entire time a fail-open bug was live.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-in-run-canary-control: an unproven environment may not kill.');

const HARNESS = String.raw`
import json, os, sys
sys.path.insert(0, os.getcwd())
from scrapers.common.liveness_canary import InRunCanary
from scrapers.common.liveness_trust import MIN_CANARIES, MIN_CANARY_ALIVE_RATE

def build(alive_for, n_candidates, sample=None, raises=()):
    calls = []
    def probe(ad):
        calls.append(ad)
        if ad in raises: raise RuntimeError("probe exploded")
        return ad in alive_for
    kw = {"label": "t"}
    if sample is not None: kw["sample"] = sample
    c = InRunCanary(probe, **kw)
    c.offer("ad%02d" % i for i in range(n_candidates))
    return c, calls

ALL = {"ad%02d" % i for i in range(100)}
out = {}

# All canaries alive -> trusted.
c, _ = build(ALL, 50);                    out["all_alive"] = c.ok()
# All canaries dead (the gathern block) -> NOT trusted.
c, _ = build(set(), 50);                  out["all_dead"] = c.ok()
# One honest death among five must NOT wedge the sweep shut (majority, not unanimity).
c, calls = build(ALL, 50, sample=5)
c._probe = None  # ensure ok() below uses the cached result, not a re-probe
out["majority_ok"] = c.ok()
# Exactly at the floor and just under it.
def rate_case(alive_n, sample):
    picked = []
    def probe(ad):
        picked.append(ad); return len(picked) <= alive_n
    c = InRunCanary(probe, label="t", sample=sample)
    c.offer("ad%02d" % i for i in range(100))
    return c.ok()
out["rate_3_of_5_is_60pct"] = rate_case(3, 5)   # 0.60 >= 0.60 -> trusted
out["rate_2_of_5_is_40pct"] = rate_case(2, 5)   # 0.40 <  0.60 -> refused
# Too few candidates to assemble a control set -> FAIL CLOSED.
c, _ = build(ALL, MIN_CANARIES - 1);      out["too_few_candidates"] = c.ok()
c, _ = build(ALL, 0);                     out["no_candidates"] = c.ok()
# A probe that RAISES is not a live canary.
c, _ = build(ALL, 50, sample=5, raises={"ad%02d" % i for i in range(100)})
out["probe_raises"] = c.ok()
# The verdict is cached: probing must happen once, not per row.
calls_seen = []
def probe2(ad):
    calls_seen.append(ad); return True
c = InRunCanary(probe2, label="t", sample=5)
c.offer("ad%02d" % i for i in range(50))
[c.ok() for _ in range(10)]
out["probe_calls_when_asked_10x"] = len(calls_seen)
# A later offer() must not be able to rewrite a decision already made.
c = InRunCanary(lambda a: False, label="t", sample=5)
c.offer("ad%02d" % i for i in range(50))
first = c.ok()
n_before = len(c._candidates)
c.offer(["fresh%d" % i for i in range(50)])
# ok() is cached, so observing the VERDICT cannot detect the guard. Observe the control SET.
out["decision_is_immutable"] = (first is False and len(c._candidates) == n_before)
# The sample must be SPREAD, not a contiguous head (a head is often one city/shard).
picked = []
c = InRunCanary(lambda a: picked.append(a) or True, label="t", sample=5)
c.offer("ad%02d" % i for i in range(100))
c.ok()
out["spread_not_head"] = picked != ["ad%02d" % i for i in range(5)]
out["spread_sample"] = picked
# sample can never be lowered below the policy minimum.
c, _ = build(ALL, 50, sample=1)
out["sample_floor_enforced"] = len(c._candidates) >= MIN_CANARIES and c._sample >= MIN_CANARIES
out["MIN_CANARIES"] = MIN_CANARIES
out["MIN_CANARY_ALIVE_RATE"] = MIN_CANARY_ALIVE_RATE
print(json.dumps(out))
`;

const run = (): Record<string, unknown> =>
  JSON.parse(execFileSync('python3', ['-c', HARNESS], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').pop() as string);

const r = run();

// ── The load-bearing direction: it must REFUSE, not permit ──────────────────────────────────────
check(r.all_dead === false, 'canaries all dead ⇒ NOT trusted (the gathern block)',
  'the control passed while the source was refusing us — this is the 302-row incident');
check(r.too_few_candidates === false, 'too few candidates ⇒ FAIL CLOSED',
  'a run that cannot assemble a control set has not proven its environment');
check(r.no_candidates === false, 'zero candidates ⇒ FAIL CLOSED');
check(r.probe_raises === false, 'a probe that RAISES is not a live canary',
  'an exception counted as alive would make a broken probe look like a healthy source');
check(r.rate_2_of_5_is_40pct === false, '40% alive is under the 60% floor ⇒ refused');

// ── The permitting direction: it must not be so strict it can never pass ────────────────────────
check(r.all_alive === true, 'canaries all alive ⇒ trusted');
check(r.rate_3_of_5_is_60pct === true, '60% alive meets the floor ⇒ trusted',
  'sized as a MAJORITY on purpose — demanding unanimity would let one honest delisting wedge the ' +
  'sweep shut forever, and a permanently-stuck sweep is its own failure');

// ── Properties that keep it honest and cheap ────────────────────────────────────────────────────
check(r.probe_calls_when_asked_10x === 5,
  'the control is evaluated ONCE per run and cached',
  `probed ${r.probe_calls_when_asked_10x} times across 10 calls — re-probing per row would ` +
  'multiply the run\'s fetches and let the verdict drift mid-run');
check(r.decision_is_immutable === true,
  'a later offer() cannot rewrite a decision already made');
check(r.spread_not_head === true,
  'the sample is SPREAD across the catalogue, not a contiguous head',
  `picked ${JSON.stringify(r.spread_sample)} — a head is often one city or shard, so the control ` +
  'would be agreeing with itself');
check(r.sample_floor_enforced === true,
  'a caller cannot lower the sample below the policy minimum');
check(r.MIN_CANARIES === 5 && r.MIN_CANARY_ALIVE_RATE === 0.6,
  'the constants are the already-approved ones from liveness_trust.py',
  `got ${r.MIN_CANARIES}/${r.MIN_CANARY_ALIVE_RATE} — this barrier exists partly so a threshold ` +
  'cannot be quietly relaxed to make a blocked run go green (LISTING_LIVENESS.md §7)');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — the defects re-introduced into the real module and executed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// `file` selects which module the defect is re-introduced into: the control class itself, or the
// shared predicate underneath it. Both are on the path a death verdict travels.
const mutate = (find: string, repl: string, file = 'scrapers/common/liveness_canary.py'):
    Record<string, unknown> | null => {
  const patchTrust = file.endsWith('liveness_trust.py');
  const H = HARNESS.replace(
    'from scrapers.common.liveness_canary import InRunCanary',
    `import types as _t, pathlib as _p, sys as _s
_src = _p.Path(${JSON.stringify(file)}).read_text()
assert ${JSON.stringify(find)} in _src, "mutation target missing in " + ${JSON.stringify(file)}
_m = _t.ModuleType("mut")
exec(compile(_src.replace(${JSON.stringify(find)}, ${JSON.stringify(repl)}), "<mut>", "exec"), _m.__dict__)
${patchTrust
  ? `_s.modules["scrapers.common.liveness_trust"] = _m
from scrapers.common.liveness_canary import InRunCanary
InRunCanary.__init__.__globals__["canary_environment_ok"] = _m.canary_environment_ok`
  : `InRunCanary = _m.InRunCanary`}`);
  try {
    return JSON.parse(execFileSync('python3', ['-c', H], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').pop() as string);
  } catch { return null; }
};

const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — an assertion above is blind to the defect it exists to catch');

// DEFENCE IN DEPTH, asserted rather than assumed. "Too few canaries" is guarded TWICE — once by
// the class's own early return and again by canary_environment_ok's min_canaries floor. Deleting
// the class guard must therefore still fail closed. This is not a mutation that "survived": it is
// the property that a single edit cannot open this door, and it only counts because it is executed.
check((() => { const m = mutate('        if n < self._sample:', '        if False:');
  return m !== null && m.too_few_candidates === false; })(),
  'deleting the class-level too-few guard STILL fails closed (the shared floor catches it)',
  'the two guards collapsed into one — a single edit can now permit a kill on an unproven run');

// The rate comparison IS a single point of failure, and this is what breaks it open.
mustCatch('the trust floor short-circuited to always-trusted',
  (() => { const m = mutate('    return (alive_count / probe_count) >= min_rate',
                            '    return True',
                            'scrapers/common/liveness_trust.py');
    return m !== null && m.all_dead === true; })());

// Relaxing the floor to zero — the "make the blocked run go green" edit LISTING_LIVENESS.md §7 forbids.
mustCatch('the canary alive-rate floor relaxed to zero',
  (() => { const m = mutate('        self._min_rate = min_rate', '        self._min_rate = 0.0');
    return m !== null && m.all_dead === true; })());

// A probe that throws being counted as a healthy canary.
mustCatch('an exploding probe counted as an alive canary',
  (() => { const m = mutate('            except Exception:  # noqa: BLE001 — a probe that throws is NOT a live canary\n                pass',
                            '            except Exception:  # noqa: BLE001\n                alive += 1');
    return m !== null && m.probe_raises === true; })());

// The result silently re-evaluated per call instead of cached.
mustCatch('the verdict being re-probed on every call instead of cached',
  (() => { const m = mutate('        if self._result is not None:\n            return self._result\n\n        # Spread',
                            '        if False:\n            return self._result\n\n        # Spread');
    return m !== null && m.probe_calls_when_asked_10x !== 5; })());

// The sample collapsing to a contiguous head.
mustCatch('the sample collapsing to a contiguous head of the catalogue',
  (() => { const m = mutate('        picked = self._candidates[::step][: self._sample]',
                            '        picked = self._candidates[: self._sample]');
    return m !== null && m.spread_not_head === false; })());

// A later offer() rewriting a decision already made.
mustCatch('a post-decision offer() rewriting the control set',
  (() => { const m = mutate('        if self._result is not None:      # already decided; a later offer must not change history\n            return',
                            '        if False:\n            return');
    return m !== null && m.decision_is_immutable === false; })());

console.log(failed === 0
  ? '\n✅ verify-in-run-canary-control: the control fails closed, caches once, and cannot be relaxed.'
  : `\n❌ verify-in-run-canary-control: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
