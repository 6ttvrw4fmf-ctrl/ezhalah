// Routine #6 (👣 Journey & Persistence) and #7 (🧵 Systems Seam) standing-contract guard.
//
// Sibling of scripts/verify-data-integrity-contract.ts, and built to the same shape for the same
// reason: these two specs are what make the routines FINISH their own work instead of handing
// safely fixable problems back to the owner, and a routine prompt lives outside this repo and
// drifts. The file wins — but only while something checks the file.
//
// As with the data-integrity contract, the risk runs in BOTH directions and this guard watches
// both:
//
//   • DELETION / DILUTION — §0 quietly loses "Your job is not to only test. Your job is to fix.",
//     or the chain that spells out what finishing means, and the routine drifts back to writing up
//     a monitoring report. Or the stop conditions get diluted from four specific engineering
//     judgments into "ask the owner whenever you are unsure", which is the same failure wearing
//     caution's clothes.
//
//   • WIDENING — a future run deletes the stop conditions entirely to unblock itself. §0 grants
//     COMPLETION authority, never permission to redesign another routine's matching semantics, to
//     do something destructive and irreversible, to change a cron schedule, or to walk around a
//     safety gate. Losing that list turns §0 into unlimited authority, so CI goes red first.
//
// The 2026-08-28 additions are pinned here too, because each closes a specific, expensive gap and
// each is the kind of prose a later editor "tidies away" without noticing what it was load-bearing
// for:
//
//   #6 PART 9  — the harness-defect vs. real-product-bug discriminator. Without it, an engineer
//                that drives browsers all day files harness artifacts as Ezhalah bugs (burning fix
//                cycles and polluting this very suite with barriers that pin a harness quirk), or
//                makes the inverse error and dismisses a reproducible failure as "flake".
//   #6 PART 10 — real-device honesty. Headless WebKit is not a physical iPhone, and voice input
//                shipped broken on a real phone through THREE fixes (#1040, #1051, #1053) with
//                every automated check green each time.
//   #6 PART 11 — the harness, its timing discipline, and its load constants — including the
//                honesty rule that an unmeasured constant is stated as unmeasured, never invented.
//   #7 PART 1  — the three handoffs nobody owned: alert row → a human actually told; acknowledge →
//                the detector genuinely clearing AND able to re-raise; config set → the runtime
//                actually having it.
//   #7 PART 1  — the orphaned-guarantee registry's named durable home, and — pinned in BOTH
//                directions — that repairs are NOT aged out: the 90-day window is gone and must
//                not come back, and oldest-first rotation is what replaced it.
//
// And, as with the authority contract, the routing must hold: a contract only has force while
// ENGINEER_ROUTINES.md (itself linked from AGENTS.md) points agents at it.
//
// Run: node --experimental-strip-types scripts/verify-journey-seam-engineer-contracts.ts

import { readFileSync, existsSync } from 'node:fs';

const JOURNEY = 'docs/ops/JOURNEY_PERSISTENCE_ENGINEER.md';
const SEAM = 'docs/ops/SYSTEMS_SEAM_ENGINEER.md';
const ROUTINES = 'docs/ops/ENGINEER_ROUTINES.md';
const AGENTS = 'AGENTS.md';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

for (const f of [JOURNEY, SEAM, ROUTINES, AGENTS]) {
  if (!existsSync(f)) {
    console.error(`❌ journey-seam-contracts: ${f} is missing — the routine's contract is incoherent.`);
    process.exit(1);
  }
}

