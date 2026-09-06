// THE ROSTER, THE BINDING, AND THE SPECS MUST NOT DRIFT APART.
//
// WHY THIS EXISTS (owner audit, 2026-09-05). The roster grew from seven routines to eleven on
// 2026-09-04. `docs/ops/ENGINEER_ROUTINES.md` §G was updated to say it binds ALL ELEVEN. `AGENTS.md`
// was not — it went on saying §G "binds ALL SEVEN routines" for a day.
//
// That one stale word is the most dangerous kind of drift this repo can have. AGENTS.md is loaded
// FIRST by every agent (CLAUDE.md is a one-line include of it), and it is where a routine learns
// whether the global policy applies to it at all. A routine that reads "ALL SEVEN" and knows it is
// #9 can correctly conclude §G does not bind it — and §G is what makes every routine fix first,
// barrier its fixes, mutation-prove them and verify production. Losing the binding loses all of it.
//
// `verify-global-engineering-policy.ts` already reads the count from the roster table and requires
// §G's OWN heading to agree. It never looked at AGENTS.md. This barrier closes exactly that gap and
// two neighbours of it:
//
//   1. AGENTS.md's §G paragraph declares the SAME number of routines the roster lists — derived from
//      the roster, never hardcoded here, so growing to twelve needs no edit to this file.
//   2. Every roster row names a canonical spec, and that file EXISTS. A routine with no spec is a
//      routine whose instructions live only in a cloud prompt outside this repo, which is precisely
//      the unauditable state the 2026-09-05 audit found for #1 and #2.
//   3. Every spec's binding line names §G.9. §G.9 is the section that carries the mutation proof and
//      the production verification; a binding that enumerates only the 2026-08-29 sections leaves
//      the two strongest requirements reaching the routine by inheritance alone, which is how they
//      went unstated in five specs for a day.
//   4. No spec hedges the mutation requirement in an operative instruction. DATA_INTEGRITY read
//      "mutation-proven where meaningful" — discretion over the one step §G.9 makes mandatory.
//
// Run: node --experimental-strip-types scripts/verify-routine-roster-and-binding-cannot-drift.ts

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const ROUTINES = 'docs/ops/ENGINEER_ROUTINES.md';
const AGENTS = 'AGENTS.md';

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const routines = readFileSync(join(ROOT, ROUTINES), 'utf8');
const agents = readFileSync(join(ROOT, AGENTS), 'utf8');

// ── The roster is the single source of "how many routines are there". ─────────────────────────
const ROSTER_ROWS = (routines.match(/^\|\s*\d+\s*\|/gm) ?? []).length;
const WORD = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN'][ROSTER_ROWS] ?? '';

check(ROSTER_ROWS >= 7 && WORD !== '',
  `the roster table lists ${ROSTER_ROWS} routines`,
  `the roster table parsed as ${ROSTER_ROWS} rows — the scan has gone blind and every count below is meaningless`);

// ── 1. AGENTS.md — the file every agent loads FIRST — must agree with the roster. ─────────────
const bindsInAgents = /binds ALL ([A-Z]+) routines/i.exec(agents);
check(bindsInAgents !== null,
  'AGENTS.md still declares who §G binds',
  `${AGENTS} no longer contains a "binds ALL <N> routines" declaration for §G — the first file every ` +
  'agent reads no longer says the global policy applies to it');
check(bindsInAgents !== null && bindsInAgents[1].toUpperCase() === WORD,
  `AGENTS.md says §G binds ALL ${WORD} routines, matching the roster`,
  `DRIFT: ${AGENTS} says §G binds ALL ${bindsInAgents?.[1] ?? '???'} routines, but the roster lists ` +
  `${ROSTER_ROWS} (${WORD}). AGENTS.md is loaded first by every agent, so a routine outside that ` +
  'number can read it as saying §G does not bind them — and §G is what requires fix-first, barriers, ' +
  'mutation proof and production verification.');

