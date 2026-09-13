// PERMANENT BARRIER — a worked example in a comment is a CLAIM, and claims get executed
// (barrier engineer, 2026-09-13).
//
// THE DEFECT THIS CLASS EXISTS FOR, measured today. On 2026-09-04 the owner raised the Advanced
// Filter's stop line from 25 to 50 (`INTERVIEW_STOP_AT`, src/lib/afRanking.ts). The constant moved,
// the code stayed correct, and the whole suite stayed green — but the worked examples written around
// that constant became arithmetically FALSE and nothing anywhere could notice:
//
//   src/lib/afRanking.ts, the narrowing predicate:
//     "at N=50 a count of 45 is the last qualifying answer, not the first rejected one"
//     -> at INTERVIEW_STOP_AT = 50 the last qualifying answer is 50, because the escape clause
//        `count <= INTERVIEW_STOP_AT` admits every k from 0..50. 45 is not a boundary at all.
//   src/lib/afRanking.ts, the offer gate:
//     "At N=50 an option yielding 45 qualifies and one yielding 47 does not"
//     -> optionNarrowsMeaningfully(47, 50) is TRUE (47 <= 50). The sentence asserts the opposite,
//        and its N=50 is below the gate's own `total > INTERVIEW_STOP_AT` floor, so the gate can no
//        longer even reach that N.
//
// Both sentences were correct when written. Both were read by engineers afterwards. One of them was
// the first thing a `grep` for the threshold landed on. This is the same failure mode AGENTS.md
// names for docs — "a future session must be able to recover it by READING THE REPO" — except the
// repo was actively misinforming the reader, with every barrier green.
//
// WHAT THIS ASSERTS. Every worked example written in the canonical form
//
//     [N=<total>, k=<count> -> qualifies]      or      [N=<total>, k=<count> -> rejected]
//
// anywhere under src/ is PARSED OUT OF THE SOURCE AND EXECUTED against the real, imported
// `optionNarrowsMeaningfully` from src/lib/afRanking.ts. A claim that disagrees with the function
// fails this check by name, with both the claimed and the actual verdict.
//
// This is deliberately the inverse of a source-text tripwire. It does not assert that some string is
// present; it takes the prose as INPUT and runs the real code against it. A future move of
// INTERVIEW_STOP_AT or MEANINGFUL_NARROWING_FRACTION therefore cannot leave a false example behind —
// it turns this check red on the PR that moves it.
//
// VACUITY IS THE OBVIOUS FAILURE MODE and is guarded explicitly: a parser that matches nothing would
// pass every claim it found (none), so a floor is asserted, and the floor is proven to bite by a
// mutation below. It is a FLOOR, not an exact count — adding a new example must never need an edit
// here; removing the examples this file was built for must.
//
//   node --experimental-strip-types scripts/verify-af-worked-examples-are-true.ts
//   (in `npm test`)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { optionNarrowsMeaningfully, INTERVIEW_STOP_AT, MEANINGFUL_NARROWING_FRACTION } from '../src/lib/afRanking.ts';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

// The examples this barrier was built for. A floor, never an exact count: three in afRanking.ts's
// narrowing note, three in its offer-gate note. If a refactor moves or deletes them, that is a
// deliberate decision someone has to make here, not something a bad glob can do quietly.
const MIN_CLAIMS = 6;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

export type Claim = { total: number; count: number; qualifies: boolean; file: string; line: number };

/** Parse every `[N=…, k=… -> qualifies|rejected]` claim out of one file's text. */
export function parseClaims(text: string, file = '(inline)'): Claim[] {
  const claims: Claim[] = [];
  text.split('\n').forEach((raw, i) => {
    for (const m of raw.matchAll(/\[\s*N\s*=\s*(\d+)\s*,\s*k\s*=\s*(\d+)\s*->\s*(qualifies|rejected)\s*\]/g)) {
      claims.push({ total: Number(m[1]), count: Number(m[2]), qualifies: m[3] === 'qualifies', file, line: i + 1 });
    }
  });
  return claims;
}