// Prose checks run against a NORMALISED copy, exactly as verify-data-integrity-contract.ts does.
// These specs are written for humans: **bold** on the phrases worth pinning, the owner's mandate in
// a `>` blockquote, backticked identifiers, and hard wrapping at ~100 columns — so a pinned
// sentence routinely spans two lines with a `> ` in the middle. Matching the raw text would fail
// for pure formatting reasons and teach the next author to delete the check instead of restoring
// the content.
//
// Strip `*` and backticks only — NOT `_`, which is load-bearing inside identifiers like
// ops_repair_guarantee_registry and mon_detect_repair_guarantee_stale.
const norm = (s: string) =>
  s.replace(/[*`]/g, '')        // emphasis only; `_` is part of identifiers
   .replace(/^\s*>\s?/gm, '')   // blockquote markers (the mandate is quoted)
   .replace(/\s+/g, ' ')        // collapse hard wrapping
   .trim();

const raw = {
  journey: readFileSync(JOURNEY, 'utf8'),
  seam: readFileSync(SEAM, 'utf8'),
};
const journey = norm(raw.journey);
const seam = norm(raw.seam);
const routines = norm(readFileSync(ROUTINES, 'utf8'));
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

const SPECS = [
  { name: '#6 👣 Journey & Persistence', file: JOURNEY, text: journey, rawText: raw.journey },
  { name: '#7 🧵 Systems Seam', file: SEAM, text: seam, rawText: raw.seam },
] as const;

// ── 1. §0's FIX MANDATE — the whole reason these files exist ──────────────────────────────────
for (const s of SPECS) {
  check(/##\s*§0\s*—\s*Mandate and standing operating contract/i.test(s.text),
    `${s.name}: §0 mandate section is present`,
    `${s.file} has lost its §0 mandate section — the routine reverts to asking permission for ` +
    `normal safely provable fixes`);

  check(has(s.text, 'Your job is not to only test. Your job is to fix.'),
    `${s.name}: §0 keeps "Your job is not to only test. Your job is to fix."`,
    `${s.file} §0 dropped "Your job is not to only test. Your job is to fix." — that one sentence ` +
    `is what separates this routine from a monitoring/reporting agent`);

  check(has(s.text,
      'investigate → reproduce → root cause → fix → regression → barrier → mutation-proof → ' +
      'merge → deploy → production verify → report'),
    `${s.name}: §0 keeps the full end-to-end chain`,
    `${s.file} §0 dropped the "investigate → reproduce → root cause → fix → regression → barrier ` +
    `→ mutation-proof → merge → deploy → production verify → report" chain — without it "fix it" ` +
    `has no definition of finished, and a partial run reads as a complete one`);

  check(has(s.text, 'Do not behave like a monitoring/reporting agent that finds a problem and leaves it for someone else'),
    `${s.name}: §0 still forbids the find-and-hand-off behaviour explicitly`,
    `${s.file} §0 no longer says not to behave like a monitoring/reporting agent that leaves the ` +
    `problem for someone else`);

  check(has(s.text, 'Same authority grant as docs/ops/AGENT_AUTHORITY.md, which overrides any more-timid wording'),
    `${s.name}: §0 still defers to AGENT_AUTHORITY.md over more-timid wording`,
    `${s.file} §0 no longer points at docs/ops/AGENT_AUTHORITY.md as overriding more-timid ` +
    `wording — a later cautious edit to this file would then quietly win`);
}

