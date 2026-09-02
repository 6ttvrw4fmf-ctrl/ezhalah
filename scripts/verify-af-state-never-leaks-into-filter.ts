// Two ways an Advanced Filter answer can act on a search the user is not looking at. Both were live
// on production 2026-09-01; both are one line; neither had a barrier. Discovered by a full AF
// correctness audit and each reproduced against the live index before the fix.
//
// 1. AF STATE LEAKING INTO THE FILTER STORE (P1).
//    Sidebar.openHistory() writes sanitizeForFilterRestore(query) into the shared store — the strict
//    allowlist of "what the Filter UI can actually show" — and then navigates with the UNSANITIZED
//    query in `?filter=`. agent.tsx's param effect then wrote that raw query straight back over the
//    sanitized one, parking every AF predicate in the store the Filter home binds to, with no control
//    on screen representing any of them and no way for the user to see or clear it.
//    Measured on production: reopen a monthly-rent chat that answered «التقييم ٩.٠+», then run an
//    unrelated الرياض/شراء/فيلا search → 0 of 11,552 rows (بيع inventory has ZERO rated rows, so a
//    leaked ratingMin is total). With amenities=[elevator]+bathMin=3 instead → 574 of 11,552.
//
// 2. RE-ASKING DIRECTION AFTER IT IS COMMITTED (P2).
//    apartment_guided_counts_ar computes cnt_dir_* inside a scope that ALREADY applies p_directions,
//    while DIRECTION_QUESTION.apply() UNIONS the tapped key. So once directions are committed, every
//    direction outside the set counts 0 — and tapping one WIDENS the results.
//    Measured on production (Buy/الرياض/عمارة, شمال+غرب committed): set 484; chips شمال 282, غرب 202,
//    جنوب 0, شرق 0; tapping the جنوب chip that advertises 0 returns 804.
//
// Both are asserted on SHAPE of the real source, because both fixes are a single expression that a
// refactor can silently drop. A comment is not a code path.
//
// ── AMENDED 2026-09-01 (owner P0: «no dropped filters» on a Filter re-entry) ─────────────────────
// The invariant this file protects was never "an AF predicate may not be in the store". It was
// "AN AF PREDICATE MAY NEVER BE ACTIVE WITH NO CONTROL ON SCREEN TO SEE AND CLEAR IT" — that is
// what made the leaked ratingMin above unfixable by the user. The owner's requirement (every
// committed Advanced Filter predicate must survive a return to the Filter screen, counts and
// eligible set included) collides with the literal reading and not with the real one, so the
// assertions below now pin the real one:
//
//   • WITHOUT the facet receipt — a sidebar restore of a foreign conversation, an agent-parsed
//     query — every AF field is still dropped. That is the measured P1, unchanged.
//   • WITH it, the predicates ride, AND the Filter screen must render them as removable chips.
//
// And they EXECUTE the real sanitizeForFilterRestore instead of grepping its body. The grep this
// replaced was a weak assertion by construction: the 2026-09-01 carry rewrote the function's
// behaviour completely and seven of its eight field checks still passed, because the field names
// had simply moved into a shared constant. Assert the behaviour, not the spelling.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeForFilterRestore, hasActiveFilters, AF_PREDICATE_FIELDS } from '../src/lib/searchDefaults.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ❌ FAIL  ${msg}`); failed++; }
};

// ── 1. agent.tsx must sanitize before writing the shared store ───────────────────────────────────
const agentTsx = read('src/app/agent.tsx');
// Strip comments FIRST. A prose mention of `setQuery(() => q)` is not a call — matching one would
// make this barrier fail (or pass) on documentation, which is the repo's standing
// "a comment is not a code path" trap in both directions. Line comments only: this file's block
// comments are prose, and a naive /* */ strip would eat JSX braces.
const agentCode = agentTsx.replace(/^\s*\/\/.*$/gm, '');