/** Execute one claim against the REAL predicate. Returns null when the prose is true. */
export function claimIsWrong(c: Claim): string | null {
  const actual = optionNarrowsMeaningfully(c.count, c.total);
  if (actual === c.qualifies) return null;
  return `${c.file}:${c.line} claims k=${c.count} of N=${c.total} is ${c.qualifies ? 'QUALIFIES' : 'REJECTED'}, `
    + `but optionNarrowsMeaningfully(${c.count}, ${c.total}) returns ${actual}`;
}

// ── Walk src/ and execute every claim found ────────────────────────────────────────────────────
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(p);
  }
})(SRC);

const claims: Claim[] = [];
for (const p of files) claims.push(...parseClaims(readFileSync(p, 'utf8'), p.slice(ROOT.length + 1)));

console.log(`constants in force: INTERVIEW_STOP_AT=${INTERVIEW_STOP_AT} MEANINGFUL_NARROWING_FRACTION=${MEANINGFUL_NARROWING_FRACTION}`);
check(`found at least ${MIN_CLAIMS} worked examples to execute`, claims.length >= MIN_CLAIMS,
  `found ${claims.length} — the examples this barrier exists for are gone, so it is now asserting nothing`);

for (const c of claims) {
  const wrong = claimIsWrong(c);
  check(`${c.file}:${c.line} — [N=${c.total}, k=${c.count} -> ${c.qualifies ? 'qualifies' : 'rejected'}]`, wrong === null, wrong ?? '');
}

// ── MUTATION PROOF — the predicate above, run against deliberately broken input ─────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The two real sentences that were live and false in this repo until today, in the canonical form.
// These are the regression: if the escape clause or the fraction ever changes such that they become
// true again, that is a deliberate product move and this file says so out loud.
mustCatch('the real 2026-09-04 casualty «at N=50, k=47 does not qualify» (true at 25, false at 50)',
  claimIsWrong({ total: 50, count: 47, qualifies: false, file: 'x', line: 1 }) !== null);
mustCatch('the real 2026-09-04 casualty «at N=50, k=45 is the LAST qualifying answer» (k=46 would be rejected)',
  claimIsWrong({ total: 50, count: 46, qualifies: false, file: 'x', line: 1 }) !== null);

// Both directions, so the checker is not simply failing everything or passing everything.
mustCatch('a TRUE claim being falsely reported as wrong (exactly 10% removed qualifies)',
  claimIsWrong({ total: 1000, count: 900, qualifies: true, file: 'x', line: 1 }) === null);
mustCatch('a TRUE rejection being falsely reported as wrong (just under 10%, above the escape line)',
  claimIsWrong({ total: 1000, count: 901, qualifies: false, file: 'x', line: 1 }) === null);
mustCatch('an inverted claim about a near-no-op option (k=N removes nothing, so it cannot qualify)',
  claimIsWrong({ total: 1000, count: 1000, qualifies: true, file: 'x', line: 1 }) !== null);

// The parser itself: it must find real claims, and must NOT invent them. A parser that silently
// matched nothing would make every assertion above vacuous — which is the whole reason MIN_CLAIMS
// exists, so prove the floor can actually bite.
mustCatch('a file with no claims at all being treated as a set of claims',
  parseClaims('// nothing to see here, N=50 and k=45 in loose prose\n').length === 0);
mustCatch('a real claim NOT being parsed out of a comment line',
  parseClaims('// … lands AT the target: [N=51, k=50 -> qualifies] removes only 2%.\n').length === 1);
mustCatch('a claim being parsed with the wrong verdict',
  parseClaims('// [N=100, k=91 -> rejected]')[0].qualifies === false);
mustCatch('the vacuity floor not biting on an empty claim set',
  parseClaims('').length < MIN_CLAIMS);

console.log('');
console.log(failed === 0
  ? `PASS — all ${claims.length} worked examples under src/ are true of the shipped predicate.`
  : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