// ── 2. The stop conditions stay NARROW — watched in BOTH directions ───────────────────────────
// DELETION → unlimited authority. DILUTION → "ask whenever unsure", which re-creates the exact
// permission-seeking behaviour §0 exists to stop. Neither may happen silently.
for (const s of SPECS) {
  check(has(s.text, 'Only stop and ask the owner when'),
    `${s.name}: the stop-condition list is present (no unlimited authority)`,
    `${s.file} lost its "Only stop and ask the owner when" list — §0 would read as unlimited ` +
    `authority. Widening this is an OWNER decision.`);

  // Count on the RAW text: the list is markdown bullets, and normalising collapses the newlines
  // that make them bullets. Bounded by the two literal lines that open and close the list.
  const lines = s.rawText.split('\n');
  const start = lines.findIndex((l) => /^Only stop and ask the owner when:/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^Otherwise: fix it\./.test(l));
  const block = start >= 0 && end > start ? lines.slice(start + 1, end) : [];
  const bullets = block.filter((l) => /^- /.test(l)).length;

  check(bullets === 4,
    `${s.name}: exactly FOUR stop conditions, as both specs' PART 6 claims`,
    `${s.file} now has ${bullets} stop condition(s), not 4. Both PART 6 sections say "genuinely ` +
    `one of §0's four stop conditions", so the list and the count must agree. Adding one widens ` +
    `what the routine escalates; removing one widens what it may do unasked. Either is an OWNER ` +
    `decision, not an edit.`);

  check(has(s.text, "§0's four stop conditions"),
    `${s.name}: PART 6 still binds "four" to the enumerated list`,
    `${s.file} PART 6 no longer says "§0's four stop conditions" — the count would stop being ` +
    `pinned to the list, and the list could then grow without anything noticing`);

  // DILUTION guard: an open-ended escalation trigger anywhere in the stop-condition block.
  const blockText = norm(block.join('\n')).toLowerCase();
  const dilution = [
    'whenever you are unsure', 'when in doubt', 'if in doubt', 'whenever unsure',
    'anything you are not certain', 'any time you are unsure', 'if you are not sure',
    'whenever the correct behavior is unclear', 'ask the owner whenever',
  ].filter((p) => blockText.includes(p));

  check(dilution.length === 0,
    `${s.name}: the stop conditions carry no open-ended "ask whenever unsure" escape hatch`,
    `${s.file} stop conditions now include open-ended phrasing (${dilution.join('; ')}). That ` +
    `dilutes four specific engineering judgments into "ask the owner whenever you feel uncertain" ` +
    `— the permission-seeking behaviour §0 was written to stop, wearing caution's clothes.`);
}

// ── 3. PART 6 and PART 7 still exist in both ──────────────────────────────────────────────────
for (const s of SPECS) {
  check(/PART 6 — FIX, DON'T (JUST )?REPORT/i.test(s.text),
    `${s.name}: PART 6 (fix, don't just report) survives`,
    `${s.file} lost PART 6 — the section that says a found bug is fixed in the same run, not ` +
    `filed for later`);

  check(/PART 7 — DEPLOY AND PRODUCTION VERIFICATION/i.test(s.text),
    `${s.name}: PART 7 (deploy + production verification) survives`,
    `${s.file} lost PART 7 — without it a fix can be reported as done while never reaching, or ` +
    `never being verified against, production`);

  check(has(s.text, 'scripts/safe-pr-merge.ts'),
    `${s.name}: PART 7 still routes merges through the merge gate`,
    `${s.file} no longer names scripts/safe-pr-merge.ts — "gh pr checks returned" is not "safe ` +
    `to merge" (PR #1046 merged on cancelled required checks)`);
}

check(has(journey, 'After deploy, re-run the exact journey that found the bug against production, not against a local build'),
  '#6: PART 7 still demands the failing journey be re-run against PRODUCTION after deploy',
  `${JOURNEY} PART 7 no longer requires re-running the exact failing journey against production ` +
  `after deploy — a fix would be closeable on a local build`);

check(has(seam, 'Never trust a tool’s own self-reported success; verify the actual downstream effect')
   || has(seam, "Never trust a tool's own self-reported success; verify the actual downstream effect"),
  '#7: PART 7 still demands independent downstream verification, not self-reported success',
  `${SEAM} PART 7 no longer says to verify the actual downstream effect rather than trusting a ` +
  `tool's own self-reported success — which is the entire premise of routine #7`);

// ── 4. #6 PART 9 — the harness-vs-product discriminator ───────────────────────────────────────
check(/PART 9 — HARNESS DEFECT vs\. REAL PRODUCT BUG/i.test(journey),
  '#6: PART 9 (harness defect vs. real product bug) is present',
  `${JOURNEY} lost PART 9 — an engineer driving browsers all day will hit harness artifacts, and ` +
  `filing those as Ezhalah bugs burns fix cycles and pollutes this barrier suite`);

