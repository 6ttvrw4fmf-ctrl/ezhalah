// ADVANCED FILTER GROUP REACHABILITY — is the interview actually reachable from the controls the
// app ships? (AF + Trending Data Integrity run, 2026-08-23)
//
// WHY THIS EXISTS
// ---------------
// Six live browser journeys across two runs (2026-08-23) tapped «خلّنا نحدد الطلب أكثر» on broad
// Rent and Buy searches and NEVER got the Advanced Filter card — every one fell through to the
// legacy district refine chips. Nothing was broken in the gate that decides it. The cause is a
// composition of three separately-correct rules:
//
//   1. `cohortAllows()` intersects across EVERY selected clean type (owner 2026-08-20) — a scope
//      must not be offered a question only some of its types carry;
//   2. an UNCERTIFIED type (no `COHORT_QUESTIONS` entry) is treated as an EMPTY cohort, never as
//      "no constraint" (afCohorts.ts:226) — deliberately conservative;
//   3. `MIN_USEFUL_QUESTIONS_TO_SHOW = 2` (owner 2026-08-22).
//
// Put together: ONE uncertified type inside a shipped GROUP zeroes Advanced Filter for that whole
// group, and the user simply never sees the feature. «Villas & Houses» is exactly this — `Duplex`
// has no cohort entry, so the group intersects to zero questions even though `Villa` alone allows
// six. Measured the same day on Jeddah / Rent / villas group: all six of Villa's questions clear
// scoreQuestion() on the live counts (845 in scope: rnpl 440, kitchen 510, bath 503/467/448/384,
// unfurnished 357, street-width 637/266/147/80, all eight directions ≥14) — and the interview still
// cannot open, because the group carries Duplex alongside Villa.
//
// WHAT THIS BARRIER DOES — AND DELIBERATELY DOES NOT DO
// -----------------------------------------------------
// It does NOT change which questions a type allows. Deciding whether a Duplex/Chalet/Camp/Factory/
// Staff Housing scope should be asked about bathrooms or street width is a TAXONOMY + PRODUCT call
// and belongs to the owner (docs/ops/AGENT_AUTHORITY.md RED list), not to an autonomous run.
//
// It makes the situation IMPOSSIBLE TO SHIP BLIND, in both directions:
//   • the uncertified-type set is RATCHETED: adding a new type to a shipped group without a cohort
//     entry fails CI (that is how Duplex/Chalet/Camp got in unnoticed), and certifying one of them
//     also fails, so the pinned baseline below has to be updated on purpose;
//   • the per-group reachability matrix is PINNED, so any edit that flips a shipped group between
//     "Advanced Filter can open" and "cannot" is loud on the PR that causes it, instead of being
//     discovered months later by a browser journey.
//
// `cohortAllows` is pure (src/lib/afCohorts.ts) and `propertyTypes` is data, so this barrier
// EXECUTES the real gate against the real shipped groups rather than grepping source text — the
// same precedent verify-af-narrowing-gate.ts set for scoreQuestion().
//
//   node --experimental-strip-types scripts/verify-af-group-cohort-coverage.ts   (wired into `npm test`)

