// GLOBAL ENGINEERING POLICY (§G) standing guard — owner rule, 2026-08-29.
//
// Sibling of scripts/verify-data-integrity-contract.ts and
// scripts/verify-journey-seam-engineer-contracts.ts, built to the same shape for the same reason:
// §G of docs/ops/ENGINEER_ROUTINES.md is what makes all SEVEN routines finish their own work
// instead of handing safely fixable defects back to the owner, and a routine prompt lives outside
// this repo and drifts. The file wins — but only while something checks the file.
//
// The gap §G closes, stated plainly so a later editor knows what they are deleting: on 2026-08-29
// every one of the seven routines had the Sentry MCP connector attached and NOT ONE of their
// prompts mentioned Sentry. Connected but unused. §G.6 is the rule that turns a configured
// connector into a read that actually happens, and the report block is what makes a skipped read
// visible instead of silent.
//
// As with its siblings, the risk runs in BOTH directions and this guard watches both:
//
//   • DELETION / DILUTION — §G.1 quietly loses "Finding a bug is NOT completion", or §G.2's six
//     stop categories soften into "ask the owner whenever you are unsure", which is the same
//     find-and-hand-off failure wearing caution's clothes. Or §G.5 loses the sentence that makes a
//     9.2/10 listing five fixable defects a FAILED run, and manufactured scores come back.
//
//   • WIDENING — a future run deletes §G.2 entirely to unblock itself. §G grants COMPLETION
//     authority, never permission to do something destructive, to redesign another routine's
//     surface, or to walk around a safety gate (§G.7). Losing the list turns §G into unlimited
//     authority, so CI goes red first.
//
// Vacuity is the third failure mode and it is the quiet one. A check that cannot fail is worse
// than no check: `verify-af-*` shipped a `[^)]*` here once that could not span newlines and so
// could never fire. Every region-scoped check below therefore asserts its region was LOCATABLE
// before asserting anything about its contents, and the six-category count is taken from RAW
// lines (normalising collapses the newlines that make bullets bullets).
//
// Run: node --experimental-strip-types scripts/verify-global-engineering-policy.ts

