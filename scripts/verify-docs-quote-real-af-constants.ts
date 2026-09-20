// PERMANENT BARRIER — A TUNING CONSTANT WRITTEN INTO A DOC IS A CLAIM, AND CLAIMS GET EXECUTED.
//
// THE DEFECT THIS EXISTS FOR, measured 2026-09-20 (routine #5, AF + Trending).
// On 2026-09-04 the owner raised the Advanced Filter stop line from 25 to 50; on 2026-09-19 PR #3383
// ("Advanced Filter: Skip never triggers a popup, and the stop line returns to 25") DELIBERATELY put
// it back. `src/lib/afRanking.ts` and both canonical contracts moved with it —
// `ADVANCED_FILTER_PRODUCT_CONTRACT.md` §15 carries 25 and `ADVANCED_FILTER_DESIGN_CONTRACT.md` even
// marks it "frozen, unchanged". Two ROUTINE SPECS did not:
//
//   docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md  "the 10%-OR-≤50 usefulness rule
//                                                     (INTERVIEW_STOP_AT, raised from 25 …)"
//   docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md  harness note 14: "`INTERVIEW_STOP_AT = 50`"
//   docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md         "(≤ `INTERVIEW_STOP_AT` = 50)"
//
// The first of those is in the file a routine is told to READ FIRST, every run. It cost this run real
// time: the stale 50 read as a contract-vs-production conflict under §0.1 — an owner product rule the
// code had silently dropped — and the investigation that disproved it had to go through git history.
// Worse is the case that did NOT happen this time: a journey sized to "> 50" per harness note 14 would
// pick options against a floor 25 too high and report a CORRECT production as broken, which is the
// documented five-times-repeated failure mode of this exact surface.
//
// This is the `verify-af-worked-examples-are-true.ts` rule (a worked example in a comment is a claim)
// pointed at the OTHER half of the repo. That barrier parses `[N=…, k=… -> qualifies]` examples out of
// `src/`; nothing anywhere read a NUMBER out of a `docs/` sentence and compared it to the constant it
// names. So the code could move and every doc stating the old value stayed green forever.
//
// WHAT THIS ASSERTS. Every canonical doc that writes `<CONSTANT> = <number>` (or the markdown table
// form `| \`<CONSTANT>\` | <number> |`) for a constant EXPORTED BY src/lib/afRanking.ts must quote the
// value that module really exports. The constants are IMPORTED and read at run time — never regexed —
// so renaming or re-valuing one is picked up here for free.
//
// SCOPE — canonical rule sources only. AGENTS.md's own reading order names them: AGENTS.md, CLAUDE.md,
// docs/*.md and the top level of docs/ops/. DATED SUBDIRECTORIES ARE DELIBERATELY EXCLUDED: AGENTS.md
// calls those "point-in-time snapshots kept for provenance", and a run report that records what the
// constant was on the day it was written is correct history, not drift. Judging them would make this
// barrier cry wolf forever, which is how a barrier gets switched off.
//
//   node --experimental-strip-types scripts/verify-docs-quote-real-af-constants.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as AF from '../src/lib/afRanking.ts';

const root = join(import.meta.dirname, '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── the constants, READ OFF THE REAL MODULE ────────────────────────────────────────────────────
// Everything numeric afRanking exports. Derived, never listed, so a constant added tomorrow is
// covered without anyone registering it here.
const CONSTANTS: Record<string, number> = Object.fromEntries(
  Object.entries(AF).filter(([k, v]) => typeof v === 'number' && /^[A-Z][A-Z0-9_]*$/.test(k)),
) as Record<string, number>;

check('afRanking exports numeric constants this barrier can judge', Object.keys(CONSTANTS).length >= 5,
  `found: ${Object.entries(CONSTANTS).map(([k, v]) => `${k}=${v}`).join(', ')}`);
check('INTERVIEW_STOP_AT is among them (the constant this barrier was born for)',
  typeof CONSTANTS.INTERVIEW_STOP_AT === 'number', `got ${CONSTANTS.INTERVIEW_STOP_AT}`);

// ── THE PREDICATE — now shared, so the src/ half cannot drift from this one ─────────────────────
// Moved to scripts/lib/afConstantClaims.ts on 2026-09-20 (routine #9) when a SECOND barrier began
// executing it over src/ comments. Re-exported here so existing importers keep working.
export { constantClaims, wrongClaims, type Claim } from './lib/afConstantClaims.ts';
import { constantClaims, wrongClaims, type Claim } from './lib/afConstantClaims.ts';

// ── MUTATION PROOFS — the predicate is EXECUTED, both directions ───────────────────────────────
// A barrier that only ever sees a clean tree proves nothing about what it would catch. Each proof
// below feeds the REAL predicate a document it must judge, and asserts the verdict it must reach.
const K = { INTERVIEW_STOP_AT: 25, MEANINGFUL_NARROWING_FRACTION: 0.1 };

/** A defect this barrier must catch: `caught` is what the real predicate actually returned. */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`mutation — ${label}`, caught, detail);

const rightDoc = [
  'the stop line is `INTERVIEW_STOP_AT` = 25 today',
  '| `INTERVIEW_STOP_AT` | 25 | src/lib/afRanking.ts |',
  'the gate uses INTERVIEW_STOP_AT (25) as its floor',
].join('\n');
mustCatch('a doc quoting the REAL value is left clean (no false red)',
  wrongClaims(constantClaims(rightDoc, K), K).length === 0,
  JSON.stringify(wrongClaims(constantClaims(rightDoc, K), K)));