for (const [needle, why] of [
  ['Reproduced at least twice, independently',
   'the N≥2 reproduction floor before anything is filed as a product bug'],
  ['The pane/tab was FOREGROUNDED',
   'the foregrounding requirement — a hidden pane defers rAF and makes a healthy element read as absent'],
  ['The same served bundle was checked somewhere else',
   'the same-bundle-elsewhere discriminator, which is what separates code from harness/data'],
  ['If the identical bundle behaves correctly elsewhere, the bundle is not the defect',
   'the conclusion that discriminator licenses'],
  ['Real clicks, not dispatched synthetic events',
   'the trusted-click requirement — React listens for focusin and ignores synthetic events'],
  ['The discriminating evidence is written into the finding itself',
   'the requirement that the evidence appears in the finding, not only in the engineer\'s head'],
] as const) {
  check(has(journey, needle),
    `#6 PART 9.1 keeps: "${needle.slice(0, 48)}…"`,
    `${JOURNEY} PART 9.1 dropped ${why} — specifically "${needle}"`);
}

check(has(journey, 'A reproducible failure may be closed as harness/data only on positive proof'),
  '#6 PART 9.1 forbids dismissing a reproducible failure as "flake" without positive proof',
  `${JOURNEY} PART 9 no longer forbids closing a reproducible failure as harness/data without ` +
  `POSITIVE proof. That is the inverse error and it is the more expensive one — the bug ships.`);

check(has(journey, '"Flake" is a CONCLUSION and needs evidence'),
  '#6 PART 9 still states that "flake" is a conclusion requiring evidence',
  `${JOURNEY} PART 9 no longer says "flake" is a conclusion needing evidence — it becomes an ` +
  `excuse again`);

check(/PART 9\.4[\s\S]{0,80}A harness defect you introduced is YOUR bug to fix/i.test(journey)
   || has(journey, 'A harness defect you introduced is YOUR bug to fix'),
  '#6 PART 9.4: a self-introduced harness defect is the engineer\'s own bug, not noise',
  `${JOURNEY} lost the rule that a harness defect the engineer itself introduced is ITS OWN bug ` +
  `to fix rather than noise to route around`);

check(has(journey, 'Browser-pane computed styles LIE'),
  '#6 PART 9.2 keeps the computed-styles trap (judge from screenshots, not getComputedStyle)',
  `${JOURNEY} PART 9.2 no longer records that browser-pane computed styles return stale values ` +
  `and that the compositor screenshot is the truth`);

check(has(journey, 'suspends requestAnimationFrame') || has(journey, 'defers/suspends requestAnimationFrame'),
  '#6 PART 9.2 keeps the rAF-suspension trap',
  `${JOURNEY} PART 9.2 no longer records that a hidden/unfocused pane suspends rAF, so a healthy ` +
  `element can read as FALSELY ABSENT`);

check(has(journey, 'real users background tabs too'),
  '#6 PART 9.2 keeps the inverse of the rAF trap (it is also a real production risk)',
  `${JOURNEY} PART 9.2 no longer warns that the rAF symptom is ALSO a real product bug shape ` +
  `(PR #341) — an engineer would learn to dismiss it as a test artifact`);

check(has(journey, 'is data-dependent and may legitimately differ run\nto run')
   || has(journey, 'is data-dependent and may legitimately differ run to run'),
  '#6 PART 9.2 keeps the live-production-counts trap',
  `${JOURNEY} PART 9.2 no longer records that a journey reading live production counts is ` +
  `data-dependent and can differ run to run with no code change`);

// ── 5. #6 PART 10 — real-device honesty ───────────────────────────────────────────────────────
check(/PART 10 — REAL-DEVICE HONESTY/i.test(journey),
  '#6: PART 10 (real-device honesty) is present',
  `${JOURNEY} lost PART 10 — the routine runs headless in a cloud container, and would go back to ` +
  `reporting real-device surfaces as verified on the strength of headless coverage`);

