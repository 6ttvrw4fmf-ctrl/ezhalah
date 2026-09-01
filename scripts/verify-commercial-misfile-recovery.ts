// COMMERCIAL MISFILE RECOVERY — narrowing «فئة تجاري» to a نوع must never LOSE a listing.
//
// THE DEFECT THIS PINS (found live 2026-08-29, Search & Matching QA). A Commercial-macro listing can
// be physically stored in a *_residential_listings table. The BROAD «فئة تجاري» search already
// recovered those rows (resolveSearchScope's isBroadCommercial branch scans the residential tables
// for commercial types, owner 2026-07-09). A search NARROWED to a نوع did not — it read only the
// commercial tables — so the narrower filter returned FEWER matching listings than the broader one:
//
//   october_residential_listings:9618987  محل / إيجار / سنوي / مكة المكرمة / حي بطحاء قريش
//     «فئة تجاري»                        → 7 results, the listing among them
//     «فئة تجاري» + «نوع محل»            → 2 results, the listing GONE
//     the same narrowed request + scope2 → 3 results: exactly the one misfiled row, nothing else
//
// That is the Residential FIX A of 2026-07-10 in reverse, and its own header comment already named
// this failure: rows "reachable by NO search (and specific searches reached them only for the clean
// types whose CleanQuery.kinds already spans both tables)".
//
// WHICH TYPES THE CLASS COVERS — computed here from the taxonomy, never hardcoded: exactly the
// Commercial clean types whose CleanQuery.kinds is ['com'] alone. Every other commercial type
// already spans both table kinds and was never affected.
//
// WHY عمارة MUST BE EXCLUDED, and why that is the dangerous half. «عمارة» is the one dual type_ar:
// in a COMMERCIAL table it is a Commercial Building, in a RESIDENTIAL table it is an apartment
// block. It is in «مبنى تجاري»'s type_ar list. If the recovery scope carried it, a Commercial search
// would pull Residential Buildings out of the residential tables — 10,477 production-ready rows on
// 2026-08-29. The fix therefore scopes its types through COMMERCIAL_TYPE_AR_RES (عمارة excluded),
// exactly as its residential mirror uses RESIDENTIAL_TYPE_AR_COM.
//
//   node --experimental-strip-types scripts/verify-commercial-misfile-recovery.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_MACRO, CLEAN_TO_TYPE_AR, queryForTypes } from '../src/data/propertyTypes.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Strip comments, so prose describing a rule can never satisfy the check for that rule.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nCommercial misfile recovery — a narrower نوع filter never returns fewer matching listings\n');

const remoteSrc = read('src/data/remote.ts');
const remote = codeOnly(remoteSrc);

// ── 1. the taxonomy facts the fix rests on ───────────────────────────────────────────────────────
// These come from src/data/propertyTypes (the single source of truth), so the class is measured,
// not asserted: if a future taxonomy edit gives one of these types both kinds, this section moves
// with it instead of silently pinning a stale list.
const commercialCleans = Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Commercial');
const comOnly = commercialCleans.filter((c) => {
  const q = queryForTypes([c]);
  return !!q && q.kinds.length === 1 && q.kinds[0] === 'com';
});
check('the affected class is non-empty (commercial types that read ONLY commercial tables)',
  comOnly.length > 0,
  'if this is empty the taxonomy changed shape — re-derive the class before trusting the rest');
console.log(`      class = ${comOnly.length} clean type(s): ${comOnly.join(', ')}`);

const dualTypeAr = 'عمارة';
const carriesAmara = comOnly.filter((c) => (CLEAN_TO_TYPE_AR[c] ?? []).includes(dualTypeAr));
check(`at least one affected type carries the dual «${dualTypeAr}» label (so the exclusion is load-bearing)`,
  carriesAmara.length > 0,
  `«${dualTypeAr}» means Commercial Building in a commercial table and an apartment block in a `
  + 'residential one; a recovery scope carrying it would leak Residential Buildings into Commercial results');

// ── 2. the commercial recovery scope exists, and is gated exactly like its mirror ────────────────
check('resolveSearchScope computes a COMMERCIAL misfile scope (attachComScopeB)',
  /const\s+attachComScopeB\s*=/.test(remote),
  'without it, narrowing «فئة تجاري» to a نوع drops every Commercial row misfiled into a residential table');

check('the commercial scope is gated on a Commercial, NON-broad search',
  /attachComScopeB\s*=\s*q\.category\s*===\s*'Commercial'\s*&&\s*!isBroadCommercial/.test(remote),
  'a broad Commercial search already recovers these rows through its own branch; re-attaching would double-scope it');

check('…and only when it actually has types AND tables to add',
  /attachComScopeB[\s\S]{0,160}?comMisfileTypes\.length\s*>\s*0[\s\S]{0,60}?comScopeBTables\.length\s*>\s*0/.test(remote),
  'an empty scope2 must stay null rather than being sent as an empty array');

// ── 3. عمارة is excluded — the purity half ───────────────────────────────────────────────────────
check('the recovered TYPES come from COMMERCIAL_TYPE_AR_RES (عمارة excluded)',
  /const\s+comMisfileTypes\s*=[\s\S]{0,200}?COMMERCIAL_TYPE_AR_RES\.includes/.test(remote),
  'COMMERCIAL_TYPE_AR_COM / _ALL include عمارة and would leak Residential Buildings into a Commercial search');