import { groupsFor, groupMembers } from '../src/data/propertyTypes.ts';
import { cohortAllows, COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';

const MACROS = ['Residential', 'Commercial'] as const;

// Every question id the AF pool can offer whose scope gate is cohortAllows(). `property_age` is
// deliberately absent: its eligibility is isAgeFilterScopeFor(), not a cohort, so counting it here
// would misreport what this gate decides.
const COHORT_GATED_IDS = [
  'rnpl', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype',
] as const;

// The deal/period shapes a user can actually be in.
const SHAPES: Array<{ label: string; extra: Record<string, unknown> }> = [
  { label: 'Buy', extra: { deal: 'Buy' } },
  { label: 'Rent/Annual', extra: { deal: 'Rent', rentPeriod: 'annual' } },
  { label: 'Rent/Monthly', extra: { deal: 'Rent', rentPeriod: 'monthly' } },
  { label: 'Rent/both', extra: { deal: 'Rent', rentPeriod: 'both' } },
  { label: 'Buy+Rent', extra: { deal: 'Rent', dealCombined: true } },
];

// ── BASELINE 1: group-member types with no COHORT_QUESTIONS entry ────────────────────────────────
// Each of these silently zeroes Advanced Filter for EVERY group that contains it. Pinned as of
// 2026-08-23 and reported to the owner as a product/taxonomy decision — NOT waived, and not to be
// grown. Shrinking it is the goal; either direction must be a deliberate edit to this list.
const UNCERTIFIED_IN_SHIPPED_GROUPS = [
  'Camp', 'Chalet', 'Duplex', 'Factory', 'Service Facilities', 'Staff Housing',
].sort();

// ── BASELINE 2: how many cohort-gated questions each shipped group allows, per shape ─────────────
// A 0 means Advanced Filter is UNREACHABLE for that group+shape; a 1 means it is unreachable too,
// because MIN_USEFUL_QUESTIONS_TO_SHOW is 2. Pinned so a change is visible on the PR that causes it.
const EXPECTED: Record<string, Record<string, number>> = {
  'Apartments & Co-living': { Buy: 0, 'Rent/Annual': 1, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Villas & Houses': { Buy: 0, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Vacation & Rural': { Buy: 0, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Residential Plots': { Buy: 2, 'Rent/Annual': 2, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Retail & Workspace': { Buy: 1, 'Rent/Annual': 1, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Industrial & Logistics': { Buy: 0, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Commercial Buildings & Facilities': { Buy: 0, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Commercial & Industrial Plots': { Buy: 2, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
};

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

// ── 1. the uncertified-type ratchet ──────────────────────────────────────────────────────────────
const found = new Set<string>();
const shippedGroups: Array<{ macro: string; group: string; types: string[] }> = [];
for (const macro of MACROS) {
  for (const g of groupsFor(macro)) {
    const types = groupMembers(g.group);
    shippedGroups.push({ macro, group: g.group, types });
    for (const t of types) {
      if (!(COHORT_QUESTIONS as Record<string, unknown>)[t]) found.add(t);
    }
  }
}
const actual = [...found].sort();
if (JSON.stringify(actual) !== JSON.stringify(UNCERTIFIED_IN_SHIPPED_GROUPS)) {
  const added = actual.filter((t) => !UNCERTIFIED_IN_SHIPPED_GROUPS.includes(t));
  const removed = UNCERTIFIED_IN_SHIPPED_GROUPS.filter((t) => !actual.includes(t));
  if (added.length) {
    fail(
      `NEW uncertified type(s) inside a shipped group: ${JSON.stringify(added)}.\n` +
      `      A type with no COHORT_QUESTIONS entry is an EMPTY cohort (afCohorts.ts:226), and\n` +
      `      cohortAllows() intersects across every selected type — so this ALONE makes Advanced\n` +
      `      Filter unreachable for every group containing it. Give it a cohort entry, or update the\n` +
      `      baseline in this file deliberately and say why.`,
    );
  }
  if (removed.length) {
    fail(
      `Type(s) newly certified: ${JSON.stringify(removed)} — good. Update\n` +
      `      UNCERTIFIED_IN_SHIPPED_GROUPS (and EXPECTED below) in this file to match.`,
    );
  }
}

// ── 2. the per-group reachability matrix ─────────────────────────────────────────────────────────
for (const { macro, group, types } of shippedGroups) {
  const expected = EXPECTED[group];
  if (!expected) {
    fail(
      `Shipped group "${group}" has no pinned Advanced Filter reachability row. Add one — a new\n` +
      `      group must never ship without someone having looked at whether AF can open for it.`,
    );
    continue;
  }
  for (const { label, extra } of SHAPES) {
    const q = { category: macro, types, cities: ['الرياض'], ...extra } as never;
    const n = COHORT_GATED_IDS.filter((id) => cohortAllows(q, id)).length;
    if (n !== expected[label]) {
      fail(
        `"${group}" / ${label}: ${n} cohort-gated question(s) eligible, pinned ${expected[label]}.\n` +
        `      Advanced Filter needs MIN_USEFUL_QUESTIONS_TO_SHOW (2) to open, so this changes\n` +
        `      whether the feature is reachable at all for that group. Intentional? Update the pin.`,
      );
    }
  }
}

// ── 3. the pins must describe reality, not an empty world ────────────────────────────────────────
// Guards the barrier against being neutered by a refactor that makes every lookup return nothing.
if (!shippedGroups.length) fail('no shipped groups found — propertyTypes import is broken');
if (Object.keys(COHORT_QUESTIONS).length < 10) {
  fail(`COHORT_QUESTIONS has only ${Object.keys(COHORT_QUESTIONS).length} entries — expected the full roster`);
}
const reachable = shippedGroups.filter(({ macro, types }) =>
  SHAPES.some(({ extra }) =>
    COHORT_GATED_IDS.filter((id) =>
      cohortAllows({ category: macro, types, cities: ['الرياض'], ...extra } as never, id)).length >= 2));
// As of 2026-08-23 exactly TWO of the eight shipped groups clear the 2-question floor in any shape
// («Residential Plots» and «Commercial & Industrial Plots»), so a run that finds zero has broken the
// gate itself rather than drifted a pin.
if (!reachable.length) {
  fail(
    'NO shipped group can open Advanced Filter in ANY deal/period shape. The pinned baseline expects\n' +
    '      two that can; a result of zero means cohortAllows() or the group data is broken, not that\n' +
    '      the pins drifted.',
  );
}

if (failures.length) {
  console.error('✗ verify-af-group-cohort-coverage FAILED\n');
  for (const f of failures) console.error(`   • ${f}\n`);
  process.exit(1);
}
console.log(
  `✓ AF group reachability pinned: ${shippedGroups.length} shipped groups × ${SHAPES.length} shapes; ` +
  `${UNCERTIFIED_IN_SHIPPED_GROUPS.length} uncertified type(s) held at baseline; ` +
  `${reachable.length} group(s) can open Advanced Filter.`,
);