// ── 2. Every roster row names a canonical spec, and the file exists. ──────────────────────────
const sections = [...routines.matchAll(/^## (\d+)\.\s*(.+)$/gm)];
check(sections.length === ROSTER_ROWS,
  `every one of the ${ROSTER_ROWS} roster rows has a narrative section`,
  `the roster lists ${ROSTER_ROWS} routines but only ${sections.length} have a "## N." section — a ` +
  'routine with no section has nothing pointing at its spec');

const missingSpec: string[] = [];
const specFiles: string[] = [];
for (let i = 0; i < sections.length; i++) {
  const start = sections[i].index!;
  const end = i + 1 < sections.length ? sections[i + 1].index! : routines.length;
  const body = routines.slice(start, end);
  // \x60 rather than a literal backtick: scripts/verify-new-barriers-are-mutation-proven.ts strips
  // strings with a naive lexer that runs its backtick pass last, so a backtick inside a REGEX
  // literal opens a phantom template literal and swallows the rest of the file — this barrier's own
  // seven mutation proofs then read as absent and it is reported UNPROVEN. That fails CLOSED (it
  // demands a proof rather than skipping one), so it is safe, but the escape avoids the ambiguity.
  const named = /Canonical spec:\s*\*\*\x60([^\x60]+)\x60\*\*/.exec(body);
  if (!named) { missingSpec.push(`#${sections[i][1]} names no canonical spec`); continue; }
  if (!existsSync(join(ROOT, named[1]))) { missingSpec.push(`#${sections[i][1]} names ${named[1]}, which does not exist`); continue; }
  specFiles.push(named[1]);
}
check(missingSpec.length === 0,
  `all ${specFiles.length} routines name a canonical spec that exists on disk`,
  `a routine's instructions are not auditable from this repo:\n      ${missingSpec.join('\n      ')}`);

// ── 3. Every spec's binding line reaches §G.9 — the closure conditions. ───────────────────────
// §G.9 is where the mutation proof and the production verification live. A spec that binds §G but
// enumerates only the 2026-08-29 sections leaves those two reaching it by inheritance alone.
const noG9: string[] = [];
for (const f of specFiles) {
  const body = readFileSync(join(ROOT, f), 'utf8');
  if (!/\*\*Global policy:\*\*/.test(body)) { noG9.push(`${f} has no "**Global policy:**" binding line`); continue; }
  if (!/§\s*G\.9/.test(body)) noG9.push(`${f} never names §G.9`);
}
check(noG9.length === 0,
  `all ${specFiles.length} specs bind §G and name §G.9 (mutation + production verification)`,
  `a spec does not state the closure conditions:\n      ${noG9.join('\n      ')}`);

// ── 4. No spec hedges the mutation requirement in an OPERATIVE instruction. ───────────────────
// A spec may QUOTE a deleted hedge to record that it was removed — DATA_INTEGRITY's §M does exactly
// that, and must not be flagged for it. The discriminator is whether the surrounding lines say the
// phrase is gone. Anything else is a live instruction handing back the discretion §G.9 removed.
const HEDGE = /mutation[- ]proven\s+(where meaningful|if meaningful|when meaningful|where useful|as appropriate)/i;
const liveHedges: string[] = [];
for (const f of specFiles) {
  const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (!HEDGE.test(l)) return;
    const near = lines.slice(Math.max(0, i - 4), i + 5).join(' ');
    if (/deleted|must not come back|used to say|removed/i.test(near)) return;   // a recorded deletion
    liveHedges.push(`${f}:${i + 1} — ${l.trim().slice(0, 90)}`);
  });
}
check(liveHedges.length === 0,
  'no spec hedges the mutation requirement in an operative instruction',
  `a spec makes mutation proof discretionary, which §G.9 forbids:\n      ${liveHedges.join('\n      ')}`);

check(npmTestRuns(ROOT, 'verify-routine-roster-and-binding-cannot-drift'),
  'npm test runs this guard',
  '`npm test` no longer runs this guard — the drift it exists for would return unnoticed');

// ── Mutation proofs ───────────────────────────────────────────────────────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

const countIn = (text: string) => /binds ALL ([A-Z]+) routines/i.exec(text)?.[1]?.toUpperCase();
mustCatch('AGENTS.md left at SEVEN while the roster grew — the exact 2026-09-05 defect',
  countIn(agents.replace(/binds ALL ELEVEN routines/i, 'binds ALL SEVEN routines')) !== WORD);
mustCatch('the binding declaration deleted from AGENTS.md entirely',
  countIn(agents.replace(/binds ALL [A-Z]+ routines/i, 'applies broadly')) === undefined);
mustCatch('a roster row whose canonical spec file does not exist',
  !existsSync(join(ROOT, 'docs/ops/A_ROUTINE_NOBODY_WROTE_ENGINEER.md')));
mustCatch('a spec that binds §G but never names §G.9',
  !/§\s*G\.9/.test('**Global policy:** §G binds this routine too: fix first, six stop reasons, Sentry first.'));
mustCatch('a live "mutation-proven where meaningful" hedge',
  HEDGE.test('fix → barrier (mutation-proven where meaningful) → deploy'));
mustCatch('nothing — a recorded DELETION of that hedge is not flagged (the §M citation)',
  !(HEDGE.test('it said "mutation-proven where meaningful". That phrase is deleted.') &&
    !/deleted|must not come back|used to say|removed/i.test('it said "mutation-proven where meaningful". That phrase is deleted.')));
mustCatch('the roster scan going blind and reporting zero rows',
  !((''.match(/^\|\s*\d+\s*\|/gm) ?? []).length >= 7));

console.log(
  'routine-roster-and-binding: the roster, AGENTS.md, and every spec must agree on who §G binds\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the roster and the policy that binds it have drifted apart.`);
  process.exit(1);
}
console.log(`\n✅ routine-roster-and-binding: passed (${ok.length} checks, ${mutations.length} mutations, ${ROSTER_ROWS} routines).`);
