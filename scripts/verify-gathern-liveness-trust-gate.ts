// THE TRUST-GATE BARRIER (2026-09-03). A sweep that cannot be trusted may not kill.
//
// THE INCIDENT IT DEFENDS AGAINST, measured not hypothetical. gathern_liveness_detail alive-rate:
//   2026-08-23..08-31   66 74 79 72 77 72 76 84 62 %   (nine healthy days)
//   2026-09-01  3.8%   2026-09-02  0.7%   2026-09-03  0.5%
// The source began serving 404s to our egress. Every 404 in that window means "we were blocked",
// which docs/ops/LISTING_LIVENESS.md §1 rules UNKNOWN — never death. Consequences before the gate:
//   · 09-01: 302 rows inactivated   · 09-02: 106 rows inactivated (batch UNDER the anomaly cap)
//   · 09-03: 1,016-row batch — only then did the cap catch it.
//
// WHY THE ANOMALY CAP WAS NOT ENOUGH, and why this barrier is separate from it. The cap is a
// batch-SIZE guard: it asks "is this batch too big to believe?". It is structurally blind to a run
// whose every verdict is unreliable but whose batch happens to be small — which is exactly the
// 09-02 shape. The trust gate asks the other question: "is this RUN's evidence believable at all?"
// Both must exist. This file fails if either is weakened.
//
// WHAT IT MUST NEVER GATE: writes in the restorative direction. A block cannot manufacture a live
// 200, so refusing to record an alive row would turn a source outage into lost inventory. See
// docs/ops/DELETION_SAFETY.md §2.4 (reactivations are kept during an inconclusive freeze).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (...p: string[]) => {
  try { return readFileSync(join(ROOT, ...p), 'utf8'); } catch { return ''; }
};

const trust = read('scrapers', 'common', 'liveness_trust.py');
const sweep = read('scrapers', 'gathern', 'liveness.py');
const tests = read('scrapers', 'common', 'tests', 'test_liveness_trust_gate.py');
const workflow = read('.github', 'workflows', 'gathern-liveness.yml');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-gathern-liveness-trust-gate: a run that cannot be trusted may not kill.');

// ── Part 1: the shared predicate exists and fails CLOSED ────────────────────────────────────────
check('liveness_trust.py exists', trust.length > 0);
const rate = trust.match(/^MIN_ALIVE_RATE_FOR_TRUST\s*=\s*([0-9.]+)/m)?.[1];
const probes = trust.match(/^MIN_PROBES_FOR_TRUST\s*=\s*(\d+)/m)?.[1];
check('a positive alive-rate floor is declared', !!rate && Number(rate) > 0, `rate=${rate}`);
check('the floor sits above the incident (>0.05) and below a healthy run (<0.60)',
  !!rate && Number(rate) > 0.05 && Number(rate) < 0.60, `rate=${rate}`);
check('a minimum-probe floor is declared', !!probes && Number(probes) >= 1, `probes=${probes}`);
check('degenerate probe counts fail closed',
  /probe_count\s*<\s*min_probes\s*or\s*probe_count\s*<=\s*0/.test(trust));
check('the floor comparison is inclusive (>=), not a stricter/looser variant',
  /\)\s*>=\s*min_rate/.test(trust));

// ── Part 2: the gathern sweep actually CONSULTS it ──────────────────────────────────────────────
check('sweep imports the shared predicate',
  /from scrapers\.common\.liveness_trust import/.test(sweep) &&
  /environment_is_trustworthy/.test(sweep));
check('sweep computes trust from its own probes',
  /trusted\s*=\s*environment_is_trustworthy\(\s*alive\s*,\s*seen\s*\)/.test(sweep));

// ── Part 3: strikes are DEFERRED, so a whole run can be quarantined ─────────────────────────────
// The original bug: the strike write sat inside the probe loop, so by the time the run's alive-rate
// was known the strikes were already durable and could not be taken back.
check('a strike_pending buffer exists', /strike_pending\s*:\s*list/.test(sweep));
check('the strike branch defers instead of writing',
  /strike_pending\.append\(\(row\["id"\], new_missing\)\)/.test(sweep));
check('NO in-loop strike write survives (the exact 2026-09 regression)',
  !/client\.table\(TABLE\)\.update\(\{"missing_count":\s*new_missing\}\)/.test(sweep));

// ── Part 4: destructive writes are gated on trust; restorative ones are NOT ─────────────────────
check('destructive writes are gated behind `if args.apply and trusted:`',
  /if\s+args\.apply\s+and\s+trusted\s*:/.test(sweep));
check('the alive/restorative flush is NOT gated on trust',
  /def _flush_alive\(\)[\s\S]{0,200}?if args\.apply and alive_ids:/.test(sweep));
check('evidence rows record strikes of an untrusted run as not-applied',
  /e\["applied"\]\s*=\s*bool\(args\.apply\)\s*and\s*trusted/.test(sweep));