for (const [needle, why] of [
  ['Headless WebKit/Safari coverage is NEVER proof of physical-iPhone behaviour',
   'the core claim: an engine is not a device'],
  ['Never report a real-device surface as verified on the strength of headless coverage',
   'the reporting prohibition itself'],
  ['not verified on a physical device',
   'the explicit caveat every iOS/Safari finding must carry'],
  ['state it as a KNOWN COVERAGE LIMIT and do not score it',
   'the rule for surfaces only truthfully checkable on real hardware'],
  ['Reporting an unreachable surface as healthy is a reporting defect, not a rounding choice',
   'that this is a defect, not a judgment call'],
] as const) {
  check(has(journey, needle),
    `#6 PART 10 keeps: "${needle.slice(0, 48)}…"`,
    `${JOURNEY} PART 10 dropped ${why} — specifically "${needle}"`);
}

check(['#1040', '#1051', '#1053'].every((p) => journey.includes(p)),
  '#6 PART 10 keeps the three-fix voice-input evidence (#1040, #1051, #1053)',
  `${JOURNEY} PART 10 no longer cites all three of PR #1040, #1051 and #1053 — the verified ` +
  `evidence that voice shipped broken on a real iPhone through three fixes while every automated ` +
  `check passed. Without it the rule reads as caution rather than as a measured fact.`);

// ── 6. #6 PART 11 — harness, timing, reproducibility ──────────────────────────────────────────
check(/PART 11 — HARNESS, TIMING\/LOAD CONSTANTS, AND REPRODUCIBILITY/i.test(journey),
  '#6: PART 11 (harness, timing/load constants, reproducibility) is present',
  `${JOURNEY} lost PART 11 — #4 carries measured load constants in §40.1 and #6 would again have ` +
  `none, leaving every wait and every batch size to be re-guessed each run`);

for (const [needle, why] of [
  ['Do NOT run playwright install',
   'the correction to the routine prompt: the image pre-installs browsers and installing breaks every journey'],
  ['A bare sleep is never a correctness oracle',
   'the timing discipline — wait on a real condition'],
  ['A fixed timeout is a last resort',
   'that a fixed timeout must be stated in the finding rather than hidden'],
  ['A finding needs N ≥ 2 independent reproductions before it is filed',
   'the reproducibility floor'],
  ['NOT ESTABLISHED — do not cite a number for these until one is measured',
   'the honesty rule that an unmeasured constant is stated as unmeasured, never invented'],
] as const) {
  check(has(journey, needle),
    `#6 PART 11 keeps: "${needle.slice(0, 48)}…"`,
    `${JOURNEY} PART 11 dropped ${why} — specifically "${needle}"`);
}

check(has(journey, 'Concurrency knee') && journey.includes('338 ms'),
  '#6 PART 11 still cites #4\'s measured constants rather than re-deriving them',
  `${JOURNEY} PART 11 no longer carries the measured load constants (§40.1's 338 ms search and ` +
  `the concurrency knee) — the load budget becomes guesswork against a shared 2-vCPU instance`);

// ── 7. #7 PART 1 — the three handoffs added 2026-08-28 ────────────────────────────────────────
for (const [needle, why] of [
  ['An alert row existing is not a human being told',
   'handoff (a): alert_event → notification actually delivered'],
  ['Configured is not delivered',
   'the lesson of the 41-day P0 blackout — a destination existing is not a destination delivering'],
  ['An acknowledged or resolved alert must actually clear, and the detector must be able to RE-RAISE it',
   'handoff (b): acknowledgment → detector self-clear, and the re-raise half'],
  ['A value set in Vercel or Supabase config is not a value the running app received',
   'handoff (c): environment/config → actual runtime'],
] as const) {
  check(has(seam, needle),
    `#7 PART 1 keeps: "${needle.slice(0, 52)}…"`,
    `${SEAM} PART 1 dropped ${why} — specifically "${needle}"`);
}

check(has(seam, 'returns 0 when it finds one unless the severity escalated'),
  '#7 PART 1 keeps the mon_raise dedup mechanism that makes a stuck-open alert dangerous',
  `${SEAM} PART 1 no longer states that mon_raise() returns 0 for an already-open dedup key — ` +
  `without it, "the sweep is all zeros" reads as health. It did on 2026-08-10: nine dark ` +
  `detectors gave a clean bill of health.`);