// The exact three sentences that were live in this repo on 2026-09-20, verbatim.
const staleDoc = [
  'R4.3.1/R11.1 stop the interview at `INTERVIEW_STOP_AT = 50` (owner product rule 2026-09-04)',
  '  production-verification condition, because reaching its terminal (≤ `INTERVIEW_STOP_AT` = 50) chat',
  '| `INTERVIEW_STOP_AT` | 50 | src/lib/afRanking.ts |',
].join('\n');
const caught = wrongClaims(constantClaims(staleDoc, K), K);
mustCatch('the three REAL stale sentences of 2026-09-20 are all caught', caught.length === 3,
  `caught ${caught.length}: ${JSON.stringify(caught.map((c) => `${c.name}=${c.claimed}@L${c.line}`))}`);

const fractionDoc = '`MEANINGFUL_NARROWING_FRACTION` = 0.25 is the floor';
mustCatch('a wrong NON-INTEGER constant is caught too',
  wrongClaims(constantClaims(fractionDoc, K), K).length === 1,
  JSON.stringify(wrongClaims(constantClaims(fractionDoc, K), K)));

// PROSE MUST NOT FIRE. This is the half that keeps the barrier alive: every one of these sentences
// is TRUE history about a constant whose value is now 25, and flagging them would be a false red.
const proseDoc = [
  'INTERVIEW_STOP_AT, raised from 25 by the owner product rule of 2026-09-04',
  'it was briefly 50 between 2026-09-04 and PR #3383, which returned INTERVIEW_STOP_AT to 25',
  'the owner chose 25 over 30 for INTERVIEW_STOP_AT',
  'examples written against INTERVIEW_STOP_AT = 25 silently became false at 50',
].join('\n');
const proseHits = wrongClaims(constantClaims(proseDoc, K), K);
mustCatch('historical prose about the constant is NOT flagged', proseHits.length === 0,
  `false positives: ${JSON.stringify(proseHits.map((c) => c.text))}`);

// R5.4.1's real shape: the LIVE value asserted plainly, the superseded one quoted inside ~~…~~.
// The live half must still be judged, so a struck line is not a blanket exemption.
const struckOk = '- **R5.4.1** — `INTERVIEW_STOP_AT` = 25 **(was `50`)**: ~~"`INTERVIEW_STOP_AT = 50`: the old line."~~';
mustCatch('a superseded value quoted in ~~strikethrough~~ is NOT flagged',
  wrongClaims(constantClaims(struckOk, K), K).length === 0,
  JSON.stringify(wrongClaims(constantClaims(struckOk, K), K)));
// R5.4.1's REAL shape in the tree: the span opens on one line and closes two lines later.
const struckMultiline = [
  '- **R5.4.1** — `INTERVIEW_STOP_AT` = 25 **(owner correction; was `50`)**: a single-select',
  '  question survives. ~~"`INTERVIEW_STOP_AT = 50`: the old line',
  '  spanning three lines."~~ The owner reversed this the day after.',
].join('\n');
const mlHits = wrongClaims(constantClaims(struckMultiline, K), K);
mustCatch('a MULTI-LINE ~~strikethrough~~ span is not flagged either',
  mlHits.length === 0, JSON.stringify(mlHits.map((c) => `${c.name}=${c.claimed}@L${c.line}`)));

const struckBad = '- `INTERVIEW_STOP_AT` = 50 today ~~(we used to say 25)~~';
mustCatch('a WRONG live value on a line that ALSO has strikethrough is still caught',
  wrongClaims(constantClaims(struckBad, K), K).length === 1,
  JSON.stringify(wrongClaims(constantClaims(struckBad, K), K)));

// ── THE LIVE ASSERTION — every canonical doc in the tree ───────────────────────────────────────
const canonical: string[] = [];
for (const f of ['AGENTS.md', 'CLAUDE.md']) if (existsSync(join(root, f))) canonical.push(f);
for (const dir of ['docs', 'docs/ops']) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  // TOP LEVEL ONLY — dated run-report subdirectories are provenance, per AGENTS.md.
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    if (e.endsWith('.md') && statSync(p).isFile()) canonical.push(`${dir}/${e}`);
  }
}
check('the canonical doc set is non-empty and includes both AF contracts',
  canonical.includes('docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md')
  && canonical.includes('docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md'),
  `${canonical.length} docs scanned`);

let claimCount = 0;
const offenders: string[] = [];
for (const rel of canonical) {
  const claims = constantClaims(readFileSync(join(root, rel), 'utf8'), CONSTANTS);
  claimCount += claims.length;
  for (const c of wrongClaims(claims, CONSTANTS)) {
    offenders.push(`${rel}:${c.line} claims ${c.name} = ${c.claimed}, but src/lib/afRanking.ts exports ${CONSTANTS[c.name]}\n        ${c.text}`);
  }
}
check('every canonical doc quotes the REAL value of every afRanking constant it names',
  offenders.length === 0, offenders.join('\n      '));
// A predicate that matches nothing would pass this file forever while asserting nothing.
check('the scan actually found constant claims to judge (the barrier is not a no-op)',
  claimCount >= 3, `${claimCount} claim(s) across ${canonical.length} canonical docs`);

if (failures) { console.error(`\n✗ verify-docs-quote-real-af-constants FAILED (${failures})\n`); process.exit(1); }
console.log(`\n✓ ${claimCount} constant claim(s) across ${canonical.length} canonical docs all match src/lib/afRanking.ts.`);
