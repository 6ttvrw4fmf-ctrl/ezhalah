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
//   3. `MIN_USEFUL_QUESTIONS_TO_SHOW` (owner 2026-08-22; REVISED owner 2026-08-24 to 1 — a lone
//      useful question now opens and is asked, it no longer hides the feature).
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupsFor, groupMembers } from '../src/data/propertyTypes.ts';
import { cohortAllows, COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';

const MACROS = ['Residential', 'Commercial'] as const;

// THE OPENING THRESHOLD IS READ, NEVER RETYPED (fix 2026-08-26). This barrier used to hardcode
// `>= 2` for the reachability roll-up while advancedFilters.ts had already moved to 1 (owner
// 2026-08-24), so it measured a threshold production no longer used: the four groups whose ceiling
// is exactly 1 — «Apartments & Co-living», «Villas & Houses», «Retail & Workspace», «Industrial &
// Logistics» — open Advanced Filter live and were invisible to the pin. A regression zeroing any of
// them would have kept `reachable` at the same two plot groups and stayed green, which is the exact
// blind spot this file's own header promises to close. advancedFilters.ts is not standalone-
// importable under --experimental-strip-types (see verify-af-min-useful-questions-gate.ts's
// EXECUTION NOTE), so the constant is read from source the same way that barrier reads it; the
// regex is anchored to the export so a rename fails loudly instead of silently defaulting.
const MIN_USEFUL_SRC = readFileSync(
  join(import.meta.dirname, '..', 'src/data/advancedFilters.ts'), 'utf8');
const MIN_USEFUL_MATCH = /export const MIN_USEFUL_QUESTIONS_TO_SHOW = (\d+);/.exec(MIN_USEFUL_SRC);
if (!MIN_USEFUL_MATCH) {
  console.error('✗ verify-af-group-cohort-coverage FAILED\n\n   • MIN_USEFUL_QUESTIONS_TO_SHOW is no '
    + 'longer declared as `export const MIN_USEFUL_QUESTIONS_TO_SHOW = <n>;` in\n'
    + '     src/data/advancedFilters.ts — this barrier cannot measure reachability against a\n'
    + '     threshold it cannot read. Update the regex here in the same change that renames it.\n');
  process.exit(1);
}
const MIN_USEFUL = Number(MIN_USEFUL_MATCH[1]);

// Every question id the AF pool can offer whose scope gate is cohortAllows(). `property_age` joined
// this list 2026-09-01: it used to have its own separate, single-type-only gate
// (isAgeFilterScopeFor(), src/lib/ageFilterTypes.ts, deleted) that could never fire for a group
// search regardless of what COHORT_QUESTIONS certified — the exact bug-class this file's baselines
// exist to catch. Now its eligibility IS cohortAllows(q, 'property_age'), so it behaves for a group
// scope exactly like every id already in this list: fires only when EVERY member type of the group
// certifies it for that deal/period.
const COHORT_GATED_IDS = [
  'rnpl', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype',
  'property_age',
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
  // Duplex and Factory were certified 2026-08-23 after a source audit (see afCohorts.ts). These four
  // were audited the same day and did NOT earn a cohort: Camp (4 rows rent-annual / 28 monthly, 0
  // fresh), Chalet (passes every DB gate but HALF of 24 source-adjudicated rows now have both
  // structured keys null on the live page), Staff Housing (3 rows / 1), Service Facilities (40 rows
  // total across six unrelated raw types, largest 11).
  'Camp', 'Chalet', 'Service Facilities', 'Staff Housing',
].sort();

// ── BASELINE 2: how many cohort-gated questions each shipped group allows, per shape ─────────────
// A 0 means Advanced Filter is UNREACHABLE for that group+shape. A 1 IS reachable (owner
// 2026-08-24: MIN_USEFUL_QUESTIONS_TO_SHOW is now 1, not 2) — the lone certified question opens
// and is asked. Pinned so a change to the underlying cohort data is visible on the PR that causes it.
const EXPECTED: Record<string, Record<string, number>> = {
  // Rent/Annual 1 -> 2 on 2026-09-01: property_age joined COHORT_GATED_IDS (age-gate unification —
  // it used to be single-type-only and could never fire for a group). Every member of this group
  // (Apartment, Room, Floor, Studio) certifies property_age for RentAnnual.
  'Apartments & Co-living': { Buy: 0, 'Rent/Annual': 2, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  // Buy 0 -> 1 on 2026-08-23: Duplex certified with its one source-verified field (bathrooms).
  'Villas & Houses': { Buy: 1, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Vacation & Rural': { Buy: 0, 'Rent/Annual': 0, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  'Residential Plots': { Buy: 2, 'Rent/Annual': 2, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  // Buy 1 -> 2, Rent/Annual 1 -> 2 on 2026-09-01: same property_age unification — every member of
  // this group (Office, Shop, Showroom) certifies property_age for both deals.
  'Retail & Workspace': { Buy: 2, 'Rent/Annual': 2, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
  // 0 -> 1 on both deals: Factory certified with street_width. Capped at 1 by Warehouse ∩ Workshop.
  'Industrial & Logistics': { Buy: 1, 'Rent/Annual': 1, 'Rent/Monthly': 0, 'Rent/both': 0, 'Buy+Rent': 0 },
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
        `      Advanced Filter needs MIN_USEFUL_QUESTIONS_TO_SHOW (now 1) to open, so this changes\n` +
        `      whether the feature is reachable at all for that group. Intentional? Update the pin.`,
      );
    }
  }
}

// ── 2b. the CEILING: is a group blocked by uncertified types, or by its certified ones? ──────────
// The 2026-08-23 audit's most actionable finding. Certifying every uncertified member of a group
// cannot lift it above the intersection of the members ALREADY certified — so a group whose ceiling
// is already < 2 can never be fixed by certification, however much inventory arrives. That is a
// PRODUCT question about the intersection rule, not a data question, and this pin makes the two
// cases distinguishable on sight instead of being rediscovered by another browser journey.
//
// `property_age` is now INCLUDED here (2026-09-01, see COHORT_GATED_IDS above) — its eligibility is
// cohortAllows(q, 'property_age') like every other id, so it counts toward a group's ceiling exactly
// like the rest whenever every member type of that group certifies it for the same deal.
// 2026-09-01: property_age joined COHORT_GATED_IDS (age-gate unification, see above), so every
// ceiling below was recomputed against real COHORT_QUESTIONS data with the SAME best-case-intersection
// method this section already used — property_age only raises a ceiling where every type WITH an
// entry for that deal also certifies property_age (never lowers one; a narrower id can only shrink
// an intersection, never grow it beyond what was already there).
const CEILING: Record<string, Record<string, number>> = {
  'Apartments & Co-living': { Buy: 1, 'Rent/Annual': 2, 'Rent/Monthly': 2 },
  'Villas & Houses': { Buy: 1, 'Rent/Annual': 7, 'Rent/Monthly': 3 },
  'Vacation & Rural': { Buy: 2, 'Rent/Annual': 3, 'Rent/Monthly': 0 },
  'Residential Plots': { Buy: 2, 'Rent/Annual': 2, 'Rent/Monthly': 0 },
  'Retail & Workspace': { Buy: 2, 'Rent/Annual': 2, 'Rent/Monthly': 0 },
  'Industrial & Logistics': { Buy: 1, 'Rent/Annual': 1, 'Rent/Monthly': 0 },
  'Commercial Buildings & Facilities': { Buy: 3, 'Rent/Annual': 2, 'Rent/Monthly': 0 },
  'Commercial & Industrial Plots': { Buy: 2, 'Rent/Annual': 0, 'Rent/Monthly': 0 },
};
const DEAL_KEYS: Array<[string, 'Buy' | 'RentAnnual' | 'RentMonthly']> = [
  ['Buy', 'Buy'], ['Rent/Annual', 'RentAnnual'], ['Rent/Monthly', 'RentMonthly'],
];
for (const { group, types } of shippedGroups) {
  const expected = CEILING[group];
  if (!expected) { fail(`Shipped group "${group}" has no pinned ceiling row.`); continue; }
  for (const [label, key] of DEAL_KEYS) {
    const certified = types.filter((t) => (COHORT_QUESTIONS as Record<string, Record<string, string[]>>)[t]?.[key]);
    let inter: string[] | null = null;
    for (const t of certified) {
      const list = ((COHORT_QUESTIONS as Record<string, Record<string, string[]>>)[t][key])
        .filter((q) => (COHORT_GATED_IDS as readonly string[]).includes(q));
      inter = inter === null ? list : inter.filter((q) => list.includes(q));
    }
    const ceil = certified.length ? (inter ?? []).length : 0;
    if (ceil !== expected[label]) {
      fail(
        `"${group}" / ${label}: best-case ceiling is ${ceil}, pinned ${expected[label]}. A ceiling\n` +
        `      below MIN_USEFUL_QUESTIONS_TO_SHOW (${MIN_USEFUL}) means NO amount of certifying that\n` +
        `      group's remaining types can ever open Advanced Filter for it — only a change to the\n` +
        `      intersection rule could.`,
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
      cohortAllows({ category: macro, types, cities: ['الرياض'], ...extra } as never, id)).length >= MIN_USEFUL));
// THE SET, NOT JUST ITS SIZE (fix 2026-08-26). The old check only asserted `reachable.length > 0`,
// which this file's header already promised to beat: "any edit that flips a shipped group between
// 'Advanced Filter can open' and 'cannot' is loud on the PR that causes it". A non-emptiness test
// cannot do that — with two plot groups permanently clearing the bar, every other group could
// regress to zero and the check would still pass. Pinning the NAMES makes each flip, in either
// direction, a named diff. Measured live 2026-08-26 at MIN_USEFUL_QUESTIONS_TO_SHOW = 1.
const REACHABLE_AT_MIN_USEFUL = [
  'Apartments & Co-living',        // Rent/Annual = 1
  'Commercial & Industrial Plots', // Buy = 2
  'Industrial & Logistics',        // Buy = 1, Rent/Annual = 1
  'Residential Plots',             // Buy = 2, Rent/Annual = 2
  'Retail & Workspace',            // Buy = 1, Rent/Annual = 1
  'Villas & Houses',               // Buy = 1
];
const reachableNames = reachable.map((g) => g.group).sort();
if (JSON.stringify(reachableNames) !== JSON.stringify(REACHABLE_AT_MIN_USEFUL)) {
  const gained = reachableNames.filter((g) => !REACHABLE_AT_MIN_USEFUL.includes(g));
  const lost = REACHABLE_AT_MIN_USEFUL.filter((g) => !reachableNames.includes(g));
  fail(
    `Advanced-Filter reachability moved at MIN_USEFUL_QUESTIONS_TO_SHOW = ${MIN_USEFUL}.\n` +
    (lost.length ? `      NO LONGER REACHABLE: ${lost.join(', ')} — a group that could open the\n` +
                   `      interview no longer can. This is a user-visible loss of the feature.\n` : '') +
    (gained.length ? `      NEWLY REACHABLE: ${gained.join(', ')} — if intended, add to the pin.\n` : '') +
    `      Pinned: [${REACHABLE_AT_MIN_USEFUL.join(', ')}]\n` +
    `      Actual: [${reachableNames.join(', ')}]`,
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
