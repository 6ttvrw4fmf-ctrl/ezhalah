// THE LIVENESS BARRIER (owner rule, 2026-08-30). Makes the platform-wide contract un-removable.
//
// THE PERMANENT RULE IT DEFENDS:
//   `active = true` must mean we have reasonable RECENT EVIDENCE that a listing is live — not
//   merely that nobody has yet proved it dead.
//
// WHY A BARRIER AND NOT JUST TESTS. Every failure this contract exists to prevent was silent and
// was found by hand, months late:
//   · aqar reported soft-closed ads healthy for weeks (13,139 retired in one day once fixed);
//   · 26 of 29 platforms inferred liveness purely from crawl presence — the question was never
//     asked at onboarding, so nobody had decided it;
//   · gathern's 19.5-day coverage cycle left ~1,260 confirmed-dead listings searchable;
//   · dealapp serves an identical 200 shell for a real id AND a bogus one.
// None of those tripped a test, because the tests asserted implementations. This asserts the RULE.
//
// SPLIT BY CAPABILITY, SO NEITHER HALF IS WEAKENED. The mutation proof needs to run pytest against
// a deliberately broken contract; `npm test` has no Python toolchain, so hosting it here could
// only fail closed (permanently red) or skip (vacuous — worse than nothing). It therefore lives in
// scrapers/common/tests/test_liveness_contract_mutations.py, which runs in common-location-tests.yml
// where pytest is installed. THIS file keeps the pure-JS half and — critically — asserts that the
// mutation proof still exists and still covers every protection, so it cannot be quietly deleted
// to make something green.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const contract = readFileSync(join(ROOT, 'scrapers', 'common', 'liveness_contract.py'), 'utf8');
const policiesSrc = readFileSync(join(ROOT, 'scrapers', 'common', 'liveness_policies.py'), 'utf8');
const mutationProof = (() => {
  try {
    return readFileSync(join(ROOT, 'scrapers', 'common', 'tests', 'test_liveness_contract_mutations.py'), 'utf8');
  } catch {
    return '';
  }
})();

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-liveness-contract: active=true must mean verified-alive, not un-disproven.');

// ── Part 1: the contract's load-bearing rules are still present in the source ───────────────────
// Static assertions only. They cannot replace the mutation proof (they check presence, not
// behaviour) — which is exactly why Part 3 requires that proof to exist and stay complete.
const RULES: Array<[string, RegExp]> = [
  ['a network failure maps to UNKNOWN', /if status is None:\s*\n\s*return UNKNOWN/],
  ['blocked/throttled statuses map to UNKNOWN', /if status in _BLOCKED_OR_THROTTLED:\s*\n\s*return UNKNOWN/],
  ['5xx maps to UNKNOWN', /if 500 <= status <= 599:\s*\n\s*return UNKNOWN/],
  ['403 and 429 are in the blocked set', /_BLOCKED_OR_THROTTLED[^\n]*=[\s\S]{0,120}?403[\s\S]{0,40}?429/],
  ['an unrecognised 200 is UNKNOWN, not ALIVE', /if alive_marker is not None and not alive_marker\(body\):\s*\n\s*return UNKNOWN/],
  ['absence evidence is refused as a death', /if evidence is EvidenceKind\.ABSENCE:/],
  ['UNKNOWN neither strikes nor deactivates', /if verdict == UNKNOWN:\s*\n\s*return Decision\(action="none"/],
  ['deactivation is gated on the grace window', /if new_strikes >= policy\.grace:/],
  ['ALIVE resets strikes and records verification', /action="reset"[\s\S]{0,80}?verified_alive=True/],
  ['a policy cannot opt out of the absence rule', /if not self\.absence_is_candidate_only:\s*\n\s*raise ValueError/],
  ['grace below 1 is rejected', /if self\.grace < 1:\s*\n\s*raise ValueError/],
  ['never-verified counts as stale', /if hours_since_verified is None:\s*\n\s*return True/],
  ['verification is stamped only on ALIVE evidence', /if decision\.verified_alive else \{\}/],
  ['crawler presence stamps verification only when explicitly declared', /if policy\.presence_is_positive_evidence else \{\}/],
];
for (const [name, re] of RULES) check(name, re.test(contract));

// ── Part 2: registry completeness — no production platform without a declared strategy ─────────
const declared = new Set([...policiesSrc.matchAll(/"([a-z0-9_]+)":\s*_P\(/g)].map((m) => m[1]));
for (const m of policiesSrc.matchAll(/for p in \(([\s\S]*?)\)\n/g)) {
  for (const q of m[1].matchAll(/"([a-z0-9_]+)"/g)) declared.add(q[1]);
}
const exempt = new Set(
  [...(/NOT_PRODUCTION_SEARCHABLE = frozenset\(\{([\s\S]*?)\}\)/.exec(policiesSrc)?.[1] ?? '')
    .matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]),
);
const scraperDirs = readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true })
  // `.` prefix excludes local, gitignored tooling directories (`scrapers/.venv` is in
  // scrapers/.gitignore). Those are never a platform — no platform name can start with a dot — so
  // this cannot hide a real unregistered scraper, and without it any developer who creates a
  // virtualenv turns this barrier red for a reason that does not exist in CI. A liveness barrier
  // that is red on every laptop is one people learn to skip.
  .filter((d) => d.isDirectory() && !d.name.startsWith('__') && !d.name.startsWith('.') && d.name !== 'tests')
  .map((d) => d.name);