// ── Part 5: the anomaly cap is UNCHANGED and still enabled ──────────────────────────────────────
check('the anomaly cap still governs the kill batch',
  /anomaly\s*=\s*is_anomaly\(len\(kill_pending\), kill_cap\)/.test(sweep));
check('an over-cap batch still inactivates nothing',
  /if anomaly:/.test(sweep) && /def is_anomaly\(/.test(sweep));
check('the run is marked not-ok when either gate fires',
  /ok=not \(anomaly or trust_quarantine\)/.test(sweep));

// ── Part 6: the regression proof cannot be quietly deleted ──────────────────────────────────────
check('the trust-gate test file exists', tests.length > 0);
check('it pins the degraded incident days as quarantined',
  /DEGRADED_DAYS/.test(tests) && /not environment_is_trustworthy/.test(tests));
check('it pins healthy days as still trusted (the gate is not a blanket refusal)',
  /HEALTHY_DAYS/.test(tests) && /assert environment_is_trustworthy/.test(tests));
check('it pins the 09-02 under-the-cap batch specifically',
  /slipped_under_the_anomaly_cap/.test(tests));

// ── Part 7: the in-run positive control (canary), owner rule 2026-09-03 ─────────────────────────
// The aggregate rate is a LAGGING signal — on 2026-09-01 it only condemned the run after all 1,500
// probes, by which time 302 rows were inactivated. The canary asks the same question on ~10 probes,
// BEFORE the worklist is touched.
check('a canary predicate exists and fails closed',
  /def canary_environment_ok/.test(trust) &&
  /probe_count\s*<\s*min_canaries\s*or\s*probe_count\s*<=\s*0/.test(trust));
check('the canary needs a real control set (>=2) and a majority alive (>0.5)',
  Number(trust.match(/^MIN_CANARIES\s*=\s*(\d+)/m)?.[1]) >= 2 &&
  Number(trust.match(/^MIN_CANARY_ALIVE_RATE\s*=\s*([0-9.]+)/m)?.[1]) > 0.5);
check('controls are drawn from source-proven liveness, not our own guess',
  /last_verified_alive_at/.test(sweep) && /def _collect_canaries/.test(sweep));
// Scoped to the MAIN sweep, not the whole file. `_run_canary(` also appears in _recheck_dead,
// which is defined EARLIER — so a naive indexOf finds that one and the ordering assertion passes
// even when main()'s canary has been moved after the probe loop. Slice from the main worklist
// onward and ask the question there. (Both of these initially SURVIVED their mutation and forced
// this sharpening; a check that green-lights the bug it exists to catch is worse than none.)
const mainSweep = sweep.slice(sweep.indexOf('work = _collect_stale(client, cutoff, args.limit)'));
const mainCanaryIdx = mainSweep.indexOf('_run_canary(s, client, args.canaries)');
check('the canary runs BEFORE the worklist is probed (in main, not just in recheck)',
  mainCanaryIdx !== -1 && mainCanaryIdx < mainSweep.indexOf('for row in work:'));
check('a failed canary quarantines the MAIN sweep (0 strikes, 0 inactivations)',
  /CANARY-QUARANTINED \{mode\}/.test(sweep) &&
  /if not c_ok:[\s\S]{0,900}?end_run\([^)]*ok=False/.test(sweep));
check('the resurrection pass is canary-gated too (a blocked run must not log dead_confirmed)',
  /CANARY-QUARANTINED recheck-dead/.test(sweep));

// ── Part 8: the shared-proxy path is explicit, never inherited, and always counted ───────────────
// scrapers/jazwtn/run.py records the standing rule: WASALT_PROXY_URL is metered, provisioned for
// wasalt, and must never be silently inherited. mon_detect_proxy_contention() is the pool's only
// guard and its own comment requires every consumer to be added to its predicate.
check('the proxy is read ONLY behind an explicit flag',
  /def proxied_session\(use_proxy/.test(sweep) &&
  /if not use_proxy:\s*\n\s*return s/.test(sweep));
check('an empty proxy URL with --proxy fails CLOSED (never falls back to datacenter egress)',
  /--proxy was requested but WASALT_PROXY_URL is empty/.test(sweep));
check('a proxied run reports under its own pool-visible label',
  /RUN_NAME_PROXY\s*=\s*["']gathern_liveness_proxy["']/.test(sweep) &&
  /platform\s*=\s*RUN_NAME_PROXY if args\.proxy else RUN_NAME/.test(sweep));
check('the schedule does NOT silently acquire the metered proxy',
  /github\.event_name\s*!=\s*'schedule'\s*&&\s*inputs\.proxy/.test(workflow));
check('the workflow passes the canary count through',
  /--canaries \$\{\{ inputs\.canaries \|\| '10' \}\}/.test(workflow));

console.log(failures === 0
  ? '\n✅ trust gate intact: untrustworthy runs cannot strike, kill, or delete.'
  : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
