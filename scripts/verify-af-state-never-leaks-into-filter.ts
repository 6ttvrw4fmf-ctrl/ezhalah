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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// The sanitizer is only meaningful if it actually drops AF fields. Assert against the real allowlist
// rather than trusting its name — this is the thing the fix leans on.
const defaults = read('src/lib/searchDefaults.ts');
const sanitizer = defaults.slice(defaults.indexOf('export function sanitizeForFilterRestore'));
const sanitizerBody = sanitizer.slice(0, sanitizer.indexOf('\n}\n') + 1);
for (const af of ['amenities', 'bathMin', 'furnishedPref', 'streetWidthMin', 'directions', 'ratingMin', 'reviewsMin', 'unitSubtypes']) {
  assert(!sanitizerBody.includes(af), `sanitizeForFilterRestore does not carry AF field "${af}" into the Filter store`);
}

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