// Every setQuery in this screen writes the store the Filter home reads. There is exactly one, and it
// must be sanitized. Counting them matters: a second, unsanitized setQuery would reopen the hole
// while the assertion below still passed on the first.
const setQueryCalls = [...agentCode.matchAll(/setQuery\(\s*\(\)\s*=>\s*([^)]*)\)/g)].map((m) => m[1].trim());
assert(setQueryCalls.length === 1, `agent.tsx has exactly one setQuery writer (found ${setQueryCalls.length})`);
assert(
  setQueryCalls.every((arg) => arg.startsWith('sanitizeForFilterRestore(')),
  'every agent.tsx setQuery writes sanitizeForFilterRestore(...), never the raw agent query',
);
assert(
  /import\s*\{[^}]*\bsanitizeForFilterRestore\b[^}]*\}\s*from\s*'@\/lib\/searchDefaults'/.test(agentTsx),
  'agent.tsx imports sanitizeForFilterRestore (a call to a missing binding would not typecheck)',
);
// The replay path must NOT be sanitized — it needs the AF predicates to reproduce the conversation.
// Without this, "fixing" the leak by sanitizing everything would silently break chat restore.
assert(/openSaved\(hid,\s*q\b/.test(agentTsx), 'openSaved still replays the FULL query (AF predicates intact)');
assert(/sendFilter\(q\b/.test(agentTsx), 'sendFilter still receives the FULL query');

// ── 1b. THE SANITIZER, EXECUTED ─────────────────────────────────────────────────────────────────
// A query carrying every AF predicate the interview can commit. Values are deliberately "truthy but
// harmless" so a survivor is unmistakable; furnishedPref:false is here on purpose — false is a REAL
// answer (confirmed unfurnished), and a carry that only survives truthy values would turn it into
// "no preference", which is UNKNOWN becoming an answer.
const AF_LOADED: SearchQuery = {
  ...({ deal: 'Rent', location: 'الرياض', category: 'Commercial', type: null, detail: null,
        priceInput: '', priceBand: null, rentPeriod: 'annual' } as SearchQuery),
  types: ['محل'], typeGroups: ['Retail & Workspace'],
  ageMin: 3, ageMax: 5, isNewConstruction: true, amenities: ['elevator'], bathMin: 3,
  ratingMin: 9, reviewsMin: 10, unitSubtypes: ['استديو'], furnishedPref: false,
  streetWidthMin: 20, directions: ['شمال'],
};

// (a) NO RECEIPT ⇒ NO PREDICATE. This is the measured P1 verbatim: a sidebar restore of a foreign
// conversation must not park an invisible filter on the Filter form.
const noReceipt = sanitizeForFilterRestore(AF_LOADED);
for (const af of AF_PREDICATE_FIELDS) {
  assert(noReceipt[af] === undefined, `sanitizeForFilterRestore drops AF field "${af}" when no facet receipt rides with it`);
}
assert(noReceipt.afFacets === undefined, 'sanitizeForFilterRestore carries no facet receipt of its own');

// (b) WITH THE RECEIPT ⇒ THE PREDICATES RIDE. This is the owner requirement: a committed Advanced
// Filter must survive a return to the Filter screen — «no widening, no dropped filters».
const withReceipt = sanitizeForFilterRestore({
  ...AF_LOADED,
  afFacets: [{ id: 'property_age', keys: ['3_5'], labels: ['٣-٥ سنوات'] }],
});
for (const af of AF_PREDICATE_FIELDS) {
  assert(withReceipt[af] === AF_LOADED[af] || JSON.stringify(withReceipt[af]) === JSON.stringify(AF_LOADED[af]),
    `sanitizeForFilterRestore carries AF field "${af}" when its facet receipt rides with it`);
}
assert(withReceipt.afFacets?.length === 1, 'the facet receipt itself rides, so the chips have something to render');
// The receipt is what makes the carry legal, so the field must actually be part of SearchQuery —
// not an untyped extra that a refactor drops with no compile error anywhere.
assert(read('src/data/search.ts').includes('afFacets?:'), 'afFacets is a declared SearchQuery field');

// (c) VISIBILITY IS THE PRICE OF THE CARRY. Every carried facet has a control on the Filter screen
// that removes it. Without this the barrier would be licensing the exact invisible-filter state the
// leak above was, only reached down a different path.
const indexTsx = read('src/app/index.tsx');
assert(/query\.afFacets/.test(indexTsx), 'the Filter screen renders the carried facets');
assert(/withoutFacet\(/.test(indexTsx), 'the Filter screen can REMOVE a carried facet (withoutFacet)');
assert(/testID=\{`filter-af-chip-/.test(indexTsx), 'each carried facet gets its own removable chip (testID: filter-af-chip-N)');
// «مسح الكل» is the other half of "clearable": it is only rendered when hasActiveFilters() is true,
// so an AF-only narrowing must count as an active filter or the user gets chips with no reset.
assert(hasActiveFilters({ ...AF_LOADED, afFacets: [{ id: 'property_age', keys: ['3_5'], labels: ['x'] }] }),
  'a carried Advanced Filter counts as an active filter, so «مسح الكل» is offered');

// (d) THE CARRY MUST BE RE-CERTIFIED, NEVER REPLAYED BLIND. The Filter screen can move the cohort
// under a carried answer; the AF's SQL predicates are strict-NULL-excluding, so replaying an answer
// the new cohort never certified deletes every row that did not state the attribute — UNKNOWN
// becoming No, which is worse than the bug being fixed.
assert(/reconcileCommittedAf\(/.test(indexTsx), 'the Filter screen reconciles the carry against the CURRENT cohort');
assert(/cohortAllows\(/.test(read('src/lib/afCarry.ts')), 'the reconciliation gate is cohortAllows(), the same gate that decided the question could be asked');

// ── 2. direction is not re-asked once committed ──────────────────────────────────────────────────
const advanced = read('src/data/advancedFilters.ts');
const dirBlock = advanced.slice(advanced.indexOf('const DIRECTION_QUESTION'));
const dirEligibility = dirBlock.slice(dirBlock.indexOf('eligibility:'), dirBlock.indexOf('async resolveOptions'));
assert(
  /q\.directions\?\.length/.test(dirEligibility),
  'DIRECTION_QUESTION.eligibility is gated on q.directions being empty (chips cannot be counted against a scope that already applies them)',
);
// unit_subtype is the precedent this copies; if that guard disappears the shared reasoning is gone.
const subBlock = advanced.slice(advanced.indexOf('const UNIT_SUBTYPE_QUESTION'));
assert(
  /q\.unitSubtypes\?\.length/.test(subBlock.slice(0, subBlock.indexOf('async resolveOptions'))),
  'UNIT_SUBTYPE_QUESTION keeps the same already-answered guard',
);

// ── 3. executable proof of the count inversion the guard exists for ──────────────────────────────
// Pure arithmetic, no DB: cnt_dir_* is scoped by the committed directions, apply() unions. Model both
// and show the advertised number is not the delivered one. This is what makes the guard non-arbitrary.
const committed = new Set(['شمال', 'غرب']);
const rows = [ // direction → how many listings face it (production shape, Buy/الرياض/عمارة)
  { dir: 'شمال', n: 282 }, { dir: 'غرب', n: 202 }, { dir: 'جنوب', n: 320 }, { dir: 'شرق', n: 260 },
];
const inScope = (d: string) => committed.has(d);
const chipCount = (d: string) => rows.filter((r) => r.dir === d && inScope(r.dir)).reduce((a, r) => a + r.n, 0);
const afterTap = (d: string) => rows.filter((r) => inScope(r.dir) || r.dir === d).reduce((a, r) => a + r.n, 0);
const current = rows.filter((r) => inScope(r.dir)).reduce((a, r) => a + r.n, 0);
assert(chipCount('جنوب') === 0, 'an uncommitted direction advertises 0 (counted inside the committed scope)');
assert(afterTap('جنوب') > current, 'yet tapping it WIDENS the result set — the advertised 0 is inverted, not stale');

console.log(failed === 0
  ? '\n✅ verify-af-state-never-leaks-into-filter: all checks passed.'
  : `\n❌ verify-af-state-never-leaks-into-filter: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