check('COMMERCIAL_TYPE_AR_RES still excludes عمارة at its definition',
  /COMMERCIAL_TYPE_AR_RES\s*=\s*COMMERCIAL_TYPE_AR_ALL\.filter\(\(t\)\s*=>\s*t\s*!==\s*'عمارة'\)/.test(remote));

check('the recovered types are the SELECTED ones, never the whole commercial taxonomy',
  /const\s+comMisfileTypes\s*=\s*selectedTypeAr/.test(remote),
  'a نوع محل search must not silently widen to every commercial type');

// ── 4. the recovered TABLES are scoped, not the bare constant ────────────────────────────────────
check('the recovered TABLES are the residential set the broad search scans, minus the main scope',
  /const\s+comScopeBTables\s*=\s*platformScope\(\s*resTables\(q\)\.filter\(\(t\)\s*=>\s*!mainTables\.includes\(t\)\)\s*\)/.test(remote),
  'resTables(q) (not the bare RES_TABLES constant) keeps the monthly-only sources in scope and makes the '
  + 'narrow result a subset of the broad one by construction; subtracting mainTables keeps مكتب\'s '
  + 'extraTables from being scanned twice');

check('platformScope is applied, so «show me platform X only» still constrains the recovery scope',
  /comScopeBTables\s*=\s*platformScope\(/.test(remote),
  'the 2026-07-16 no-silent-widening rule: a platform filter must never be dropped by a secondary scope');

// ── 5. the flag is actually CONSUMED — a computed-but-unused flag is decoration ──────────────────
check('scopeB consumes attachComScopeB',
  /scopeB\s*=[\s\S]{0,400}?attachComScopeB\s*\?[\s\S]{0,120}?p_tables2:\s*comScopeBTables[\s\S]{0,60}?p_types2:\s*comMisfileTypes/.test(remote),
  'computing the scope without sending it changes nothing at all');

check('the broad-Commercial branch still wins over it (checked first)',
  remote.indexOf('isBroadCommercial\n    ? { p_tables2: tables') < remote.indexOf('attachComScopeB')
  || /scopeB\s*=\s*isBroadCommercial[\s\S]{0,600}?attachComScopeB/.test(remote),
  'the broad branch scans the residential tables as its MAIN scope; the recovery branch must not preempt it');

// ── 6. the residential mirror is untouched — a fix that breaks its twin is not a fix ─────────────
check('the RESIDENTIAL misfile scope still exists and still excludes عمارة',
  /const\s+attachResScopeB\s*=\s*q\.category\s*===\s*'Residential'\s*&&\s*!isBroadCommercial/.test(remote)
  && /RESIDENTIAL_TYPE_AR_COM\.includes/.test(remote));

// ── 7. MUTATION PROOFS — every check above must FAIL on the pre-fix / mis-fixed source ───────────
// A barrier nobody has seen fail is a barrier nobody has tested.
type Mutation = { name: string; apply: (s: string) => string; predicate: (s: string) => boolean };
const mutations: Mutation[] = [
  {
    name: 'PRE-FIX source (no commercial recovery scope at all)',
    apply: (s) => s.replace(/const\s+attachComScopeB\s*=/, 'const unusedComFlag ='),
    predicate: (s) => /const\s+attachComScopeB\s*=/.test(s),
  },
  {
    name: 'recovery carries عمارة (would leak Residential Buildings into a Commercial search)',
    apply: (s) => s.replace(/COMMERCIAL_TYPE_AR_RES\.includes/, 'COMMERCIAL_TYPE_AR_COM.includes'),
    predicate: (s) => /const\s+comMisfileTypes\s*=[\s\S]{0,200}?COMMERCIAL_TYPE_AR_RES\.includes/.test(s),
  },
  {
    name: 'recovery widens to the whole commercial taxonomy instead of the selected نوع',
    apply: (s) => s.replace(/const\s+comMisfileTypes\s*=\s*selectedTypeAr/, 'const comMisfileTypes = COMMERCIAL_TYPE_AR_RES'),
    predicate: (s) => /const\s+comMisfileTypes\s*=\s*selectedTypeAr/.test(s),
  },
  {
    name: 'platform filter dropped from the recovery scope (silent widening)',
    apply: (s) => s.replace(/const\s+comScopeBTables\s*=\s*platformScope\(/, 'const comScopeBTables = ('),
    predicate: (s) => /comScopeBTables\s*=\s*platformScope\(/.test(s),
  },
  {
    name: 'scope computed but never sent (decoration)',
    apply: (s) => s.replace(/p_tables2:\s*comScopeBTables/, 'p_tables2: null as string[] | null'),
    predicate: (s) => /scopeB\s*=[\s\S]{0,400}?attachComScopeB\s*\?[\s\S]{0,120}?p_tables2:\s*comScopeBTables[\s\S]{0,60}?p_types2:\s*comMisfileTypes/.test(s),
  },
];

for (const m of mutations) {
  const mutated = codeOnly(m.apply(remoteSrc));
  const stillPasses = m.predicate(mutated);
  check(`mutation caught — ${m.name}`, !stillPasses,
    'this check passes on deliberately broken source, so it cannot protect anything');
}

// ── 8. this file is really wired into `npm test` ─────────────────────────────────────────────────
check('this barrier runs in `npm test`', npmTestRuns(root, 'verify-commercial-misfile-recovery'),
  'a barrier that nothing invokes is decoration');

if (failures > 0) {
  console.error(`\nverify-commercial-misfile-recovery: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nverify-commercial-misfile-recovery: all checks passed');
