// A BARRIER'S PREDICATE MAY NOT REQUIRE A SOURCE COMMENT. SHRINK-ONLY RATCHET.
//
// ops_incident #727 names a recurring class: "a barrier whose LABEL states a property while its
// ASSERTION freezes one exact expression, so it holds the current code in place instead of the
// invariant". The repo has already paid for four instances. Nobody had swept for the rest, because
// the general form is not mechanisable — a frozen expression looks exactly like a precise one.
//
// ONE SUB-CLASS IS MECHANISABLE, AND ITS TELL IS EXACT: a predicate that requires a `//` COMMENT to
// be present in the product's bytes. A comment has no behaviour, so such a predicate is provably not
// asserting one — the author's own syntax is the evidence.
//
// MEASURED BY EXECUTION, 2026-09-27 (routine #10). `scripts/verify-read-aloud-contract.ts:184` read
//     check('starting a new search/turn stops any read-aloud left over from the previous response',
//           <a regex requiring `stopReadAloud();` followed by that line's trailing prose>)
// Rewording that comment in `src/app/agent.tsx` — one line, `stopReadAloud()` still called from the
// same place, zero behavioural change — produced:
//
//     FAIL  starting a new search/turn stops any read-aloud left over from the previous response
//     FAIL  98 of 99 read-aloud contract assertions hold
//     FAIL  (mutation) BLIND to …while the REAL shipped tree is NOT flagged
//     FAIL  (mutation) BLIND to …while the RETARGETED, executed property is untouched by that rename
//     ✗ 2 mutation(s) went UNCAUGHT — contractProblems cannot fail for them
//
// So one reworded sentence of prose takes down the assertion AND the evidence for it: the barrier's
// own negative control ("the real shipped tree is NOT flagged") stops holding, so its mutation proofs
// report themselves blind. That is the cost, and it lands on whoever next edits that product file for
// an unrelated reason.
//
// BOTH DIRECTIONS ARE BAD, which is why this is a defect and not a style note:
//   • FALSE RED on a no-op refactor — the check reports a regression that does not exist, which is
//     precisely the pressure docs/ops/BARRIER_ENGINEER.md Prohibition 1 exists to resist. A guard
//     that cries wolf at a reworded sentence is a guard someone eventually loosens, and afterwards
//     the loosening is indistinguishable from the legitimate repair.
//   • The prose is LOAD-BEARING AS A LOCATOR. In every site counted below, the comment is the only
//     thing telling one `stopReadAloud()` / `Speech.pause()` / `clearBlurTimer(…)` call from its
//     siblings. The predicate is therefore not asserting a property at all — it is freezing one
//     exact expression under a label that states one. #727, verbatim.
//
// SO THE REPAIR IS NEVER "DELETE THE COMMENT FROM THE REGEX". That makes the check LESS strict, which
// is Prohibition 1 from the other side. Replace the prose locator with a STRUCTURAL one — the
// enclosing function body, a distinguishing argument, or best of all an executed lift of the real
// symbol (scripts/lib/liftSymbols.ts) — then lower this file's baseline row in the SAME diff.
//
// Hermetic: reads the repo's own scripts/ directory, no network, no database. In `npm test`.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-barrier-predicates-do-not-pin-comments.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { commentPinsInSource, commentPinSites } from './lib/commentPinnedPredicates.ts';
import { parseBaseline } from './lib/sourceWindow.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = 'scripts/comment-pinned-predicate-baseline.txt';

