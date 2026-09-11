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
import { stripCommentsAndStrings } from './lib/stripComments.ts';

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
// whether the second argument is a bare boolean literal.
//
// EITHER LITERAL, NOT JUST `true` (widened 2026-09-06 by routine #10). Seven barriers define their
// own `mustCatch` with INVERTED polarity — `check(label, invariantHeldOnBrokenInput === false)` —
// and under that convention the unconditional pass is `mustCatch('…', false)`, which the old reader
// waved through as a proof. Asking about `true` alone was asking about one house style. A second
// argument that is a bare boolean literal cannot fail under EITHER convention, so both are refused.
// Verified before widening: no proof anywhere in the tree currently passes a bare `false`, so this
// is a ratchet tightening with no existing case to accommodate — never a threshold moved to fit.
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
    // Blank string bodies FIRST — a comma or an unbalanced paren inside a label must not look like
    // structure — then flatten nested groups so only the OUTER argument list is considered.
    //
    // THE PLACEHOLDER MUST CONTAIN NO PARENTHESES (repaired 2026-09-06). The original collapsed
    // `(…)` to `()`, which still contains parens, so `run(a, mutantOf(b, c))` flattened to
    // `run(a, mutantOf())` and STOPPED: the outer group could never match `\([^()]*\)` again. The
    // tail-only reader never noticed, but as soon as this asked about every top-level argument, the
    // `true` inside an un-flattened `run('', true, …)` read as a top-level one and condemned two of
    // the strongest proofs in the tree. Collapsing to a paren-free token terminates properly.
    let args = src.slice(m.index! + m[0].length, end)
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    let prev: string;
    do {
      prev = args;
      args = args.replace(/\([^()]*\)/g, '¤').replace(/\[[^[\]]*\]/g, '¤').replace(/\{[^{}]*\}/g, '¤');
    } while (args !== prev);
    // A bare boolean argument is an unconditional PROOF CONDITION unless the call takes a CALLBACK,
    // in which case the boolean is a polarity flag on a proof that does its work in that callback.
    // verify-card-never-invents-a-date.ts defines mustCatch(what, mutate, expectPass) and passes
    // `false` as exactly such a flag on proofs that mutate the REAL file and re-execute it — the
    // strongest kind in the tree. Widening to `false` without this clause flagged all three of them,
    // which is the false red this reader was repaired for once already (see the header): the obvious
    // way to clear a false red is to weaken the real proof until the regex stops complaining. The
    // old `(…, realCall(), true)` shape — no callback anywhere — is still refused, unchanged.
    const parts = args.split(',').slice(1);
    const takesCallback = parts.some((p) => p.includes('=>') || /\bfunction\b/.test(p));
    if (!takesCallback && parts.some((p) => /^\s*(?:true|false)\s*$/.test(p))) {
      out.push(`${m[0]}…${args.trim()})`);
    }
  }
  return out;
}
const FAKE_PROOF = (src: string) => fakeProofArgs(src).length > 0;
const EXEMPT = /^\s*\/\/\s*MUTATION-PROOF-EXEMPT:\s*(\S.*)$/m;

// The code-only reader lives in scripts/lib/stripComments.ts as `stripCommentsAndStrings`, NOT here.
// It was a local copy until 2026-09-11; promoting it removed a duplicate that a second barrier was
// about to clone (PART 1.6: a barrier holding its own copy of shared logic drifts, and then the test
// passes while the thing it guards is broken). The proofs below are unchanged and now pin the SHARED
// function — which is the point: they are a statement about the code that really decides, not a copy.
//
// Scan CODE, not prose or examples. This barrier's own file contains a literal `mustCatch('x', true)`
// as the input to its fake-proof mutation test — and on its first run it flagged ITSELF, which is the
// correct behaviour of the wrong reader. See the shared function's header for the one-pass and
// regex-literal rationale (ops_incident #132), both mutation-proven below.
const codeOnly = stripCommentsAndStrings;

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
mustCatch('a proof that passes a literal false — unconditional under the INVERTED mustCatch convention seven barriers use',
  FAKE_PROOF("mustCatch('the helper leaves it cross-origin', false);"));
