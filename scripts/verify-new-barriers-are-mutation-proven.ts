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
const PROOF_CALL = /\b(?:mustCatch|mutation|mustFail|mutantCaught)\s*\(/g;

// `mustCatch('label', true)` can never fail, and the ratchet must refuse it.
//
// TOP-LEVEL ONLY (repaired 2026-09-04 by routine #10). This was
// `…\s*\([^)]*,\s*true\s*\)`, and `[^)]*` cannot cross a nested `)`. So a GENUINE differential proof
// whose mutant happens to take a boolean —
//     mustCatch('collapsing unknown into known-empty is DETECTED',
//               collapsed(0, true) !== probeVerdict(0, true) && …)
// — matched on the inner `collapsed(0, true)` and was rejected as unconditional. Watched: exactly
// that, on verify-af-probe-failure-not-a-verdict.ts, the moment it was proven and taken off the
// grandfather list. This is a FALSE RED, and a false red on the apparatus is dangerous in its own
// way: the obvious way to clear it is to weaken the real proof until the regex stops complaining.
// The reader now walks the call's balanced argument list and strips NESTED groups before asking
// whether the second argument is the bare literal `true`.
export function fakeProofArgs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(PROOF_CALL)) {
    let depth = 0;
    let end = -1;
    for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    // Flatten nested calls so only the OUTER argument list is considered.
    let args = src.slice(m.index! + m[0].length, end);
    let prev: string;
    do { prev = args; args = args.replace(/\([^()]*\)/g, '()'); } while (args !== prev);
    if (/,\s*true\s*$/.test(args)) out.push(`${m[0]}…${args.trim()})`);
  }
  return out;
}
const FAKE_PROOF = (src: string) => fakeProofArgs(src).length > 0;
const EXEMPT = /^\s*\/\/\s*MUTATION-PROOF-EXEMPT:\s*(\S.*)$/m;

// Scan CODE, not prose or examples. This barrier's own file contains a literal `mustCatch('x', true)`
// as the input to its fake-proof mutation test — and on its first run it flagged ITSELF, which is the
// correct behaviour of the wrong reader. Comments and quoted strings are removed before the per-file
// scan, so a barrier can describe an anti-pattern without committing it. The mutation proofs below
// feed the regexes their own inputs directly and are unaffected.
//
// TRAILING COMMENTS COUNT TOO (repaired 2026-09-04 by routine #10). The first version stripped only
// comments that START a line (`^\s*//`), so a barrier whose ONLY "proof" was a trailing note —
// `let failed = 0; // TODO: add a mustCatch(...) proof one day` — read as PROVEN and satisfied the
// rule without ever running anything. Watched to happen: that exact string passed
// PROOF.test(codeOnly(…)). The reader now strips a `//` anywhere, EXCEPT one preceded by `:` or a
// word character, so the `//` in a `https://…` literal is still not a comment. The comment pass stays
// AHEAD of the string passes on purpose: an apostrophe inside a comment (`// the runner's own`) would
// otherwise open a bogus string literal and swallow the real code after it.
const codeOnly = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\w])\/\/.*$/gm, '$1')
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

// A pure predicate, so the mutation proof below can feed it a synthetic over-ceiling length. The
// first version asserted `grandfathered.length + 1 > CEILING` directly, which made the barrier FAIL
// the moment the list SHRANK — the exact direction the ratchet exists to encourage. Caught by an
// agent that tried to remove a newly-proven barrier from the list and could not.
const exceedsCeiling = (n: number) => n > GRANDFATHERED_CEILING;
check(`the grandfather list has not grown (${grandfathered.length} <= ${GRANDFATHERED_CEILING})`,
  !exceedsCeiling(grandfathered.length),
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
  else if (FAKE_PROOF(src)) faked.push(f);
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
  exceedsCeiling(GRANDFATHERED_CEILING + 1));
mustCatch('the ratchet refusing to let the list SHRINK (the direction it exists to encourage)',
  !exceedsCeiling(GRANDFATHERED_CEILING - 1));
mustCatch('a barrier whose only "proof" is prose',
  !PROOF.test('// this file is mutation-proven, honestly it is\ncheck("a", true);'));
mustCatch('a proof that passes a literal true and can never fail',
  FAKE_PROOF("mustCatch('the thing coming back', true);"));
// …and the false red it used to produce: a REAL differential proof whose mutant takes a boolean.
mustCatch('a genuine proof containing a nested `(…, true)` NOT being mistaken for an unconditional one',
  !FAKE_PROOF("mustCatch('collapsing unknown', collapsed(0, true) !== probeVerdict(0, true));"));
mustCatch('…and a fake proof is still refused when the literal sits on its own line after a real call',
  FAKE_PROOF("mustCatch('x',\n  someHelper(a, b),\n  true);"));
mustCatch('an exemption with no reason',
  (() => { const m = EXEMPT.exec('// MUTATION-PROOF-EXEMPT: n/a\n'); return !!m && m[1].trim().length < 12; })());
mustCatch('a grandfathered name that no longer exists',
  ['verify-a-file-that-was-deleted.ts'].filter((n) => !barriers.includes(n)).length > 0);
mustCatch('a real proof still reading as a proof (the predicate is not vacuous)',
  PROOF.test("mustCatch('x', !/needle/.test(mutated));"));
// The trailing-comment hole, pinned as its own mutant so the reader can never narrow back to `^\s*//`.
mustCatch('a barrier whose only "proof" is a TRAILING comment on a line of real code',
  !PROOF.test(codeOnly('let failed = 0; // TODO: add a mustCatch(...) proof one day\ncheck(1);')));
mustCatch('…while a URL inside a string still cannot swallow the real proof after it',
  PROOF.test(codeOnly("const doc = 'https://example.test/x'; mustCatch('y', !ok);")));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ every barrier written from now on has been watched to fail\n');