// The ceiling may only FALL. It is a source constant so lowering it is a reviewed change and raising
// it cannot happen as a side effect of an append.
const PIN_CEILING = 10;

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}`);
  if (why) console.error(`      ${why}`);
};

let mutFail = 0;
const mustCatch = (defect: string, caught: boolean) => {
  if (caught) { console.log(`  ✓ catches: ${defect}`); return; }
  mutFail++;
  console.error(`  ✗ BLIND to: ${defect}`);
};

console.log('\nA barrier predicate may not require a source comment (ops_incident #727 sub-class)\n');

// ── THE VERDICT, PURE — so a proof can hand it a broken tree ──────────────────────────────────────
//
// Per-FILE COUNTS, never line numbers: a line number drifts on every unrelated edit above it, and a
// baseline that goes stale for innocent reasons is a baseline someone deletes. A count moves only
// when a site is added or converted — exactly when a reviewer should look. Same reasoning, and the
// same parser, as scripts/source-window-baseline.txt (parseBaseline is imported, not re-implemented).
export function pinRatchetProblems(
  found: Map<string, number>, baseline: Map<string, number>, ceiling: number,
): string[] {
  const problems: string[] = [];
  for (const [file, n] of [...found].sort()) {
    const allowed = baseline.get(file) ?? 0;
    if (n > allowed) {
      problems.push(
        `${file}: ${n} comment-pinned predicate(s), baseline allows ${allowed}. A predicate that ` +
        `requires a source COMMENT asserts prose, not behaviour: it goes RED at a reworded sentence ` +
        `and it is only ever green because one exact expression is still present. Locate the code ` +
        `structurally (enclosing function, a distinguishing argument) or lift and EXECUTE the real ` +
        `symbol — never by deleting the comment from the regex, which only weakens the check.`);
    }
  }
  for (const [file, allowed] of [...baseline].sort()) {
    const n = found.get(file) ?? 0;
    if (n < allowed) {
      problems.push(
        `${file}: baseline claims ${allowed} comment-pinned predicate(s) but the file has ${n}. ` +
        `STALE — lower the row (or delete it at 0) in the same diff as the repair, so the ledger ` +
        `cannot read better than the tree.`);
    }
  }
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  if (total > ceiling) {
    problems.push(`${total} comment-pinned predicates in total, above the pinned ceiling of ` +
      `${ceiling}. The ceiling may only fall.`);
  }
  return problems;
}

// ── §1 MEASURE THE TREE ───────────────────────────────────────────────────────────────────────────

const names = readdirSync(join(root, 'scripts')).filter((n) => /^verify-.*\.(ts|mjs)$/.test(n));
check('the scanner can see the barrier corpus at all (fails closed on an empty read)',
  names.length > 300, `found ${names.length} verify-* files`);

const files = names.map((n) => ({ path: `scripts/${n}`, src: readFileSync(join(root, 'scripts', n), 'utf8') }));
const sites = commentPinSites(files);
const found = new Map<string, number>();
for (const s of sites) found.set(s.file, (found.get(s.file) ?? 0) + 1);

const baseline = parseBaseline(readFileSync(join(root, BASELINE), 'utf8'));
check('the baseline ledger parses into rows (the ratchet can see its own input)',
  baseline.size > 0, `${baseline.size} row(s)`);

const problems = pinRatchetProblems(found, baseline, PIN_CEILING);
const total = [...found.values()].reduce((a, b) => a + b, 0);
console.log(`\n  comment-pinned predicates: ${total} in ${found.size} file(s) · ceiling ${PIN_CEILING}\n`);
for (const s of sites) console.log(`      ${s.file}:${s.line}`);
console.log('');
check('no barrier predicate requires a source comment beyond its recorded baseline',
  problems.length === 0, problems.join('\n      '));

// ── §2 THIS CHECK REALLY RUNS ─────────────────────────────────────────────────────────────────────
// Asked with npmTestRuns(), never by string-matching package.json — AGENTS.md, "How npm test finds
// its checks": that predicate is now true for every file including ones nothing runs.
check('this ratchet is discovered and run by npm test',
  npmTestRuns(root, 'verify-barrier-predicates-do-not-pin-comments'));

// ── §3 MUTATION PROOFS — both directions ──────────────────────────────────────────────────────────
console.log('\n  mutation proof — the ratchet must fail on its own defect, and NOT on health\n');

const F = (src: string) => commentPinsInSource('t.ts', src);

// The pin shape, assembled at runtime so this file can describe the anti-pattern without committing
// it. `P` is the escaped comment marker as it appears inside a regex literal.
const P = '\\' + '/' + '\\' + '/';
const PINNED = `check('the label states a property', /stopReadAloud\\(\\); ${P} a new turn starting/.test(agent));`;
const STRUCTURAL = `check('the label states a property', /stopReadAloud\\(\\);/.test(turnStartBody));`;

mustCatch('a NEW predicate that requires a source comment', F(PINNED).length === 1);
mustCatch('the same pin written with \\s* between the call and the comment',
  F(`check('x', /setAgeFlow\\(null\\);\\s*${P} never open an empty card/.test(ag));`).length === 1);
mustCatch('a pin asserting a comment is ABSENT (fails OPEN when the prose is reworded and the bad code stays)',
  F(`check(!/NOT A LOOP\\.\\s*\\n\\s*${P} resolves it deterministically/.test(edge));`).length === 1);

// The negative controls. A ratchet red for everything is as useless as one green for everything, and
// these are the three shapes the corpus really uses — 40+ sites between them.
mustCatch('NOT flagging a comment STRIPPER (the healthy pattern: prose removed before asserting)',
  F(`const code = src.replace(/${P}.*$/gm, '');`).length === 0);
mustCatch('NOT flagging a `.split()` stripper',
  F(`const c = src.split('\\n').map((l) => l.replace(/${P}.*$/, '')).join('\\n');`).length === 0);
mustCatch('NOT flagging a URL — https:// is not a comment',
  F(`check('canonical', /DTG_URL="https:${P}ezhalah-app\\.vercel\\.app"/.test(g));`).length === 0);
mustCatch('NOT flagging the barrier\'s OWN trailing comment on a code line',
  F(`const TIMES = /(\\w+)\\s*\\*\\s*(\\w+)/g; // the two operands around one *`).length === 0);