mustCatch('a genuine proof containing a nested `(…, false)` NOT being mistaken for an unconditional one',
  !FAKE_PROOF("mustCatch('a healthy platform fails the gate', majorityRender(3, false) === false && x);"));
mustCatch('a boolean buried TWO groups deep NOT surfacing as a top-level argument (the real shape that broke the flattener: run(…, true, mutantOf(…)))',
  !FAKE_PROOF("mustCatch('a completed sign-out that latches',\n  !neutralAndClosed(await run('onLogout', true, mutantOf(src, 'a'))), 'setLoggingOut');"));
mustCatch('a THREE-argument proof whose last argument is a polarity FLAG, not the condition, NOT being flagged',
  !FAKE_PROOF("await mustCatch('the fabrication returning verbatim', (s) => s.replace(/a/, 'b'), false);"));
mustCatch('…while a genuine two-argument proof whose condition ends in `=== false` is NOT flagged either',
  !FAKE_PROOF("mustCatch('a healthy platform fails the majority gate', majorityRender(3, 4) === false);"));
mustCatch('…and a label containing a comma cannot split the argument list into a false extra argument',
  FAKE_PROOF("mustCatch('a, b, and c all break', false);"));
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

// ── the quote-desync class (incident #132), pinned in BOTH directions ────────────────────────────
// The reader must never let one quote kind re-open inside another. These are the two observable
// verdicts that desync produced, so a return to independent global passes fails here, not silently
// in a barrier nobody re-reads.
const APOSTROPHE_THEN_FAKE =
  "mustCatch('a genuine differential', !broken(x));\n" +
  `const note = "the runner's own child"; mustCatch('this one can never fail', true);`;
mustCatch('an unconditional proof HIDDEN by an apostrophe inside a double-quoted string on its own line',
  FAKE_PROOF(codeOnly(APOSTROPHE_THEN_FAKE)));
mustCatch('…and the mirror direction: a real proof SWALLOWED by that same apostrophe, reading as unproven',
  PROOF.test(codeOnly(`const m = "it's fine"; mustCatch('the defect', !ok);`)));
mustCatch('a stray backtick inside a quoted string NOT swallowing every line until the next one',
  PROOF.test(codeOnly('const a = "run `npm test` now";\nmustCatch(\'the defect\', !ok);')));
mustCatch('an apostrophe inside a TEMPLATE literal not re-opening as a single-quoted string',
  PROOF.test(codeOnly("const m = `the runner's own child`; mustCatch('the defect', !ok);")));
mustCatch("an UNTERMINATED apostrophe (prose, or a regex literal) not eating the file after it",
  PROOF.test(codeOnly("const RE = /it's/;\nmustCatch('the defect', !ok);")));
// The regex-literal face of the same class, watched on this file itself (see the reader's header).
mustCatch('a BACKTICK inside a regex literal not opening a multiline template that splices the file',
  PROOF.test(codeOnly('const RE = /`(?:[^`\\\\]|\\\\.)*`/g;\nmustCatch(\'the defect\', !ok);')));
mustCatch('…and a quote inside a regex literal not re-opening as a string either',
  PROOF.test(codeOnly('const RE = /["\']/g;\nmustCatch(\'the defect\', !ok);')));
mustCatch('…while ordinary DIVISION is not mistaken for a regex that swallows the rest of the line',
  PROOF.test(codeOnly("const ratio = hits / total; mustCatch('the defect', !ok);")));
mustCatch('…and a `/` inside a regex CHARACTER CLASS does not close it early',
  PROOF.test(codeOnly("const RE = /[/x]y/g; mustCatch('the defect', !ok);")));
// Negative controls — the reader must still REMOVE what it exists to remove, or it is vacuously green.
mustCatch('…while the reader still strips a real line comment (not vacuously permissive)',
  !PROOF.test(codeOnly('let failed = 0; // mustCatch(...) one day\ncheck(1);')));
mustCatch('…and still strips a real block comment',
  !PROOF.test(codeOnly('/* mustCatch(\'x\', true); */\ncheck(1);')));
mustCatch('…and still blanks a quoted string, so a barrier may DESCRIBE an anti-pattern in prose',
  !FAKE_PROOF(codeOnly(`const bad = "mustCatch('x', true)"; check(1);`)));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ every barrier written from now on has been watched to fail\n');
