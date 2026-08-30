// THE LIVENESS BARRIER (owner rule, 2026-08-30). Makes the platform-wide contract un-removable.
//
// THE PERMANENT RULE IT DEFENDS:
//   `active = true` must mean we have reasonable RECENT EVIDENCE that a listing is live — not
//   merely that nobody has yet proved it dead.
//
// WHY A BARRIER AND NOT JUST TESTS. Every failure this contract exists to prevent was silent and
// was found by hand, months late:
//   · aqar reported soft-closed ads healthy for weeks (13,139 retired in one day once fixed);
//   · 26 of 29 platforms inferred liveness purely from crawl presence, with nobody having decided
//     that — the question was never asked at onboarding;
//   · gathern's 19.5-day coverage cycle left ~1,260 confirmed-dead listings searchable;
//   · dealapp serves an identical 200 shell for a real id AND a bogus one.
// None of those tripped a test, because no test asserted the RULE — only the implementations. This
// file asserts the rule, and mutation-proves that each protection actually fires when removed.
//
// It does two things npm test cannot do by running pytest alone:
//   1. MUTATION PROOF — it edits a copy of liveness_contract.py to break each protection in turn
//      and requires the suite to FAIL. A protection whose removal keeps the suite green is
//      decoration, and this reports it as such.
//   2. REGISTRY COMPLETENESS — every non-retired scraper directory must have a liveness policy.
//      A new platform cannot reach production with its liveness question unanswered.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CONTRACT = join(ROOT, 'scrapers', 'common', 'liveness_contract.py');
const TESTS = 'scrapers/common/tests/test_liveness_contract.py';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-liveness-contract: active=true must mean verified-alive, not un-disproven.');

// ── Part 1: the suite passes as shipped ─────────────────────────────────────────────────────────
function runSuite(): boolean {
  try {
    execFileSync('python3', ['-m', 'pytest', TESTS, '-q'], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const pythonAvailable = (() => {
  try {
    execFileSync('python3', ['-c', 'import pytest'], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

if (!pythonAvailable) {
  // Fail CLOSED. A missing interpreter must never be reported as "the contract is fine".
  check('python3 + pytest are available to prove the contract', false,
    'cannot verify the liveness contract without them — refusing to pass vacuously');
} else {
  check('the contract suite passes as shipped', runSuite());

  // ── Part 2: mutation proof, one per owner-named protection ───────────────────────────────────
  const original = readFileSync(CONTRACT, 'utf8');
  const backup = join(mkdtempSync(join(tmpdir(), 'liveness-')), 'liveness_contract.py');
  copyFileSync(CONTRACT, backup);

  const MUTATIONS: Array<{ name: string; from: string; to: string }> = [
    {
      name: 'a failed request (status None) can deactivate',
      from: '    if status is None:\n        return UNKNOWN',
      to: '    if status is None:\n        return DEAD',
    },
    {
      name: '403/429 counts as death',
      from: '    if status in _BLOCKED_OR_THROTTLED:\n        return UNKNOWN',
      to: '    if status in _BLOCKED_OR_THROTTLED:\n        return DEAD',
    },
    {
      name: '5xx counts as death',
      from: '    if 500 <= status <= 599:\n        return UNKNOWN',
      to: '    if 500 <= status <= 599:\n        return DEAD',
    },
    {
      name: 'crawler/sitemap absence alone can deactivate',
      from: '    if evidence is EvidenceKind.ABSENCE:',
      to: '    if False:',
    },
    {
      name: 'UNKNOWN accumulates a strike',
      from: '    if verdict == UNKNOWN:\n        return Decision(action="none", reason="unknown_response_never_counts_as_death",\n                        strikes=strikes)',
      to: '    if verdict == UNKNOWN:\n        return Decision(action="strike", reason="x", strikes=strikes + 1)',
    },
    {
      name: 'an unrecognised 200 is treated as positive verification',
      from: '        if alive_marker is not None and not alive_marker(body):\n            return UNKNOWN',
      to: '        if False:\n            return UNKNOWN',
    },
    {
      name: 'the grace window is bypassed (one reading retires a listing)',
      from: '    if new_strikes >= policy.grace:',
      to: '    if True:',
    },
    {
      name: 'an ALIVE response stops resetting strikes / recording verification',
      from: '        return Decision(action="reset", reason="source_confirmed_alive", strikes=0,\n                        verified_alive=True)',
      to: '        return Decision(action="none", reason="source_confirmed_alive", strikes=strikes)',
    },
    {
      name: 'a policy may opt out of the absence rule',
      from: '        if not self.absence_is_candidate_only:',
      to: '        if False:',
    },
    {
      name: 'never-verified rows stop counting as stale',
      from: '    if hours_since_verified is None:\n        return True',
      to: '    if hours_since_verified is None:\n        return False',
    },
  ];

  let caught = 0;
  for (const m of MUTATIONS) {
    if (!original.includes(m.from)) {
      check(`mutation target present: ${m.name}`, false,
        'the contract no longer contains this code — the barrier has drifted from the module');
      continue;
    }
    writeFileSync(CONTRACT, original.replace(m.from, m.to));
    const survived = runSuite();          // suite still green ⇒ the protection is decoration
    copyFileSync(backup, CONTRACT);       // always restore
    check(`mutation caught: ${m.name}`, !survived,
      survived ? 'SURVIVED — no test fails when this protection is removed' : 'suite fails as required');
    if (!survived) caught++;
  }
  console.log(`  ${caught}/${MUTATIONS.length} protections are mutation-proven`);
  check('the contract is byte-identical after mutation testing', readFileSync(CONTRACT, 'utf8') === original);
}

// ── Part 3: registry completeness — no production platform without a declared strategy ─────────
const policiesSrc = readFileSync(join(ROOT, 'scrapers', 'common', 'liveness_policies.py'), 'utf8');
const declared = new Set([...policiesSrc.matchAll(/"([a-z0-9_]+)":\s*_P\(/g)].map((m) => m[1]));
for (const m of policiesSrc.matchAll(/for p in \(([\s\S]*?)\)\n/g)) {
  for (const q of m[1].matchAll(/"([a-z0-9_]+)"/g)) declared.add(q[1]);
}
const exempt = new Set(
  [...(/NOT_PRODUCTION_SEARCHABLE = frozenset\(\{([\s\S]*?)\}\)/.exec(policiesSrc)?.[1] ?? '')
    .matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]),
);

const scraperDirs = readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('__') && d.name !== 'tests')
  .map((d) => d.name);

const missing = scraperDirs.filter((p) => !declared.has(p) && !exempt.has(p));
check('every production-searchable platform has a registered liveness policy', missing.length === 0,
  missing.length
    ? `NO POLICY: ${missing.join(', ')} — register in scrapers/common/liveness_policies.py before ` +
      'making the platform production-searchable, or add it to NOT_PRODUCTION_SEARCHABLE'
    : `${declared.size} platforms declared, ${exempt.size} exempt`);

// A platform must not be able to slip through by being declared AND exempt at once.
const both = [...declared].filter((p) => exempt.has(p));
check('no platform is both declared and exempt', both.length === 0, both.join(', '));

console.log(
  failures === 0
    ? '\n✅ verify-liveness-contract: all checks passed.'
    : `\n❌ verify-liveness-contract: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