mustCatch('NOT flagging the barrier\'s OWN prose, so a file can document this class without committing it',
  F(`// never write /foo\\(\\); ${P} some prose/ as a predicate\nconst a = 1;`).length === 0);
mustCatch('NOT flagging a mutation proof\'s synthetic INPUT (a string fed IN, not matched against source)',
  F(`mustCatch('x', parseClaims('${'//'} nothing to see here, N=50 in loose prose\\n').length === 0);`).length === 0);
mustCatch('NOT flagging a generic comment matcher with no required PROSE (it strips any comment, it names none)',
  F(`const anyComment = /${P}.*$/;`).length === 0);
mustCatch('the STRUCTURAL repair of the very pin above is NOT flagged (the fix direction is reachable)',
  F(STRUCTURAL).length === 0);

// The verdict's own two directions.
const one = new Map([['a.ts', 1]]);
mustCatch('a new pin in a file the baseline does not list',
  pinRatchetProblems(one, new Map(), 10).some((p) => p.includes('baseline allows 0')));
mustCatch('a file going ABOVE its baseline row',
  pinRatchetProblems(new Map([['a.ts', 3]]), new Map([["a.ts", 2]]), 10).length > 0);
mustCatch('a STALE row reading better than the tree (a repair landed, the ledger did not move)',
  pinRatchetProblems(new Map(), new Map([["a.ts", 1]]), 10).some((p) => p.includes('STALE')));
mustCatch('the total breaching the ceiling',
  pinRatchetProblems(new Map([['a.ts', 99]]), new Map([["a.ts", 99]]), 10).some((p) => p.includes('ceiling')));
mustCatch('a baseline that cannot be parsed reading as permission (an empty ledger allows nothing)',
  pinRatchetProblems(one, parseBaseline('# only a comment\n'), 10).length > 0);

// And the corpus itself, which is the control that matters: the tree as it stands must be CLEAN
// against its recorded baseline, or the ratchet is vacuously red and proves nothing.
mustCatch('…while the REAL corpus at its recorded baseline is NOT flagged (not vacuously red)',
  pinRatchetProblems(found, baseline, PIN_CEILING).length === 0);

if (mutFail > 0) { console.error(`\n✗ ${mutFail} mutation(s) went UNCAUGHT\n`); process.exit(1); }
if (failed > 0) { console.error(`\n✗ ${failed} check(s) failed\n`); process.exit(1); }
console.log('\n✓ every barrier predicate asserts behaviour, not prose — at or below the recorded baseline\n');
