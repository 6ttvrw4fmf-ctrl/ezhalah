// Barrier: EVERY NEW BARRIER MUST BE PROVEN TO FAIL.
//
// A barrier nobody ever watched fail is not a barrier, it is a comment that runs. This repo has been
// burned by that exact shape before — a guard that asserted the bug instead of the invariant, and a
// mutation proof that silently stopped failing when a second call site appeared. Both were caught
// only because someone deliberately re-broke the code and watched.
//
// MEASURED 2026-09-04: of 356 `scripts/verify-*` barriers, exactly 20 contain an executable mutation
// proof. The other 335 have never been demonstrated to fail against the defect they claim to
// prevent. Retro-fitting all 335 would be enormous churn for uneven value, and much of it would be
// ceremony on checks whose failure mode is obvious.
//
// So this is a RATCHET, not a retrofit — the same shape as scripts/test-baseline.txt's floor:
//   * every barrier that exists today is grandfathered, by name, in mutation-proof-grandfathered.txt;
//   * every barrier added from now on must carry a proof, or an explicit exemption WITH A REASON;
//   * the grandfather list can only SHRINK. Its size is pinned by a constant here, so adding a name
//     to it is not a quiet edit to a text file — it fails this check until someone also raises a
//     number in reviewed source, which is exactly the friction that decision deserves.
//
// WHAT COUNTS AS A PROOF. An executable call — `mustCatch(...)` or `mutation(...)` — that applies the
// barrier's own predicate to a DELIBERATELY BROKEN input and asserts it fails. Prose describing a
// mutation is not a proof; neither is `mustCatch('...', true)`, which passes unconditionally and is
// checked for below.
//
//   node --experimental-strip-types scripts/verify-new-barriers-are-mutation-proven.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const LIST = join(root, 'scripts', 'mutation-proof-grandfathered.txt');

// The size of the grandfather list on the day the ratchet was installed. It may fall as old barriers
// gain proofs; it must never rise. Raising it means "we added a barrier nobody proved" and that is a
// decision that belongs in a reviewed diff, not in an append to a text file.
const GRANDFATHERED_CEILING = 335;

// An executable proof, not a mention of one.
const PROOF = /\b(mustCatch|mutation|mustFail|mutantCaught)\s*\(/;
// `mustCatch('label', true)` can never fail. Neither can a bare `false` second argument to `check`.
const FAKE_PROOF = /\b(mustCatch|mutation|mustFail|mutantCaught)\s*\([^)]*,\s*true\s*\)/;
const EXEMPT = /^\s*\/\/\s*MUTATION-PROOF-EXEMPT:\s*(\S.*)$/m;

// Scan CODE, not prose or examples. This barrier's own file contains a literal `mustCatch('x', true)`
// as the input to its fake-proof mutation test — and on its first run it flagged ITSELF, which is the
// correct behaviour of the wrong reader. Line comments and quoted strings are removed before the
// per-file scan, so a barrier can describe an anti-pattern without committing it. The mutation proofs
// below feed the regexes their own inputs directly and are unaffected.
const codeOnly = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const barriers = readdirSync(join(root, 'scripts'))
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
  .sort();

check('the grandfather list is committed', existsSync(LIST),
  'scripts/mutation-proof-grandfathered.txt is missing — without it every pre-existing barrier reads as new');
const grandfathered = existsSync(LIST)
  ? readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const grandSet = new Set(grandfathered);

console.log('\nEvery NEW barrier is proven to fail — the grandfather list can only shrink\n');

check(`the grandfather list has not grown (${grandfathered.length} <= ${GRANDFATHERED_CEILING})`,
  grandfathered.length <= GRANDFATHERED_CEILING,
  `${grandfathered.length} names listed. A new barrier was added to the exemption list instead of being proven. ` +
  `If that is genuinely intended, raise GRANDFATHERED_CEILING in this file so the decision is reviewable.`);

// A stale name keeps the ceiling artificially high and hides a real regression in coverage.
const stale = grandfathered.filter((n) => !barriers.includes(n));
check('every grandfathered name still exists', stale.length === 0,
  `these were renamed or deleted but still occupy a slot: ${stale.join(', ')}`);

// The whole point: anything NOT grandfathered must carry a real proof.
const unproven: string[] = [];
const faked: string[] = [];
const exemptedWithoutReason: string[] = [];
for (const f of barriers) {
  if (grandSet.has(f)) continue;
  const raw = readFileSync(join(root, 'scripts', f), 'utf8');
  const src = codeOnly(raw);
  const ex = EXEMPT.exec(raw);
  if (ex) {
    if (!ex[1] || ex[1].trim().length < 12) exemptedWithoutReason.push(f);
    continue;
  }
  if (!PROOF.test(src)) unproven.push(f);
  else if (FAKE_PROOF.test(src)) faked.push(f);
}
check('every barrier added since the ratchet carries an executable mutation proof',
  unproven.length === 0,
  `no proof in: ${unproven.join(', ')}\n      Add a mustCatch(...) that applies this barrier's own predicate to a ` +
  `deliberately broken input, or declare "// MUTATION-PROOF-EXEMPT: <why this check cannot meaningfully fail>".`);
check('no mutation proof passes a bare literal true (a proof that cannot fail)',
  faked.length === 0, `unconditional proof in: ${faked.join(', ')}`);
check('every exemption states a real reason', exemptedWithoutReason.length === 0,
  `exempt without a usable reason: ${exemptedWithoutReason.join(', ')}`);

const proven = barriers.filter((f) => !grandSet.has(f));
console.log(`\n  barriers: ${barriers.length} · grandfathered: ${grandfathered.length} · held to the rule: ${proven.length}`);

// ── mutation self-proof ─────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

mustCatch('a new barrier added to the grandfather list instead of being proven',
  grandfathered.length + 1 > GRANDFATHERED_CEILING);
mustCatch('a barrier whose only "proof" is prose',
  !PROOF.test('// this file is mutation-proven, honestly it is\ncheck("a", true);'));
mustCatch('a proof that passes a literal true and can never fail',
  FAKE_PROOF.test("mustCatch('the thing coming back', true);"));
mustCatch('an exemption with no reason',
  (() => { const m = EXEMPT.exec('// MUTATION-PROOF-EXEMPT: n/a\n'); return !!m && m[1].trim().length < 12; })());
mustCatch('a grandfathered name that no longer exists',
  ['verify-a-file-that-was-deleted.ts'].filter((n) => !barriers.includes(n)).length > 0);
mustCatch('a real proof still reading as a proof (the predicate is not vacuous)',
  PROOF.test("mustCatch('x', !/needle/.test(mutated));"));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ every barrier written from now on has been watched to fail\n');
