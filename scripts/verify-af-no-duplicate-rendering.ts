// ADVANCED FILTER — NO SEMANTIC DUPLICATE MAY EVER RENDER TWICE AT ONCE (owner audit, 2026-08-27).
//
// The owner's report: "the exact same thing should NEVER appear twice to the user at the same time
// — Gym + Gym, North + North, Apartment + Apartment, the same question twice in one round, the same
// chip duplicated anywhere in the same visible AF state — even if it arrives through two different
// data paths or has slightly different internal IDs." Different options together is completely fine;
// only exact same-concept duplicates are the bug.
//
// A whole-system audit (4 parallel investigations covering category/group/type chips, cohort
// question selection, in-question option/chip lists, and committed pills/receipts across rounds)
// found NO live, user-reachable duplicate today, but THREE places where the only thing preventing one
// was implicit data discipline, not a structural guarantee — exactly the "different data path/ID"
// risk named above:
//
//   1. AMENITIES_QUESTION.resolveOptions() (advancedFilters.ts) pushes 'sanitation' from TWO
//      independent branches (a pure-Villa branch and a chip-intersection branch). They're mutually
//      exclusive today only because COHORT_CHIPS has no 'Villa' entry — a future DATA-ONLY edit
//      (adding one) would silently double-push the identical chip.
//   2. scopeCandidates()'s TYPE tier (afPlan.ts), when the GROUP step is skipped, built its candidate
//      list via a raw `.flatMap()` with no dedup — unlike its sibling branch and the Filter home's
//      equivalent builder, both of which route through the Set-deduped `groupsMembers()`. Safe today
//      only because no clean type sits in two groups of the same macro; a future taxonomy edit could
//      break that silently.
//   3. Committed-answer facets/pills (afSteps.ts's deriveGuided, and the cross-round combine in
//      agent.tsx's finishGuided) were pure array concatenation with ZERO dedup by displayed label —
//      protected today only by the implicit "one concept = one question id" convention, which is an
//      editorial habit, not a compiler-checked invariant.
//
// The fix closes each class at its root (a guard at the push site, one deduped list-building path,
// and a reusable `dedupeFacetsByLabel` used at both the within-round and cross-round merge points),
// PLUS two backstops at the actual render/summary gateways every question and every pill funnels
// through regardless of which upstream path produced them: `AdvancedQuestionCard`'s option list and
// `buildAfSummary`'s final item list. Belt AND suspenders — a future bug anywhere upstream still
// cannot reach the user's screen as a visible duplicate.
//
//   node --experimental-strip-types scripts/verify-af-no-duplicate-rendering.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { scopeCandidates, SCOPE_TYPE_ID } from '../src/lib/afPlan.ts';
import { dedupeFacetsByLabel, deriveGuided, type GuidedFacet, type GuidedStep } from '../src/lib/afSteps.ts';
import { buildAfSummary } from '../src/lib/afSummary.ts';
import { HIERARCHY } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';
import type { AdvancedQuestion } from '../src/data/advancedFilters.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const eq = (label: string, got: unknown, want: unknown) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const advancedFilters = readFileSync(new URL('../src/data/advancedFilters.ts', import.meta.url), 'utf8');
const afPlan = readFileSync(new URL('../src/lib/afPlan.ts', import.meta.url), 'utf8');
const afStepsSrc = readFileSync(new URL('../src/lib/afSteps.ts', import.meta.url), 'utf8');
const afSummarySrc = readFileSync(new URL('../src/lib/afSummary.ts', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const questionCard = readFileSync(new URL('../src/components/AdvancedQuestionCard.tsx', import.meta.url), 'utf8');

console.log('\nAdvanced Filter — no semantic duplicate may ever render twice at once (owner audit 2026-08-27)\n');

// ═══ 1. Amenities double-push guard (advancedFilters.ts) ═══════════════════════════════════════════
check(
  "the second 'sanitation' push is guarded by a .some() check — the two branches can no longer both add the same key even if a future COHORT_CHIPS edit makes them both fire",
  /if \(!defs\.some\(\(d\) => d\.key === 'sanitation'\)\) \{\s*\n\s*defs\.push\(\{ key: 'sanitation', labelKey: 'Sewage connection', count: \(c\) => c\.cnt_sanitation \}\);\s*\n\s*\}/.test(advancedFilters),
);
{
  // EXECUTED: a faithful replica of the exact guard pattern, forcing BOTH branches to fire (the
  // scenario COHORT_CHIPS data prevents today) — proves the guard, not just its presence in source.
  type Def = { key: string; labelKey: string };
  function buildDefsReplica(villaBranchFires: boolean, chipBranchFires: boolean, guarded: boolean): Def[] {
    const defs: Def[] = [{ key: 'kitchen', labelKey: 'Kitchen' }, { key: 'parking', labelKey: 'Parking' }];
    if (villaBranchFires) {
      defs.push({ key: 'car_entrance', labelKey: 'Car entrance' });
      defs.push({ key: 'sanitation', labelKey: 'Sewage connection' });
    }
    if (chipBranchFires) {
      if (!guarded || !defs.some((d) => d.key === 'sanitation')) {
        defs.push({ key: 'sanitation', labelKey: 'Sewage connection' });
      }
      defs.push({ key: 'electricity', labelKey: 'Electricity' });
    }
    return defs;
  }
  const bothFireUnguarded = buildDefsReplica(true, true, false);
  check(
    'MUTATION PROOF — without the guard, forcing both branches produces TWO sanitation entries (proves this scenario is real, not hypothetical)',
    bothFireUnguarded.filter((d) => d.key === 'sanitation').length === 2,
  );
  const bothFireGuarded = buildDefsReplica(true, true, true);
  check(
    'WITH the guard, forcing both branches produces exactly ONE sanitation entry',
    bothFireGuarded.filter((d) => d.key === 'sanitation').length === 1,
  );
  const onlyChipGuarded = buildDefsReplica(false, true, true);
  check(
    "the guard never blocks the NORMAL single-branch case — sanitation still appears once when only the chip branch fires",
    onlyChipGuarded.filter((d) => d.key === 'sanitation').length === 1,
  );
}

// ═══ 2. Scope TYPE-tier candidates are ALWAYS deduped (afPlan.ts) ══════════════════════════════════
check(
  'scopeCandidates() no longer has a raw, unguarded .flatMap() branch — both branches route through the Set-deduped groupsMembers()',
  /return groupsMembers\(groups\.length \? groups : groupsFor\(macro\)\.map\(\(g\) => g\.group\)\);/.test(afPlan) &&
    !/groupsFor\(macro\)\.flatMap\(\(g\) => g\.types\)/.test(afPlan),
);
{
  const RENT = (extra: Partial<SearchQuery> = {}): SearchQuery =>
    ({ deal: 'Rent', rentPeriod: 'annual', category: 'Residential', location: 'الرياض',
       type: null, detail: null, priceInput: '', priceBand: null, ...extra }) as SearchQuery;
  // EXECUTED against REAL taxonomy data — this is the regression guard the audit found missing: it
  // would catch a future taxonomy edit that puts one type in two groups of the same macro, which the
  // OLD unguarded .flatMap() could never have caught.
  for (const macro of ['Residential', 'Commercial'] as const) {
    const types = scopeCandidates(SCOPE_TYPE_ID, RENT({ category: macro }));
    check(
      `${macro}: group-skipped TYPE candidates contain zero duplicates against the REAL live HIERARCHY (types: ${types.length})`,
      new Set(types).size === types.length,
    );
  }
  // MUTATION PROOF: a hand-built HIERARCHY-shaped structure with ONE type deliberately shared by two
  // groups — proves the fix's actual mechanism (groupsMembers' Set) would catch it, and that the OLD
  // unguarded flatMap it replaced would NOT have.
  const corruptHierarchy = [
    { group: 'Group A', types: ['Apartment', 'Villa'] },
    { group: 'Group B', types: ['Villa', 'Studio'] }, // 'Villa' duplicated across groups
  ];
  const oldUnguardedFlatMap = corruptHierarchy.flatMap((g) => g.types);
  const newGroupsMembersReplica = [...new Set(corruptHierarchy.flatMap((g) => g.types))];
  check(
    'MUTATION PROOF — the OLD unguarded .flatMap() pattern DOES produce a duplicate against a corrupted (shared-type) hierarchy, proving the scenario this fix guards against is real',
    oldUnguardedFlatMap.length !== new Set(oldUnguardedFlatMap).size,
  );
  check(
    "the fix's actual mechanism (Set-wrapped, matching groupsMembers()) removes that exact duplicate",
    newGroupsMembersReplica.length === new Set(newGroupsMembersReplica).size && newGroupsMembersReplica.includes('Villa'),
  );
  // Sanity: today's REAL hierarchy genuinely has no type shared across groups within a macro (belt AND
  // suspenders — the code-level fix stands regardless, but this documents the current data fact).
  for (const macro of ['Residential', 'Commercial'] as const) {
    const seen = new Set<string>();
    let dup = false;
    for (const g of HIERARCHY[macro]) for (const ty of g.types) { if (seen.has(ty)) dup = true; seen.add(ty); }
    check(`${macro}: today's real HIERARCHY has no type shared across two groups of the same macro`, !dup);
  }
}

// ═══ 3. Committed facets/pills deduped by resolved label, within AND across rounds (afSteps.ts) ═══
check(
  'dedupeFacetsByLabel() is exported from afSteps.ts, the ONE shared helper for both merge points',
  /export function dedupeFacetsByLabel\(facets: readonly GuidedFacet\[\]\): GuidedFacet\[\] \{/.test(afStepsSrc),
);
check(
  "deriveGuided()'s labels array is DERIVED from the deduped facets (flatMap), never built alongside them — the flat summary sentence can never carry a stray duplicate the pill list itself doesn't have",
  /const dedupedFacets = dedupeFacetsByLabel\(facets\);\s*\n\s*return \{ query, askedIds, labels: dedupedFacets\.flatMap\(\(f\) => f\.labels\), facets: dedupedFacets \};/.test(afStepsSrc),
);
check(
  "agent.tsx's cross-round combine (carry + this round's facets) calls dedupeFacetsByLabel — not a raw spread",
  /facets: dedupeFacetsByLabel\(\[\.\.\.\(carry\?\.facets \?\? \[\]\), \.\.\.ageFlowFacetsRef\.current\]\)/.test(agent),
);
check(
  'a chat restored from a saved transcript (openSaved) is ALSO deduped — a chat saved before this fix shipped cannot resurrect a baked-in duplicate pill',
  /const rgp = restored\.guidedPills as \{ facets\?: GuidedFacet\[\] \} \| null \| undefined;\s*\n\s*setGuidedPills\(\(rgp && rgp\.facets \? \{ \.\.\.rgp, facets: dedupeFacetsByLabel\(rgp\.facets\) \} : rgp\) as any\);/.test(agent),
);

{
  // EXECUTED — dedupeFacetsByLabel itself: the exact "different id, same label" scenario the owner
  // named ("even if it arrives through two different data paths or has slightly different internal
  // IDs") is the PRIMARY case this proves, not an edge case.
  const north: GuidedFacet = { id: 'direction', keys: ['n'], labels: ['North'] };
  const northAgain: GuidedFacet = { id: 'a_totally_different_question_id', keys: ['x'], labels: ['North'] };
  const pool: GuidedFacet = { id: 'amenities', keys: ['pool'], labels: ['Pool'] };
  const deduped = dedupeFacetsByLabel([north, pool, northAgain]);
  check(
    'two facets with DIFFERENT ids but the SAME resolved label collapse to ONE — the exact "different data path/ID" case named in the report',
    deduped.length === 2 && deduped.filter((f) => f.labels.join('، ') === 'North').length === 1,
  );
  check('a genuinely different concept (Pool) is never touched by the dedup', deduped.some((f) => f.labels.join('، ') === 'Pool'));
  check('the LAST occurrence of a duplicate survives (a later/newer answer for the same concept wins)', deduped.find((f) => f.labels.join('، ') === 'North')?.id === 'a_totally_different_question_id');
  check('facets with genuinely different labels are all kept — dedup never removes legitimate different options', dedupeFacetsByLabel([north, pool]).length === 2);
  check('an empty facets array stays empty', dedupeFacetsByLabel([]).length === 0);

  // EXECUTED — deriveGuided integration: two steps whose answers resolve to the SAME label (the
  // amenities-landmine shape, reproduced structurally) collapse to one facet AND one label entry.
  const mkStep = (question: Pick<AdvancedQuestion, 'id' | 'apply'>, options: GuidedFacet['labels'], keys: string[] | null): GuidedStep =>
    ({ question: question as AdvancedQuestion, options: options.map((label, i) => ({ key: `k${i}`, label, count: 1 })), unknownCount: 0, total: 100, keys });
  const passthroughApply = (q: SearchQuery) => q;
  const steps: GuidedStep[] = [
    mkStep({ id: 'q1', apply: passthroughApply }, ['North'], ['k0']),
    mkStep({ id: 'q2_different_id_same_label', apply: passthroughApply }, ['North'], ['k0']),
    mkStep({ id: 'q3', apply: passthroughApply }, ['Pool'], ['k0']),
  ];
  const derived = deriveGuided({} as SearchQuery, steps, steps.length);
  eq('deriveGuided: within one round, two steps resolving to the SAME label collapse to ONE facet', derived.facets.length, 2);
  eq('deriveGuided: the flat labels array matches the deduped facet count exactly (no stray duplicate in the summary text either)', derived.labels, ['North', 'Pool']);
  eq('deriveGuided: askedIds still records BOTH question ids (asked-tracking is unaffected by label dedup — only the VISIBLE result is deduped)', derived.askedIds, ['q1', 'q2_different_id_same_label', 'q3']);
}

// ═══ 4. AdvancedQuestionCard — belt-and-suspenders dedup at the ONE render gateway ═════════════════
check(
  'AdvancedQuestionCard computes a dedupedOptions list (by resolved label) BEFORE rendering — the one component every question, current and future, funnels through',
  /const dedupedOptions = useMemo\(\(\) => \{\s*\n\s*const seen = new Set<string>\(\);\s*\n\s*return options\.filter\(\(o\) => \(seen\.has\(o\.label\) \? false : \(seen\.add\(o\.label\), true\)\)\);\s*\n\s*\}, \[options\]\);/.test(questionCard),
);
check(
  'the render loop maps over dedupedOptions, not the raw options prop',
  /\{dedupedOptions\.map\(\(o, i\) => \(/.test(questionCard) && !/\{options\.map\(\(o, i\) => \(/.test(questionCard),
);
{
  // EXECUTED — the exact dedup expression, copied verbatim from the component, run against a
  // synthetic options array with a same-label/different-key duplicate (the Gym/Gym, North/North
  // shape from the report) to prove the LOGIC, not just its presence in source.
  type Opt = { key: string; label: string; count: number };
  const dedupe = (options: Opt[]): Opt[] => {
    const seen = new Set<string>();
    return options.filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)));
  };
  const withDup: Opt[] = [
    { key: 'gym_a', label: 'Gym', count: 10 },
    { key: 'pool', label: 'Pool', count: 20 },
    { key: 'gym_b', label: 'Gym', count: 10 }, // different key, same label — the exact bug shape
  ];
  const result = dedupe(withDup);
  eq('EXECUTED: Gym (key=gym_a) + Pool + Gym (key=gym_b, DIFFERENT key) → collapses to [Gym, Pool], first occurrence kept', result, [{ key: 'gym_a', label: 'Gym', count: 10 }, { key: 'pool', label: 'Pool', count: 20 }]);
  check('genuinely different options (Gym, Pool, North) are ALL kept — dedup never removes legitimate different options', dedupe([{ key: 'a', label: 'Gym', count: 1 }, { key: 'b', label: 'Pool', count: 1 }, { key: 'c', label: 'North', count: 1 }]).length === 3);
  eq('MUTATION PROOF — without the dedup (raw pass-through), the same input keeps BOTH Gym entries', withDup.filter((o) => o.label === 'Gym').length, 2);
}

// ═══ 5. buildAfSummary — final item-level dedup (catches PARTIAL overlap between two facets) ═══════
check(
  'buildAfSummary dedupes the fully-rendered item list with a Set before joining into the sentence',
  /const dedupedItems = \[\.\.\.new Set\(items\)\];/.test(afSummarySrc) &&
    /return dedupedItems\.slice\(0, -1\)\.join\('، '\) \+ '، و' \+ dedupedItems\[dedupedItems\.length - 1\];/.test(afSummarySrc),
);
{
  // EXECUTED — the case facet-level dedup CANNOT catch: two DIFFERENT facet bundles (not identical,
  // so dedupeFacetsByLabel keeps both) that each independently expand to an overlapping ITEM. Both
  // ids are deliberately OUTSIDE buildAfSummary's hardcoded switch (any future question not yet given
  // its own case falls to `default:`, pushing bare labels) — a multi-select facet and a single-select
  // facet that partially overlap is exactly the shape facet-level dedup structurally cannot see,
  // since it only compares whole joined-label bundles, not individual exploded items.
  const overlapping: GuidedFacet[] = [
    { id: 'future_multi_select_question', keys: ['gym', 'pool'], labels: ['Gym', 'Pool'] },
    { id: 'another_future_question_different_id', keys: ['gym'], labels: ['Gym'] },
  ];
  check('dedupeFacetsByLabel alone does NOT collapse these (different bundles — "Gym، Pool" ≠ "Gym") — proving buildAfSummary\'s own dedup is load-bearing, not redundant', dedupeFacetsByLabel(overlapping).length === 2);
  const summary = buildAfSummary(overlapping);
  const gymCount = (summary.match(/Gym/g) ?? []).length;
  check(`buildAfSummary's final sentence contains "Gym" exactly ONCE despite two facets each naming it (got: "${summary}")`, gymCount === 1);
  check('the sentence still contains "Pool" — a genuinely distinct item is never dropped', summary.includes('Pool'));
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
check(
  'this barrier is wired into `npm test`',
  /verify-af-no-duplicate-rendering\.ts/.test(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
);

console.log('');
if (failed) {
  console.error(`AF no-duplicate-rendering barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('AF no-duplicate-rendering barrier: all checks passed');
