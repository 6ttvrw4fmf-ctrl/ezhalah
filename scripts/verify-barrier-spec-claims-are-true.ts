// A SPEC'S COVERAGE CLAIM IS A CLAIM, AND CLAIMS GET EXECUTED.
//
// WHY THIS EXISTS (2026-09-11, routine #10). `docs/ops/BARRIER_ENGINEER.md` §0.1 and PART 3 named
// three barriers as "each verified still text-only and still grandfathered" and handed them to this
// routine as its day-one backlog. On 2026-09-11 all three were measured: every one had already left
// `scripts/mutation-proof-grandfathered.txt` and every one already carried `mustCatch(...)` proofs.
// The backlog had been finished and the spec never noticed.
//
// That is exactly the defect PART 1.11 of that same file describes — "documentation that names a
// barrier which does not exist… a pointer reads as coverage" — committed by the spec that defines
// it, in the opposite direction: not a barrier that does not exist, but a coverage STATE that is no
// longer true. Both send a reader to the wrong place. A routine reading the stale paragraph spends
// its run re-doing finished work, and — worse — trusts a list of "known blind guards" that has
// silently stopped matching the ratchet.
//
// Prose cannot be kept honest by remembering to update it, so this check executes it instead: every
// file the spec names as grandfathered must ACTUALLY be in the list, and every file it describes as
// repaired or departed must ACTUALLY be out of it. Both directions, because either lie is a lie.
//
// Scope is deliberately narrow: only the two claim shapes above, only over docs that make them. A
// broader "does this sentence describe the code" reader would be an unfalsifiable check, which is
// the very anti-pattern this routine exists to remove.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(root, 'scripts', 'mutation-proof-grandfathered.txt');

// Docs that make grandfather claims. Adding one here is how a new spec gets held to the same rule.
const DOCS = ['docs/ops/BARRIER_ENGINEER.md', 'AGENTS.md', 'docs/ops/ENGINEER_ROUTINES.md']
  .filter((d) => existsSync(join(root, d)));

const BARRIER = /`?(scripts\/)?(verify-[a-z0-9-]+\.(?:ts|mjs))`?/g;

/**
 * The predicate, pure so the mutation proofs below can feed it a broken world.
 *
 * A claim is read per LINE (the unit a writer actually edits). A line that says a named barrier is
 * grandfathered asserts membership; a line that says it was repaired / has left the list / is
 * mutation-proven asserts non-membership. A line saying neither makes no claim and is ignored — the
 * check must not invent claims nobody made.
 */
