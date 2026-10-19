// A LIVE INSTRUMENT MAY NOT TREAT THE ARRIVAL SCREENFUL AS THE TURN'S WHOLE REVEAL.
//
// THE CONTRACT. Since 2026-09-20 (owner) a results turn ARRIVES with only
// `min(initialReveal(...), CASCADE_MAX)` cards and `maybeRevealOnScroll` walks the rest as the user
// approaches it. src/lib/initialReveal.ts states it directly above the constant: "Live journeys must
// therefore expect a screenful ON ARRIVAL and scroll to reach the target — asserting the whole first
// page renders immediately is the PRE-2026-09-20 contract."
//
// THE DEFECT, MEASURED (ops_incident #699, 2026-09-23). scripts/redteam-chain-live.mjs settled on
// "the card count stopped growing" — which, without a scroll, is exactly CASCADE_MAX — and then
// compared that 12 against the RPC total. It filed two CORRECT production cells as user-facing dead
// ends: حفر الباطن/إيجار-سنوي/شقة and الخبر/تجاري/مستودع, honest total 18 each, reported as
// «pager absent while 18 > 12 shown». Driven by hand in the same browser minutes later: arrival 12,
// after scrolling 18. Nothing was unreachable. The window 13..25 is the dangerous one — those totals
// close the chat (≤ INTERVIEW_STOP_AT) so no pager is rendered BY DESIGN, and every such cell reads
// as a dead end to an instrument that never scrolls.
//
// WHY THIS FILE EXISTS RATHER THAN A FIX TO THAT ONE INSTRUMENT. Two siblings already imported
// CASCADE_MAX and scrolled; this one was missed, and NOTHING IN THE TREE WOULD HAVE CAUGHT A FOURTH.
// The sibling class guard scripts/verify-live-journeys-wait-for-results.ts pins three journeys BY
// FILENAME (COMBINED / TRENDING / PILL), so an instrument outside those three is outside the guard —
// the enumerate-vs-discover gap #699 routed to routine #10, and the same shape ops_incident #723
// records one level down: "when a rule is enforced by matching a CALL, ask what other spelling asks
// the same QUESTION."
//
// SO DISCOVERY IS BY SHAPE AND CLASSIFICATION IS MANDATORY. Every file under scripts/ and e2e/ whose
// COMMENT-STRIPPED source names the product's own `card-listing-` testID prefix must carry a row in
// scripts/live-card-count-sites.txt. A site with no row is RED; a row whose file no longer names the
// prefix is RED as STALE. Discovery is deliberately the BROAD token and not one selector spelling:
// narrowing it to `[data-testid^="card-listing-"]` is how #723 happened, and a card reader that
// invents its own spelling still has to name the prefix the product ships.
//
// AND EVERY VERDICT IS EXECUTED, NEVER BELIEVED — both directions, per row:
//   walks-the-cascade                calls a scroll-and-re-read walk BEFORE the last line that puts
//                                    a count next to a total, and keeps no copy of CASCADE_MAX.
//   count-is-not-judged-against-a-total the falsifier: no statement joins one of its card-count
//                                    bindings to a total by a comparison operator.
//   no-card-count                    the falsifier: no card query is reduced to a number at all.
//
// Comment-stripped at the READER, and that is load-bearing rather than hygiene here: this very file
// and the ledger beside it quote «pager absent while 18 > 12 shown» in prose, and several of the
// instruments explain the contract in a header. A raw grep would be satisfied by the explanation of
// the bug it is meant to forbid. M10 proves the decoy does not fool it.
//
//   node --experimental-strip-types scripts/verify-live-card-counts-walk-the-cascade.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  LEDGER, VERDICTS, parseLedger, rowProblems, ledgerProblems,
  type Row,
} from './lib/cardCountSites.ts';

const ROOT = join(import.meta.dirname, '..');
const SEARCH_ROOTS = ['scripts', 'e2e'];

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
/** A mutation proof: the real regression put back into the real source, asserted to go RED. */
const mustCatch = (label: string, problems: string[], detail = 'the audit passed deliberately broken input') =>
  check(`(mutation) catches ${label}`, problems.length > 0, detail);