check(has(seam, 'only resolved_at releases the dedup key — acknowledged_at does not')
   || has(seam, 'only\nresolved_at releases the dedup key'),
  '#7 PART 1 distinguishes acknowledged_at from resolved_at',
  `${SEAM} PART 1 no longer records that acknowledged_at does NOT release the dedup key — an ` +
  `acknowledged-but-open alert is still suppressing its own class`);

check(has(seam, 'net._http_response'),
  '#7 PART 1 names the log that proves delivery, rather than trusting dispatched_at',
  `${SEAM} PART 1 no longer names net._http_response — mon_dispatch_alerts() sends via ` +
  `net.http_post, which returns on ENQUEUE, so dispatched_at is a claim and not a delivery`);

check(has(seam, 'WARNING-ONLY and never fails the deploy'),
  '#7 PART 1 records that the served-bundle env assertion is advisory, not a gate',
  `${SEAM} PART 1 no longer records that safe-deploy.sh's post-deploy served-bundle check is ` +
  `WARNING-ONLY — an engineer would treat the absence of a warning line as proof the env inlined`);

// ── 8. #7 — the registry: a named durable home, and NO aging out (both directions) ────────────
check(has(seam, 'The registry lives in public.ops_repair_guarantee_registry'),
  '#7: the orphaned-guarantee registry names its durable home',
  `${SEAM} no longer names public.ops_repair_guarantee_registry as the registry's home — the ` +
  `spec calls this #7's core standing asset, and an unnamed asset is re-derived and drifts every run`);

check(has(seam, 'Coverage is PERMANENT — there is no 90-day window, and none may be re-introduced'),
  '#7: coverage is stated as permanent, with re-introducing a window explicitly forbidden',
  `${SEAM} no longer states that registry coverage is PERMANENT with no time window — the ` +
  `window it replaced aged out exactly the old repairs most likely to have decayed`);

check(has(seam, 'OLDEST-FIRST ROTATION') && has(seam, 'least-recently-verified'),
  '#7: oldest-first rotation is what replaced the window',
  `${SEAM} lost the OLDEST-FIRST ROTATION rule (re-verify the least-recently-verified entries ` +
  `first). Permanent coverage without rotation is unachievable in one run, so dropping the ` +
  `rotation quietly restores the blind spot the window used to create.`);

// The ABSENCE half. Scoped to the two orphaned-guarantee sections only — "the last 24h" elsewhere
// in this spec (cron execution logs, PART 3 item 1) is legitimate and must not trip this.
const ORPHAN_REGIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['PART 1 orphaned-guarantee bullet', 'Orphaned guarantees — the registry', 'Deploy-claim vs. served-bundle reconciliation'],
  ['PART 3 orphaned-guarantee sweep', 'Orphaned-guarantee sweep', 'Migration drift in all four directions'],
];
// Any re-scoping of the sweep to a rolling time window, in any of its natural phrasings.
const WINDOW_RE =
  /\b(?:in|from|over|within|during|for)?\s*the\s+(?:last|past|previous|most recent)\s+(?:\d+|one|two|three|six|nine|ten|twelve|thirty|sixty|ninety)\s*[-\s]?\s*(?:day|days|week|weeks|month|months|year|years)\b/i;
for (const [label, from, to] of ORPHAN_REGIONS) {
  const seg = region(seam, from, to);
  check(seg.length > 0,
    `#7: ${label} is still locatable (its anchors survive)`,
    `${SEAM}: could not locate the ${label} between "${from}" and "${to}" — the section was ` +
    `renamed or removed, so the no-time-window check below cannot run and would pass vacuously`);
  const hit = seg.match(WINDOW_RE);
  check(seg.length > 0 && hit === null,
    `#7: ${label} scopes to NO rolling time window (nothing ages out)`,
    `${SEAM}: the ${label} has re-introduced a rolling time window ("${hit?.[0]?.trim()}"). That ` +
    `is exactly what the 2026-08-28 rewrite removed: a window silently ages out older repairs, so ` +
    `a four-month-old decayed invariant falls out of scope entirely — the opposite of the point. ` +
    `Coverage is permanent; rotation is oldest-first.`);
}