export function specClaimProblems(
  lines: { doc: string; n: number; text: string }[],
  grandfathered: Set<string>,
  onDisk: Set<string>,
): string[] {
  const problems: string[] = [];
  for (const { doc, n, text } of lines) {
    // THE CLAIM MUST BE MADE IN PROSE, NOT BY A CODE IDENTIFIER THAT HAPPENS TO CONTAIN THE WORD.
    // Caught on this check's first run: PART 3's line "…its size is pinned by `GRANDFATHERED_CEILING`
    // in `scripts/verify-new-barriers-are-mutation-proven.ts`…" names the RATCHET as the location of
    // a constant, and the word "grandfather" comes only from that constant's NAME. Reading it as
    // "this barrier is grandfathered" is a false positive, and the honest repair is to make the
    // reader distinguish prose from code rather than to drop the line — a backticked
    // ALL_CAPS identifier or file path is machinery being pointed at, never an assertion about
    // membership. Barrier NAMES are still extracted from the original text, so a real claim sitting
    // on the same line as an identifier is still caught (mutation-proven below, both directions).
    const prose = text
      .replace(/`[A-Z][A-Z0-9_]{2,}`/g, ' ')
      .replace(/`[^`]*\.(?:ts|mjs|cjs|txt|sql|json|sh|ya?ml)`/g, ' ');
    const says = (re: RegExp) => re.test(prose);
    // "still grandfathered", "is grandfathered", "grandfathered:" …
    const claimsIn = says(/grandfather/i) && !says(/left the grandfather|out of the grandfather|leave the (?:list|grandfather)|no longer grandfathered|can leave/i);
    const claimsOut = says(/left the grandfather list|no longer grandfathered|out of the grandfather list/i);
    if (!claimsIn && !claimsOut) continue;
    // A line that only talks ABOUT the list (its ceiling, its direction) names no barrier; skip.
    for (const m of text.matchAll(BARRIER)) {
      const name = m[2];
      if (!onDisk.has(name)) continue;            // a phantom is verify-docs-name-real-barriers.ts's job
      const listed = grandfathered.has(name);
      if (claimsOut && listed) {
        problems.push(`${doc}:${n} says ${name} has LEFT the grandfather list, but it is still in it`);
      } else if (claimsIn && !claimsOut && !listed) {
        problems.push(`${doc}:${n} describes ${name} as grandfathered, but it is NOT in the list — the claim is stale, and a routine reading it re-does finished work`);
      }
    }
  }
  return problems;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nA spec\'s grandfather claims are executed against the actual list\n');

check('the grandfather list is readable', existsSync(LIST),
  'without it every claim in every spec would read as true — the check must fail closed, not pass');
if (!existsSync(LIST)) { console.error('\n✗ cannot verify any claim\n'); process.exit(1); }

const grandfathered = new Set(
  readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
);
const onDisk = new Set(
  readdirSync(join(root, 'scripts')).filter((f) => /^verify-.*\.(ts|mjs)$/.test(f)),
);

check('at least one doc making grandfather claims was found', DOCS.length > 0,
  'the readers went missing — this check would then be vacuously green');

const lines: { doc: string; n: number; text: string }[] = [];
for (const doc of DOCS) {
  readFileSync(join(root, doc), 'utf8').split('\n')
    .forEach((text, i) => lines.push({ doc, n: i + 1, text }));
}

const problems = specClaimProblems(lines, grandfathered, onDisk);
check(`every grandfather claim in ${DOCS.length} doc(s) matches the list (${grandfathered.size} names)`,
  problems.length === 0, problems.join('\n      '));

// ── mutation proofs — the predicate is watched to fail, in BOTH directions ───────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const disk = new Set(['verify-a.ts', 'verify-b.ts']);
const L = (text: string) => [{ doc: 'spec.md', n: 1, text }];

mustCatch('the EXACT defect this was written for: a spec calling a barrier grandfathered after it left the list',
  specClaimProblems(L('`verify-a.ts` is still text-only and still grandfathered.'),
    new Set<string>(), disk).length === 1);
mustCatch('the mirror lie: a spec claiming a barrier LEFT the list while it is still in it',
  specClaimProblems(L('`verify-a.ts` has left the grandfather list.'),
    new Set(['verify-a.ts']), disk).length === 1);
mustCatch('a stale claim about the SECOND barrier on a line naming two',
  specClaimProblems(L('`verify-a.ts` and `verify-b.ts` are both grandfathered.'),
    new Set(['verify-a.ts']), disk).length === 1);

// Negative controls — a barrier red for everything is as useless as one green for everything.
mustCatch('…while a TRUE "still grandfathered" claim is NOT flagged',
  specClaimProblems(L('`verify-a.ts` is still grandfathered.'),
    new Set(['verify-a.ts']), disk).length === 0);
mustCatch('…and a TRUE "has left the list" claim is NOT flagged',
  specClaimProblems(L('`verify-a.ts` has left the grandfather list.'),
    new Set<string>(), disk).length === 0);
mustCatch('…and a line naming a barrier but making NO grandfather claim invents none',
  specClaimProblems(L('`verify-a.ts` covers the price path.'),
    new Set<string>(), disk).length === 0);
mustCatch('…and prose about the LIST ITSELF, naming no barrier, is not a claim about one',
  specClaimProblems(L('The grandfather list may only shrink, and its size is pinned by a ceiling.'),
    new Set<string>(), disk).length === 0);
// The prose-vs-identifier distinction, proven in BOTH directions (it was added to fix a real false
// positive, and an over-broad repair that silenced real claims would be the worse defect).
mustCatch('…and a barrier named only as the LOCATION of `GRANDFATHERED_CEILING` is not a membership claim',
  specClaimProblems(L('its size is pinned by `GRANDFATHERED_CEILING` in `verify-a.ts` so adding a name is reviewed.'),
    new Set<string>(), disk).length === 0);
mustCatch('…while a REAL claim sharing a line with that identifier is still caught (the repair did not go blind)',
  specClaimProblems(L('`GRANDFATHERED_CEILING` pins the size; `verify-a.ts` is still grandfathered today.'),
    new Set<string>(), disk).length === 1);
mustCatch('…and a real claim naming the list FILE alongside the barrier is still caught',
  specClaimProblems(L('`scripts/mutation-proof-grandfathered.txt` still grandfathers `verify-a.ts`.'),
    new Set<string>(), disk).length === 1);

mustCatch('…and a barrier named in a doc but absent from disk is left to the phantom-citation check',
  specClaimProblems(L('`verify-deleted.ts` is still grandfathered.'),
    new Set<string>(), disk).length === 0);

// Fail-closed: an empty corpus must not read as "no problems found" (A FAILED FETCH IS NOT AN EMPTY
// ANSWER applies to a barrier's own reads). The corpus check above is what enforces it; this pins
// that the predicate itself reports nothing rather than pretending, so the two cannot be confused.
mustCatch('an empty corpus producing no findings — which is why DOCS.length is checked separately',
  specClaimProblems([], new Set<string>(), disk).length === 0);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ every grandfather claim a spec makes is true of the actual list\n');