// ── the product's own prefix, read from the product ─────────────────────────────────────────────
// Never retyped: the testID template lives in ResultCard.tsx and the day it changes this barrier
// must follow it or say it cannot (fail closed), not quietly discover nothing.
const RESULT_CARD = 'src/components/ResultCard.tsx';
function cardPrefixFromProduct(src: string): string | null {
  return /testID=\{`(card-listing-)\$\{/.exec(src)?.[1] ?? null;
}

// ── discovery ───────────────────────────────────────────────────────────────────────────────────
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
    }
  };
  walk(join(ROOT, root));
  return out;
}
const relPath = (abs: string) => relative(ROOT, abs).split(sep).join('/');
const readRepo = (p: string) => readFileSync(join(ROOT, p), 'utf8');

export function discover(files: string[], read: (p: string) => string, prefix: string, self: string): string[] {
  return files
    .filter((p) => p !== self && p !== LEDGER)
    .filter((p) => stripComments(read(p)).includes(prefix))
    .sort();
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const SELF = 'scripts/verify-live-card-counts-walk-the-cascade.ts';
const prefix = cardPrefixFromProduct(readRepo(RESULT_CARD));
check(`the card testID prefix is read from ${RESULT_CARD}, not retyped here`, prefix != null,
  'the product\'s testID template could not be located — UNKNOWN, never a discovery of nothing');
if (prefix == null) { console.log('\n❌ cannot proceed without the product\'s own prefix\n'); process.exit(1); }

const allFiles = SEARCH_ROOTS.flatMap(sourceFiles).map(relPath);
const discovered = discover(allFiles, readRepo, prefix, SELF);
const { rows, problems: parseBad } = parseLedger(readRepo(LEDGER));
for (const p of parseBad) check(p, false);

console.log(`\n  card-reading instruments discovered: ${discovered.length} · ledger rows: ${rows.length}`);
for (const r of rows) console.log(`    ${r.verdict.padEnd(32)} ${r.path}`);

const live = ledgerProblems(discovered, rows, readRepo, prefix, stripComments);
console.log('');
check('every instrument that reads result cards is classified, and every classification holds',
  live.length === 0, `\n      ${live.join('\n      ')}`);

const walkers = rows.filter((r) => r.verdict === 'walks-the-cascade');
check('at least one instrument really does compare a count to a total and walk first '
  + '(otherwise this barrier is green because nothing exercises it)', walkers.length > 0);

check('npm test discovers and runs this check',
  npmTestRuns(ROOT, 'verify-live-card-counts-walk-the-cascade'), 'not in the resolved run set');

// ── MUTATION PROOFS — each is a real regression applied to the REAL shipped source ───────────────
console.log('\n  mutation proofs (each must turn the rule RED):');
const CHAIN = 'scripts/redteam-chain-live.mjs';
const GUARDIAN = 'e2e/guardian/journeys.mjs';
const FIXTURE = 'scripts/verify-af-offer-click-lands.ts';
const rowOf = (p: string) => rows.find((r) => r.path === p)!;
const codeOf = (p: string) => stripComments(readRepo(p));
const withReader = (over: Record<string, string>) => (p: string) => (p in over ? over[p] : readRepo(p));

// M1 — the ops_incident #699 defect itself: read the arrival screenful, never scroll.
{
  const raw = readRepo(CHAIN);
  const mutated = raw.replace(/const walked = await revealAll\(page[^)]*\);/, 'const walked = 0;')
    .replace(/async function revealAll\(page[\s\S]*?\n\}\n/, '');
  check('M1 applied', mutated !== raw, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('the #699 defect restored: the chain reads the arrival screenful and never walks the cascade',
    rowProblems(rowOf(CHAIN), stripComments(mutated), prefix));
}
// M2 — the number re-typed instead of imported from the product.
{
  const raw = readRepo(CHAIN);
  const mutated = raw.replace(/import \{ CASCADE_MAX \} from '\.\.\/src\/lib\/initialReveal\.ts';/,
    'const CASCADE_MAX = 12;');
  check('M2 applied', mutated !== raw, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('CASCADE_MAX re-typed as a literal instead of imported from the product',
    rowProblems(rowOf(CHAIN), stripComments(mutated), prefix));
}
// M3 — the walk moved AFTER the comparison it is supposed to precede.
{
  const code = codeOf(CHAIN);
  const lines = code.split('\n');
  const walkAt = lines.findIndex((l) => /await revealAll\(page/.test(l));
  const moved = [...lines.slice(0, walkAt), ...lines.slice(walkAt + 1), lines[walkAt]].join('\n');
  check('M3 applied', walkAt >= 0 && moved !== code, 'no revealAll call found to move');
  mustCatch('the cascade walk moved to AFTER the comparison — a walk after the read is not a walk',
    rowProblems(rowOf(CHAIN), moved, prefix));
}
// M4 — the class recurring in a DIFFERENT instrument: a settling-only counter starts judging a total.
{
  const raw = readRepo(GUARDIAN);
  const mutated = raw.replace('if (after.cards > 0) bad.push(',
    'if (after.cards < after.countChip) bad.push(`pager absent while ${after.countChip} > ${after.cards} shown`);\n    if (after.cards > 0) bad.push(');
  check('M4 applied', mutated !== raw, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('the class recurring in a guardian journey: a settling-only count starts being compared to the count chip',
    rowProblems(rowOf(GUARDIAN), stripComments(mutated), prefix));
}
// M5 — a `no-card-count` fixture growing a real count.
{
  const raw = readRepo(FIXTURE);
  const mutated = `${raw}\nconst onScreen = document.querySelectorAll('[data-testid^="card-listing-"]').length;\n`;
  mustCatch('a file classified no-card-count that starts counting cards',
    rowProblems(rowOf(FIXTURE), stripComments(mutated), prefix));
}
// M6 — a brand-new instrument that nobody classified (the enumerate-vs-discover gap itself).
{
  const NEW = 'scripts/verify-a-brand-new-live-instrument.ts';
  mustCatch('a NEW card-reading instrument with no row in the ledger',
    ledgerProblems([...discovered, NEW].sort(), rows, withReader({ [NEW]: 'x' }), prefix, stripComments));
}
// M7 — a STALE row: the ledger claiming coverage of a file that no longer reads cards.
{
  const GONE = 'scripts/verify-a-retired-instrument.ts';
  mustCatch('a STALE ledger row whose file no longer reads result cards',
    ledgerProblems(discovered, [...rows, { path: GONE, verdict: 'no-card-count', why: 'a row that outlived its file and still counts as coverage' }],
      withReader({ [GONE]: '// nothing here reads a card\n' }), prefix, stripComments));
}
// M8 — fail CLOSED: a listed file the reader cannot read is UNKNOWN, never green.
{
  const UNREADABLE = 'scripts/verify-unreadable.ts';
  const reader = (p: string) => { if (p === UNREADABLE) throw new Error('ENOENT'); return readRepo(p); };
  mustCatch('a ledger row whose file cannot be read (UNKNOWN, never a quiet pass)',
    ledgerProblems(discovered, [...rows, { path: UNREADABLE, verdict: 'no-card-count', why: 'a file the reader cannot open must not read as healthy' }], reader, prefix, stripComments));
}
// M9 — the ledger's own grammar: a verdict nobody defined must not pass as one.
mustCatch('a ledger row carrying an undefined verdict',
  parseLedger(`scripts/x.ts | probably-fine | it looked alright to somebody once`).problems);

// M10 — THE DECOY. The instruments explain this very contract in their headers; a raw reader would
// be satisfied by the prose describing the bug it forbids.
{
  const raw = readRepo(CHAIN);
  const mutated = raw.replace(/const walked = await revealAll\(page[^)]*\);/,
    '// const walked = await revealAll(page); // scrollBy CASCADE_MAX — walked the cascade\n    const walked = 0;')
    .replace(/async function revealAll\(page[\s\S]*?\n\}\n/, '');
  check('M10 applied', mutated !== raw, 'pattern drifted — fix the mutant, not the rule');
  mustCatch('the walk deleted but left behind as a COMMENT claiming it is still there',
    rowProblems(rowOf(CHAIN), stripComments(mutated), prefix));
}

// ── NEGATIVE CONTROLS — the predicate is not red for everything ──────────────────────────────────
console.log('\n  negative controls (the shipped tree must NOT be flagged):');
check('the tree as it actually stands is clean', ledgerProblems(discovered, rows, readRepo, prefix, stripComments).length === 0);
for (const r of rows) {
  check(`  ${r.path} as shipped is not flagged`, rowProblems(r, codeOf(r.path), prefix).length === 0,
    rowProblems(r, codeOf(r.path), prefix).join(' | '));
}

console.log(failures === 0
  ? '\n✅ every instrument that reads result cards is classified, and no classification reads better than the tree\n'
  : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