const missing = scraperDirs.filter((p) => !declared.has(p) && !exempt.has(p));
check('every production-searchable platform has a registered liveness policy', missing.length === 0,
  missing.length
    ? `NO POLICY: ${missing.join(', ')} — register it in scrapers/common/liveness_policies.py before ` +
      'the platform becomes production-searchable, or add it to NOT_PRODUCTION_SEARCHABLE'
    : `${declared.size} platforms declared, ${exempt.size} exempt`);

const both = [...declared].filter((p) => exempt.has(p));
check('no platform is both declared and exempt', both.length === 0, both.join(', '));
check('policy_for() raises instead of returning a silent default',
  /raise KeyError\(/.test(policiesSrc) && /has no liveness policy/.test(policiesSrc));

// ── Part 3: the mutation proof must exist and still cover every protection ──────────────────────
// This is what stops the split from becoming an escape hatch: delete or hollow out the proof and
// this barrier — which DOES run in npm test — goes red.
check('the mutation proof file exists', mutationProof.length > 0,
  mutationProof ? '' : 'scrapers/common/tests/test_liveness_contract_mutations.py is missing');

const REQUIRED_MUTATIONS = [
  'failed_request_can_deactivate',
  'blocked_or_throttled_counts_as_death',
  '5xx_counts_as_death',
  'absence_alone_can_deactivate',
  'unknown_accumulates_a_strike',
  'unrecognised_200_is_positive_verification',
  'grace_window_bypassed',
  'alive_stops_resetting_strikes',
  'policy_may_opt_out_of_absence_rule',
  'never_verified_stops_counting_as_stale',
  'verification_stamped_without_alive_evidence',
  'crawler_presence_stamps_verification_by_default',
];
if (mutationProof) {
  const absent = REQUIRED_MUTATIONS.filter((m) => !mutationProof.includes(m));
  check('the mutation proof covers every named protection', absent.length === 0,
    absent.length ? `NOT MUTATION-PROVEN: ${absent.join(', ')}` : `${REQUIRED_MUTATIONS.length} protections`);
  check('the mutation proof actually asserts survival is a failure',
    /MUTATION SURVIVED/.test(mutationProof) && /assert not survived/.test(mutationProof));
  check('the mutation proof restores the contract in a finally block',
    /finally:\s*\n\s*shutil\.copyfile/.test(mutationProof));
}

console.log(
  failures === 0
    ? '\n✅ verify-liveness-contract: all checks passed.'
    : `\n❌ verify-liveness-contract: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