check(has(seam, 'Every repair anyone lands gets registered — including the other six routines’ and your own')
   || has(seam, "Every repair anyone lands gets registered — including the other six routines' and your own"),
  '#7: every repair anyone lands must be registered, other routines\' included',
  `${SEAM} no longer requires every repair anyone lands (including the other six routines') to be ` +
  `registered — an unregistered repair is invisible to the rotation forever`);

check(has(seam, 'did rows that already existed change meaning, and would it be wrong if they drifted back'),
  '#7: "important repair" has an actionable definition, not a judgment call',
  `${SEAM} lost the concrete test for what counts as an important repair. Without it the ` +
  `registration duty is unenforceable and the registry fills unevenly.`);

check(has(seam, 'scripts/verify-repair-migrations-are-guarded.ts'),
  '#7: the registry stays tied to the merge-time half of the same rule',
  `${SEAM} no longer points at scripts/verify-repair-migrations-are-guarded.ts — the two halves ` +
  `(a repair must SHIP a detector; the detector must STILL watch it) would drift apart`);

// ── 9. Structural: the owner-locked roster still names both routines ──────────────────────────
check(/exactly\s+(FOUR|FIVE|SIX|SEVEN|EIGHT|NINE)\s+separate cloud routines/i.test(routines),
  'ENGINEER_ROUTINES.md is still owner-locked at an explicit routine count',
  `${ROUTINES} no longer states an explicit owner-locked routine count — duplicate/overlapping ` +
  `engineers are exactly what the owner said not to create`);

check(/Journey & Persistence Engineer/i.test(routines) && /Systems Seam Engineer/i.test(routines),
  'ENGINEER_ROUTINES.md still lists routines #6 and #7 by name',
  `${ROUTINES} no longer lists both the Journey & Persistence Engineer (#6) and the Systems Seam ` +
  `Engineer (#7) — the roster and these contracts have drifted apart`);

check(has(routines, 'ops_repair_guarantee_registry') && has(routines, 'least-recently-verified'),
  'ENGINEER_ROUTINES.md #7 entry agrees with the spec: named registry, no window, oldest-first',
  `${ROUTINES}'s #7 entry no longer matches the spec's registry rules — the roster summary is ` +
  `what a reader meets first, so a stale summary re-teaches the 90-day window it replaced`);

// ── 10. The load-bearing links — a contract only governs while something routes agents to it ──
for (const spec of [JOURNEY, SEAM]) {
  check(routines.includes(spec),
    `ENGINEER_ROUTINES.md routes agents to ${spec}`,
    `${ROUTINES} stopped pointing at ${spec} — the contract only governs while the roster links it`);
}

check(agents.includes('docs/ops/ENGINEER_ROUTINES.md'),
  'AGENTS.md routes agents to the routines roster (and through it, to both specs)',
  `${AGENTS} stopped pointing at ${ROUTINES}. AGENTS.md loads into every session and is declared ` +
  `as overriding; if it stops routing to the roster, nothing reaches these two contracts at all.`);

// ── 11. Worthless if nothing runs it ──────────────────────────────────────────────────────────
check(readFileSync('package.json', 'utf8').includes('verify-journey-seam-engineer-contracts'),
  'npm test runs this guard',
  'package.json no longer runs verify-journey-seam-engineer-contracts.ts — the guard is inert');

console.log(
  'journey-seam-contracts: #6 and #7 must keep granting completion, keep their limits narrow,\n' +
  '                        and keep the 2026-08-28 additions that make each run honest\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(
    `\n❌ ${problems.length} check(s) failed — the Journey (#6) / Systems Seam (#7) contracts have ` +
    `been weakened, widened, or unlinked.`);
  process.exit(1);
}
console.log(`\n✅ journey-seam-contracts: passed (${ok.length} checks).`);