import { readFileSync, existsSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const REPO_ROOT = __join(import.meta.dirname, '..');

const ROUTINES = 'docs/ops/ENGINEER_ROUTINES.md';
const AGENTS = 'AGENTS.md';

/** The five per-routine canonical specs that must each route to §G. */
const SPECS = [
  'docs/ops/DATA_INTEGRITY_ENGINEER.md',
  'docs/ops/SEARCH_MATCH_QA_ENGINEER.md',
  'docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md',
  'docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md',
  'docs/ops/SYSTEMS_SEAM_ENGINEER.md',
] as const;

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

for (const f of [ROUTINES, AGENTS, ...SPECS]) {
  if (!existsSync(f)) {
    console.error(`❌ global-engineering-policy: ${f} is missing — the policy is incoherent.`);
    process.exit(1);
  }
}

// Prose checks run against a NORMALISED copy, exactly as the two sibling contract guards do.
// §G is written for humans: **bold** on the pinned phrases, a `>` blockquote for the owner's
// mandate, backticked identifiers, fenced blocks for the two chains and the report block, and hard
// wrapping at ~100 columns — so a pinned sentence routinely spans two lines. Matching raw text
// would fail for pure formatting reasons and teach the next author to delete the check instead of
// restoring the content.
//
// Strip `*` and backticks only — NOT `_`, which is load-bearing inside identifiers like
// ops_deploy_lock.
const norm = (s: string) =>
  s.replace(/[*`]/g, '')        // emphasis + code ticks only; `_` is part of identifiers
   .replace(/^\s*>\s?/gm, '')   // blockquote markers (the mandate is quoted)
   .replace(/\s+/g, ' ')        // collapse hard wrapping
   .trim();

const rawRoutines = readFileSync(ROUTINES, 'utf8');
const routines = norm(rawRoutines);
const agents = readFileSync(AGENTS, 'utf8');

const has = (hay: string, needle: string) =>
  hay.toLowerCase().includes(norm(needle).toLowerCase());

/** The normalised text BETWEEN two anchors, so a check can be scoped to one section. */
const region = (hay: string, from: string, to: string): string => {
  const a = hay.toLowerCase().indexOf(norm(from).toLowerCase());
  if (a < 0) return '';
  const b = hay.toLowerCase().indexOf(norm(to).toLowerCase(), a + 1);
  return hay.slice(a, b < 0 ? hay.length : b);
};

// ── 0. §G exists at all, and is scoped to all seven ───────────────────────────────────────────
check(/##\s*§G\s*—\s*GLOBAL ENGINEERING POLICY/i.test(routines),
  '§G — GLOBAL ENGINEERING POLICY section is present',
  `${ROUTINES} has lost its §G GLOBAL ENGINEERING POLICY section — the seven routines revert to ` +
  `monitoring agents that find defects and hand them back to the owner`);

check(/binds ALL SEVEN routines/i.test(routines),
  '§G declares that it binds ALL SEVEN routines',
  `${ROUTINES} §G no longer says it binds ALL SEVEN routines — a policy that does not name its ` +
  `scope gets read as applying to whichever routine is convenient`);

// The whole §G region. Every scoped check below runs inside it, and every one of them first
// asserts this region is non-empty — otherwise deleting the heading would silently pass them all.
//
// §G is deliberately placed AFTER §S and BEFORE routine #1, so the region ends at the routine-#1
// heading. That ordering is not cosmetic: verify-sentry-mandate-runs-first.ts requires §S inside
// the first 25% of this file, and §G is ~118 lines — putting §G above §S pushed §S to 45% and
// turned the Sentry mandate into something a long run would never reach. Keep §G below §S.
const G = region(routines, '## §G — GLOBAL ENGINEERING POLICY', '## 1. ⚡ Daily JUNIOR SCRAPING Engineer');
check(G.length > 0,
  '§G is locatable between its own heading and routine #1 (scoped checks below are not vacuous)',
  `${ROUTINES}: could not locate the §G region between "## §G — GLOBAL ENGINEERING POLICY" and ` +
  `"## 1. ⚡ Daily JUNIOR SCRAPING Engineer". Every §G check below would then pass vacuously, so ` +
  `this guard fails here first rather than reporting a green policy that is not in the file.`);

// ── 1. All SEVEN routines are named in §G itself ──────────────────────────────────────────────
// Not "the file mentions them somewhere" — inside the policy region, so a reader of §G alone knows
// who it binds. Names, not just numbers: a bare "#4" survives a rename that guts the roster.
for (const name of [
  'Junior Scraping', 'Senior Production', 'Data Integrity', 'Search & Matching QA',
  'AF + Trending', 'Journey & Persistence', 'Systems Seam',
]) {
  check(G.length > 0 && has(G, name),
    `§G names routine "${name}"`,
    `${ROUTINES} §G no longer names the "${name}" routine. §G binds all seven by name so no ` +
    `routine can read itself out of the policy; a missing name is exactly how that starts.`);
}

// ── 2. §G.1 — FIX FIRST, REPORT LAST ──────────────────────────────────────────────────────────
check(has(routines, 'FIX FIRST, REPORT LAST'),
  '§G.1 keeps the "FIX FIRST, REPORT LAST" mandate',
  `${ROUTINES} §G.1 dropped "FIX FIRST, REPORT LAST" — the one phrase that separates these seven ` +
  `routines from reporting agents`);

check(has(routines,
    'INVESTIGATE → REPRODUCE → ROOT CAUSE → FIX → REGRESSION → PERMANENT BARRIER → MUTATION-PROVE ' +
    '→ RELEVANT/FULL TESTS → MERGE → DEPLOY/APPLY IF ROLE-AUTHORIZED → PRODUCTION VERIFY → REPORT'),
  '§G.1 keeps the full end-to-end chain, report LAST',
  `${ROUTINES} §G.1 dropped the "INVESTIGATE → … → PRODUCTION VERIFY → REPORT" chain. Without it ` +
  `"fix it" has no definition of finished, REPORT stops being the last link, and a partial run ` +
  `reads as a complete one.`);

check(has(routines, 'Finding a bug is NOT completion'),
  '§G.1 still states that finding a bug is NOT completion',
  `${ROUTINES} §G.1 no longer says "Finding a bug is NOT completion" — a run that files defects ` +
  `and stops would read as a successful run`);

check(has(routines, 'fixed in the SAME run — never handed back to the owner as homework')
   || has(routines, 'fixed in the SAME run - never handed back to the owner as homework'),
  '§G.1 keeps the same-run duty (no homework for the owner)',
  `${ROUTINES} §G.1 no longer requires a safe, obvious, in-scope defect to be fixed in the SAME ` +
  `run rather than handed back to the owner as homework`);

// ── 3. §G.2 — SIX and only six stop categories, watched in BOTH directions ────────────────────
// DELETION → §G reads as unlimited authority. DILUTION → "ask whenever unsure", which re-creates
// the permission-seeking behaviour §G exists to stop. Neither may happen silently.
check(has(routines, 'THE ONLY LEGITIMATE REASONS TO STOP WITHOUT FIXING (exactly six)'),
  '§G.2 heading still binds the list to "exactly six"',
  `${ROUTINES} §G.2 no longer says "exactly six" — the count would stop being pinned to the list, ` +
  `and the list could then grow or shrink without anything noticing`);

// Count on the RAW text: the categories are markdown bullets, and normalising collapses the
// newlines that make them bullets. Bounded by the literal §G.2 heading and the §G.3 heading.
{
  const lines = rawRoutines.split('\n');
  const start = lines.findIndex((l) =>
    /^###\s*§G\.2\s*—\s*THE ONLY LEGITIMATE REASONS TO STOP WITHOUT FIXING/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^###\s*§G\.3\s*—/.test(l));
  const located = start >= 0 && end > start;
  const block = located ? lines.slice(start + 1, end) : [];

  check(located,
    '§G.2 block is locatable between its heading and §G.3 (the count below is not vacuous)',
    `${ROUTINES}: could not locate the §G.2 block between the "§G.2 — THE ONLY LEGITIMATE REASONS ` +
    `TO STOP WITHOUT FIXING" heading and "§G.3 —". The category count and the dilution guard ` +
    `below cannot run and would pass vacuously.`);

  // Bullets that actually carry a lettered category. A bullet without (a)…(f) is prose, not a
  // category, and must not inflate the count.
  const categories = block.filter((l) => /^-\s*\(([a-z])\)/.test(l));
  check(located && categories.length === 6,
    '§G.2 lists exactly SIX stop categories',
    `${ROUTINES} §G.2 now has ${categories.length} lettered stop categor(y/ies), not 6. The ` +
    `heading says "exactly six", so the list and the count must agree. Adding one widens what a ` +
    `routine may decline to fix; removing one widens what it may do unasked. Either is an OWNER ` +
    `decision, not an edit.`);

  // Each letter present exactly once, and carrying its own meaning — so (a)…(f) cannot be
  // renumbered into six copies of the same escape hatch.
  const letters = categories.map((l) => l.match(/^-\s*\(([a-z])\)/)![1]).join('');
  check(located && letters === 'abcdef',
    '§G.2 categories are lettered (a)…(f), each exactly once',
    `${ROUTINES} §G.2 categories are lettered "${letters}", not "abcdef" — the list has been ` +
    `renumbered, duplicated, or reordered, and §G.5 cites "which of §G.2's six categories applies"`);

  for (const [letter, needle, why] of [
    ['a', 'destructive/high-risk operation requiring owner approval', 'the destructive-operation gate'],
    ['b', 'genuine product / source-truth / taxonomy ambiguity', 'the genuine-ambiguity category'],
    ['c', 'the fix would weaken a safety or security gate', 'the never-weaken-a-gate category'],
    ['d', 'another routine currently owns that protected surface', 'the ownership boundary that triggers §G.3 handoff'],
    ['e', 'a role/permission boundary physically prevents this routine from writing or deploying',
     'the permission boundary that triggers §G.3 handoff (routine #1 has no Vercel connector and cannot deploy)'],
    ['f', 'an external dependency/source outage where no truthful fix exists', 'the honest-outage category'],
  ] as const) {
    check(located && has(block.join('\n'), needle),
      `§G.2 keeps category (${letter}): "${needle.slice(0, 46)}…"`,
      `${ROUTINES} §G.2 dropped or rewrote ${why} — specifically "${needle}"`);
  }

  check(has(routines, '"I ran out of time", "it seemed out of scope", "someone should look at this" do not')
     || has(routines, '“I ran out of time”, “it seemed out of scope”, “someone should look at this” do not'),
    '§G.2 still names the three excuses that do NOT qualify',
    `${ROUTINES} §G.2 no longer explicitly rejects "I ran out of time", "it seemed out of scope" ` +
    `and "someone should look at this". Those are the three the routines actually reach for, and ` +
    `a category list without them reads as leaving room for judgement.`);

  // DILUTION guard: an open-ended escalation trigger anywhere in the category block.
  const blockText = norm(block.join('\n')).toLowerCase();
  const dilution = [
    'whenever you are unsure', 'when in doubt', 'if in doubt', 'whenever unsure',
    'anything you are not certain', 'any time you are unsure', 'if you are not sure',
    'whenever the correct behavior is unclear', 'whenever the correct behaviour is unclear',
    'ask the owner whenever', 'ask whenever unsure', 'ask first if unsure',
  ].filter((p) => blockText.includes(p));

  check(located && dilution.length === 0,
    '§G.2 carries no open-ended "ask whenever unsure" escape hatch',
    `${ROUTINES} §G.2 now includes open-ended phrasing (${dilution.join('; ')}). That dilutes six ` +
    `specific engineering judgments into "ask the owner whenever you feel uncertain" — the ` +
    `permission-seeking behaviour §G was written to stop, wearing caution's clothes.`);
}

// ── 4. §G.3 — the handoff DUTY, not a suggestion ──────────────────────────────────────────────
check(has(routines, 'Never merely state that someone should fix it'),
  '§G.3 forbids "someone should fix this" in place of an actual handoff',
  `${ROUTINES} §G.3 no longer forbids merely stating that someone should fix it — the routing ` +
  `duty collapses back into a sentence in a report that nobody is accountable for`);

check(has(routines, 'ROUTE the defect to the write-authorized owner'),
  '§G.3 keeps the duty to ROUTE the defect to the write-authorized owner',
  `${ROUTINES} §G.3 no longer requires routing a (d)/(e)-blocked defect to the write-authorized ` +
  `owner with reproduction and root cause`);

check(has(routines, 'Senior/write-authorized routines remain responsible for what lower-permission routines cannot do'),
  '§G.3 keeps senior routines responsible for what lower-permission routines cannot do',
  `${ROUTINES} §G.3 no longer makes write-authorized routines responsible for what lower-permission ` +
  `routines physically cannot do — a (e)-blocked defect would land nowhere`);

check(has(routines, 'ops_deploy_lock'),
  '§G.3 still names the single-writer deploy lock',
  `${ROUTINES} §G.3 no longer names ops_deploy_lock — cross-routine handoff without the lock ` +
  `discipline is how two routines collide on the same surface`);

// ── 5. §G.4 — adaptive effort, in both directions ─────────────────────────────────────────────
check(has(routines, 'do not stop after the first few'),
  '§G.4 keeps the do-not-stop-after-the-first-few rule',
  `${ROUTINES} §G.4 no longer says not to stop after the first few defects — a run that fixes two ` +
  `of nine would read as complete`);

check(has(routines, 'invent no work'),
  '§G.4 keeps the clean-surface half (SHORT report, invent no work)',
  `${ROUTINES} §G.4 lost "invent no work". Adaptive effort has TWO directions: without this half ` +
  `a clean surface produces manufactured findings, which is how a barrier suite fills with noise.`);

check(has(routines, 'fix the underlying CLASS and barrier it, not just the one example'),
  '§G.4 keeps the fix-the-class rule for architectural defects',
  `${ROUTINES} §G.4 no longer requires fixing the underlying CLASS of an architectural defect ` +
  `rather than the single example that surfaced it`);

check(has(routines, 'a red test turning green is not sufficient'),
  '§G.4 keeps "a red test turning green is not sufficient"',
  `${ROUTINES} §G.4 no longer states that a red test turning green is insufficient and production ` +
  `behavior must match — the exact gap that lets a merged fix be reported as a live one`);

// ── 6. §G.5 — the real 10/10 standard ─────────────────────────────────────────────────────────
check(has(routines, 'NEVER manufacture a 10/10'),
  '§G.5 keeps "NEVER manufacture a 10/10"',
  `${ROUTINES} §G.5 no longer forbids manufacturing a 10/10 — the score stops meaning anything ` +
  `the owner can act on`);

check(has(routines,
    'A report of 9.2/10 listing five defects this routine had the permission and ability to fix is a FAILED run'),
  '§G.5 keeps the worked example that defines a FAILED run',
  `${ROUTINES} §G.5 dropped the 9.2/10-listing-five-fixable-defects example. The abstract rule ` +
  `survives every rationalisation; the worked example is what makes it decidable.`);

check(has(routines, '10/10 ACHIEVED: NO') && has(routines, 'citing which of §G.2'),
  '§G.5 routes a true blocker back to §G.2\'s six categories',
  `${ROUTINES} §G.5 no longer requires reporting "10/10 ACHIEVED: NO" with the blocker cited ` +
  `against one of §G.2's six categories — a blocker could then be any sentence at all`);

// ── 7. §G.6 — Sentry first, and resolve ONLY after production verification ────────────────────
check(has(routines, 'SENTRY IS MANDATORY AND FIRST'),
  '§G.6 keeps Sentry as mandatory and first',
  `${ROUTINES} §G.6 no longer makes the Sentry read mandatory and first. On 2026-08-29 all seven ` +
  `routines had the connector attached and not one prompt mentioned it; §G.6 is what changed that.`);

check(has(routines,
    'Do NOT resolve a Sentry issue because code merged — resolve ONLY after the production fix is verified')
   || has(routines,
    'Do NOT resolve a Sentry issue because code merged - resolve ONLY after the production fix is verified'),
  '§G.6 keeps resolve-only-after-production-verification',
  `${ROUTINES} §G.6 no longer forbids resolving a Sentry issue on a merge. Resolving at merge time ` +
  `closes the issue before the fix is live, and the next occurrence lands on a closed issue.`);

check(has(routines, 'A REOPENED issue is evidence the previous fix was incomplete'),
  '§G.6 keeps the reopened-issue rule',
  `${ROUTINES} §G.6 no longer treats a REOPENED issue as evidence the previous fix was incomplete ` +
  `— it would be re-fixed the same wrong way`);

check(has(routines, 'a configured connector is not a working one'),
  '§G.6 keeps "a configured connector is not a working one"',
  `${ROUTINES} §G.6 no longer requires proving the Sentry connection with a real read each run. ` +
  `That sentence is the entire finding of 2026-08-29 and the reason §G.6 exists.`);

check(has(routines, 'SENTRY CONNECTION WORKING: NO') && has(routines, 'rather than silently skipping it'),
  '§G.6 requires a failed Sentry read to be reported, not silently skipped',
  `${ROUTINES} §G.6 no longer requires a failed Sentry read to be declared ` +
  `(SENTRY CONNECTION WORKING: NO) rather than silently skipped — a broken connector would look ` +
  `identical to a clean queue`);

check(has(routines, 'Sentry does NOT replace deterministic QA'),
  '§G.6 keeps Sentry as an addition to deterministic QA, never a replacement',
  `${ROUTINES} §G.6 no longer states that Sentry does not replace deterministic QA. Silent ` +
  `wrong-data defects never raise a Sentry event, so a Sentry-only run would certify them healthy.`);

// §G.6 must not be read as superseding §S, which owns the per-routine Sentry routing.
check(has(routines, 'docs/ops/SENTRY_ROUTING.md'),
  '§G/§S still route agents to the Sentry ownership table',
  `${ROUTINES} no longer points at docs/ops/SENTRY_ROUTING.md — §G.6 would tell seven routines to ` +
  `read Sentry with nothing left to say which issues are whose`);

check(/##\s*§S\s*—\s*SENTRY/i.test(routines),
  '§S (the per-routine Sentry contract) still exists alongside §G',
  `${ROUTINES} lost §S. §G.6 explicitly does not replace it — §S carries the scoped queue and the ` +
  `claim-before-you-fix protocol that stops seven routines working the same crash.`);

// ── 8. §G.7 — nothing above weakens any existing guard ────────────────────────────────────────
check(has(routines, 'NOTHING ABOVE WEAKENS ANY EXISTING GUARD'),
  '§G.7 keeps the no-weakening clause',
  `${ROUTINES} lost §G.7 — a completion mandate without it reads as licence to route around ` +
  `whatever is in the way`);

check(has(routines, 'A gate that blocks you has found a real problem — never route around it to reach 10/10')
   || has(routines, 'A gate that blocks you has found a real problem - never route around it to reach 10/10'),
  '§G.7 keeps "a gate that blocks you has found a real problem"',
  `${ROUTINES} §G.7 no longer states that a blocking gate has found a real problem and must not be ` +
  `routed around to reach 10/10 — §G.5's standard would start competing with the safety gates`);

// ── 9. §G.8 — the report block, complete ──────────────────────────────────────────────────────
// Every line is load-bearing: each one is a claim the owner reads the report to check. A missing
// line is not a shorter report, it is an unanswered question.
{
  const REPORT_LINES = [
    'BUGS FOUND:', 'BUGS FIXED:', 'BUGS REMAINING:', 'BARRIERS ADDED:', 'MUTATIONS KILLED:',
    'TESTS:', 'MERGED:', 'DEPLOYED/APPLIED:', 'PRODUCTION VERIFIED:', 'SENTRY CHECKED:',
    'SENTRY CONNECTION WORKING:', 'OPEN P0/P1 IN SCOPE:', 'TRUE SCORE:', '10/10 ACHIEVED:',
  ];
  // Scoped to §G.8's own block, NOT the whole file. Several of these strings also appear in §G.5
  // and §G.6 prose ("report `10/10 ACHIEVED: NO`", "say so plainly … `SENTRY CONNECTION WORKING:
  // NO`"), so a whole-file match cannot see a line deleted FROM THE BLOCK — mutation M12 deleted
  // `SENTRY CONNECTION WORKING: YES/NO` from the report block and the whole-file check stayed
  // green on §G.6's sentence alone. Same class as the sibling guard's M24.
  const rl = rawRoutines.split('\n');
  const gStart = rl.findIndex((l) => /^###\s*§G\.8\s*—/.test(l));
  const gEnd = rl.findIndex((l, i) => i > gStart && /^##\s+1\.\s/.test(l));
  const gLocated = gStart >= 0 && gEnd > gStart;
  const reportBlock = gLocated ? rl.slice(gStart + 1, gEnd).join('\n') : '';

  check(gLocated,
    '§G.8 block is locatable between its heading and routine #1 (the report-line check is not vacuous)',
    `${ROUTINES}: could not locate the §G.8 block between "### §G.8 —" and the "## 1." routine ` +
    `heading. The report-block completeness check below cannot run and would pass vacuously.`);

  const missing = REPORT_LINES.filter((l) => !reportBlock.includes(l));
  check(gLocated && missing.length === 0,
    `§G.8 report block keeps all ${REPORT_LINES.length} lines`,
    `${ROUTINES} §G.8 report block is missing: ${missing.join(', ')}. Each line is a claim the ` +
    `owner reads the report to check; a dropped line is an unanswered question, not a shorter report.`);

  check(has(routines, 'never defects the routine chose not to fix'),
    '§G.8 forbids listing chose-not-to-fix defects as blockers',
    `${ROUTINES} §G.8 no longer forbids listing defects the routine chose not to fix as blockers — ` +
    `the single easiest way to make a failed run look blocked instead of incomplete`);

  // §G.8 must not quietly replace the owner-locked Rating Before → Rating After pair.
  check(has(routines, 'Rating Before → Rating After') && has(routines, 'TRUE SCORE does not replace it'),
    '§G.8 preserves the owner-locked Rating Before → Rating After pair',
    `${ROUTINES} §G.8 no longer states that TRUE SCORE does not replace the owner-locked ` +
    `"Rating Before → Rating After" pair (Reporting rules, 2026-08-13). A new score line that ` +
    `silently supersedes an existing owner-locked one is a weakened guard, which §G.7 forbids.`);
}

// ── 10. The load-bearing links — a policy only governs while something routes agents to it ────
check(agents.includes('docs/ops/ENGINEER_ROUTINES.md') && /GLOBAL ENGINEERING POLICY/i.test(agents),
  'AGENTS.md routes every session to the GLOBAL ENGINEERING POLICY',
  `${AGENTS} no longer names the GLOBAL ENGINEERING POLICY alongside docs/ops/ENGINEER_ROUTINES.md. ` +
  `AGENTS.md loads into every session and is declared as overriding; if it stops routing to §G, a ` +
  `routine that never opens the roster never meets the policy at all.`);

for (const spec of SPECS) {
  const text = norm(readFileSync(spec, 'utf8'));
  check(has(text, 'ENGINEER_ROUTINES.md §G'),
    `${spec} routes to §G`,
    `${spec} no longer points at docs/ops/ENGINEER_ROUTINES.md §G. Each per-routine spec is what ` +
    `its routine actually reads; a spec that does not route to §G leaves that routine governed by ` +
    `its prompt alone.`);

  // The pointer must ADD, never subtract: a spec may be stricter, never weaker.
  check(has(text, 'weakens nothing in it'),
    `${spec} states the policy ADDS to it and weakens nothing`,
    `${spec}'s §G pointer no longer states that the global policy weakens nothing in this spec — ` +
    `a later reader could take §G as licence to relax a stricter local rule`);
}

// ── 11. Worthless if nothing runs it ──────────────────────────────────────────────────────────
check(npmTestRuns(REPO_ROOT, 'verify-global-engineering-policy'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-global-engineering-policy.ts (see scripts/test-exclusions.txt) — the guard is inert');

console.log(
  'global-engineering-policy: §G must keep binding all SEVEN routines to fix-first/report-last,\n' +
  '                           keep its six stop categories narrow, keep the real 10/10 standard,\n' +
  '                           keep Sentry first with resolve-after-production-verify, and stay linked\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(
    `\n❌ ${problems.length} check(s) failed — the GLOBAL ENGINEERING POLICY (§G) has been ` +
    `weakened, widened, or unlinked.`);
  process.exit(1);
}
console.log(`\n✅ global-engineering-policy: passed (${ok.length} checks).`);
