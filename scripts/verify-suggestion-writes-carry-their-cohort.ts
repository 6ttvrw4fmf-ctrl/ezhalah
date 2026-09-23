// A SUGGESTION LIST BELONGS TO THE COHORT IT WAS COMPUTED FOR — executed, not read.
//
// THE DEFECT (found 2026-09-23 by routine #8, ops_incident hunter-2026-09-23:incomplete_fix:
// city-district-suggestion-continuations-drop-the-cohort). Every city/district pool continuation in
// src/app/index.tsx carried a race guard, and every one of them re-checked exactly ONE of the six
// values it had captured. The guard's own words, in the City field's onFocus handler:
//
//     "GUARD (real race found in testing): ensureCityFieldIndex() resolves via a microtask even when
//      its data is already cached … Re-check the LIVE text via cityTextRef … at resolution time, not
//      the value captured in this closure at focus time."
//
// It then re-checked the text and nothing else. The other five captured values — deal, rent period,
// category, cohort types and the AF/table scope — ARE the pool's cache key, so a continuation that
// resolved after the user had left its cohort wrote the ABANDONED cohort's ranking and its «N إعلان»
// counts into the live dropdown, where nothing re-ran to correct them until the next keystroke.
//
// NOT A NARROW RACE. The pools are promise-cached per key (locations.ts `_cityFieldPromises`), so
// leaving a slow uncached cohort for one that is already warm — a type chip tapped twice, فيلا then
// back to شقة — makes the warm cohort resolve FIRST, correctly, and the abandoned fetch land on top
// of it. MEASURED on production that day via top_cities_by_deal_ar (إيجار / سنوي / Residential):
//     شقة   الرياض 11,167 · جدة 6,232 · الخبر 2,860 · الدمام 1,746 · مكة 577 · المدينة 415
//     فيلا  الرياض  4,090 · جدة   805 · الدمام  238 · الخبر   201 · مكة  59 · الجبيل   55
// a stale فيلا list on a شقة form understates الرياض by 2.7x and جدة by 7.7x, swaps ranks 3 and 4,
// and replaces المدينة المنورة with a city that is not in the apartment top six at all. The owner's
// rule for these numbers (2026-08-13) is that the number beside a location is what selecting it
// returns UNDER THE CURRENT SELECTIONS — so a stale-cohort count is wrong data, not a stale nicety.
//
// WHY IT IS SHAPED LIKE THIS. This is the same class as ops_incident #211/#271/#319/#341/#599 — an
// async continuation writing state that belongs to a context the user has already left — and #599's
// barrier (verify-conversation-state-never-inherited.ts §H) discovers it only inside agent.tsx, and
// only for `const x = async` / `async function x` shapes. These continuations are `.then()`
// callbacks in a different module, so they were outside every existing guard by construction.
//
// §A LIFTS the real retryCityPool / retryDistrictPool out of index.tsx — never a hand-copied
// duplicate, [[feedback_never-test-a-copy-of-production-code]] — and resolves their pool load with
// the cohort ALREADY CHANGED, asserting no write; and with the cohort unchanged, asserting the write
// still happens, so "never writes" cannot pass as a fix.
// §B DISCOVERS the class: every ensureCityFieldIndex/ensureDistrictOptions continuation in the file,
// found by shape, must route its suggestion write through the one guarded writer. No allowlist — a
// continuation added tomorrow is RED until it participates.
// §C pins that the cohort key covers EVERY argument the pool is keyed on, derived from the real call
// site's argument list rather than from a list someone has to remember to extend.
//
//   node --experimental-strip-types scripts/verify-suggestion-writes-carry-their-cohort.ts

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'src/app/index.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean, detail = '') =>
  check(`MUTATION — ${label}`, caught, detail);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §A — EXECUTION. The real handlers, with the user leaving the cohort inside the pool load.
//
// Everything here is inert scaffolding except the four lifted declarations: the two guarded writers
// and the two retry handlers. `world.leave` is the user tapping another property-type chip while the
// pool for the chip they just left is still in flight; the cohort refs are what the screen's own
// cohort effects keep current.
console.log('\n── §A: a pool continuation that resolves after the user left its cohort writes nothing ──');

const PRELUDE = `
const probe = { wrote: [] as string[] };
const world = { leave: true };
const clearBlurTimer = (_t: any) => {};
const cityBlurTimer = { current: null as any };
const districtBlurTimer = { current: null as any };
const cityRef = { current: { focus: () => {} } as any };
const districtRef = { current: { focus: () => {} } as any };
const cityTextRef = { current: '' };
const districtTextRef = { current: '' };
const setCitySuggestions = (v: any) => { if (Array.isArray(v) && v.length) probe.wrote.push('city:' + v.map((o: any) => o.cityAr).join(',')); };
const setDistrictSuggestions = (v: any) => { if (Array.isArray(v) && v.length) probe.wrote.push('district:' + v.map((o: any) => o.districtAr).join(',')); };
const isLatinOnlyInput = (_s: string) => false;
// Two cohorts whose lists are unmistakably different, so a write at all names which one it came from.
const POOLS: Record<string, any[]> = { 'فيلا': [{ cityAr: 'أبها-فيلا' }], 'شقة': [{ cityAr: 'الرياض-شقة' }] };
const DPOOLS: Record<string, any[]> = { 'فيلا': [{ districtAr: 'حي-فيلا' }], 'شقة': [{ districtAr: 'حي-شقة' }] };
const k = (types: any) => (Array.isArray(types) ? types.join(',') : String(types));
const LEFT_CITY = 'Rent||Residential|فيلا|null';
const LEFT_DISTRICT = '3|Rent||Residential|فيلا|null';
const cityCohortRef = { current: LEFT_CITY };
const districtCohortRef = { current: LEFT_DISTRICT };
const leaveCohort = () => {
  if (!world.leave) return;
  cityCohortRef.current = 'Rent||Residential|شقة|null';
  districtCohortRef.current = '3|Rent||Residential|شقة|null';
};
const ensureCityFieldIndex = async (_d: any, _p: any, _c: any, types: any, _af: any) => { leaveCohort(); return POOLS[k(types)] ?? []; };
const ensureDistrictOptions = async (_cid: any, _d: any, _c: any, _p: any, types: any, _s: any) => { leaveCohort(); return DPOOLS[k(types)] ?? []; };
const topCitiesByListings = (_d: any, _p: any, _c: any, _n: any, types: any, _af: any) => POOLS[k(types)] ?? [];
const matchCitiesByText = (_d: any, _p: any, _c: any, _t: any, types: any, _af: any) => POOLS[k(types)] ?? [];
const topDistrictsForCityId = (_cid: any, _d: any, _c: any, _p: any, _n: any, types: any, _s: any) => DPOOLS[k(types)] ?? [];
const matchDistrictsByCityId = (_cid: any, _d: any, _c: any, _p: any, _t: any, types: any, _s: any) => DPOOLS[k(types)] ?? [];
const effDeal: any = 'Rent'; const rentPeriodTok: any = ''; const effCategory: any = 'Residential';
const cohortTypes: any = ['فيلا']; const cohortTypesSig = 'فيلا';
const cityAfParams: any = null; const cityAfSig = 'null';
const cityTableScope: any = null; const cityTableScopeSig = 'null';
const citySelected: any = { cityId: 3 };
const cityCohortSig = LEFT_CITY;
const districtCohortSigOf = (cityId: number) => cityId + '|Rent||Residential|فيلا|null';
`;

const SYMBOLS = [
  { header: '  const writeCitySuggestionsForCohort = (cohort: string, showTopWhenEmpty: boolean) => {', endsWith: /^  \};$/ },
  { header: '  const writeDistrictSuggestionsForCohort = (cityId: number, cohort: string, showTopWhenEmpty: boolean) => {', endsWith: /^  \};$/ },
  { header: '  const retryCityPool = () => {', endsWith: /^  \};$/ },
  { header: '  const retryDistrictPool = () => {', endsWith: /^  \};$/ },
];

/** Drive both retry handlers against `file`; `leave` = the user changed cohort inside the fetch. */
async function writesAfter(file: string, leave: boolean): Promise<string[]> {
  const m = await liftSymbols(file, SYMBOLS, ['retryCityPool', 'retryDistrictPool', 'probe', 'world'], PRELUDE) as {
    retryCityPool: () => void; retryDistrictPool: () => void; probe: { wrote: string[] }; world: { leave: boolean };
  };
  m.world.leave = leave;
  m.retryCityPool();
  m.retryDistrictPool();
  await new Promise((r) => setTimeout(r, 20));
  return m.probe.wrote;
}

const left = await writesAfter(IDX, true);
check('a city/district pool that resolves after the user left its cohort writes NO suggestions',
  left.length === 0,
  `wrote ${JSON.stringify(left)} — that is the abandoned cohort's ranking and «N إعلان» counts on the live dropdown`);

// The positive control. Without it, deleting the body of both writers would pass §A.
const stayed = await writesAfter(IDX, false);
check('…and a pool that resolves while the user is STILL in its cohort populates the field as before',
  stayed.some((w) => w.startsWith('city:')) && stayed.some((w) => w.startsWith('district:')),
  `wrote ${JSON.stringify(stayed)} — the guard must discriminate, not mute the field`);

// ── mutations: the exact pre-fix source, one per writer ──
const src = readFileSync(IDX, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ezhalah-cohort-'));
for (const [label, guard] of [
  ['city', '    if (cityCohortRef.current !== cohort) return; // the user left this cohort while it was loading\n'],
  ['district', '    if (districtCohortRef.current !== cohort) return;\n'],
] as const) {
  check(`the real tree carries the ${label} writer's cohort check (the mutation below is meaningful)`,
    src.includes(guard), `anchor for ${label} no longer matches — re-anchor it rather than deleting the mutation`);
  const file = join(dir, `index-${label}.tsx`);
  writeFileSync(file, src.replace(guard, ''));
  const mutant = await writesAfter(file, true);
  mustCatch(`M-A-${label}-unguarded — deleting the ${label} writer's cohort check puts the abandoned cohort's list back on screen`,
    mutant.some((w) => w.startsWith(`${label === 'city' ? 'city' : 'district'}:`)),
    `writes after the mutation: ${JSON.stringify(mutant)}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §B — DISCOVERY. Every pool continuation in the file, found by shape.
//
// A `.then(` on an ensureCityFieldIndex/ensureDistrictOptions call is a continuation; a
// setCitySuggestions/setDistrictSuggestions inside that callback is a suggestion write. The write is
// legal only through the one guarded writer, or behind an explicit cancellation flag (the district
// REHYDRATION effect owns one: its cleanup sets `cancelled` and its deps carry the whole cohort).
console.log('\n── §B: every pool continuation routes its suggestion write through the guarded writer ──');

const WRITER_CALL = /\bwrite(City|District)SuggestionsForCohort\s*\(/;
const RAW_WRITE = /\bset(City|District)Suggestions\s*\(/;
const CANCEL_GUARD = /\bif\s*\(cancelled\)\s*return\b/;

/** "site@line: code" for every continuation whose callback writes suggestions unguarded. */
function unguardedContinuations(source: string): string[] {
  const lines = source.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(ensureCityFieldIndex|ensureDistrictOptions)\s*\(/.test(lines[i])) continue;
    if (!/\.then\s*\(/.test(lines[i])) continue;   // an awaited call is not a callback continuation
    const indent = (lines[i].match(/^\s*/) as RegExpMatchArray)[0].length;
    let guarded = false;
    for (let j = i + 1; j < lines.length; j++) {
      const bare = lines[j].replace(/\/\/.*$/, '');
      const tl = bare.trim();
      if (!tl) continue;
      // The callback ends at the `});` that closes back to the call's own depth.
      if (/^\}\s*\)\s*;?$/.test(tl) && (bare.match(/^\s*/) as RegExpMatchArray)[0].length <= indent) break;
      if (WRITER_CALL.test(bare) || CANCEL_GUARD.test(bare)) guarded = true;
      if (RAW_WRITE.test(bare) && !guarded) out.push(`${i + 1}→${j + 1}: ${tl.slice(0, 96)}`);
    }
  }
  return out;
}

const idxSrc = readFileSync(IDX, 'utf8');
check('no city/district pool continuation writes a suggestion list outside the guarded writer',
  unguardedContinuations(idxSrc).length === 0, unguardedContinuations(idxSrc).join('\n      '));

// M-B1: the pre-fix shape, restored at one real call site.
const preFix = idxSrc.replace(
  '      writeCitySuggestionsForCohort(cohort, cityFocus);\n      // REHYDRATION',
  '      if (cityTextRef.current) {\n' +
  '        setCitySuggestions(matchCitiesByText(effDeal, rentPeriodTok, effCategory, cityTextRef.current, cohortTypes, cityAfParams));\n' +
  '      }\n      // REHYDRATION');
check('the real tree still has the mount effect routed through the writer (M-B1 is meaningful)',
  preFix !== idxSrc, 'anchor for M-B1 no longer matches — re-anchor it rather than deleting the mutation');
mustCatch('M-B1-pre-fix-shape — the original inline write, restored at a real call site, is DISCOVERED',
  unguardedContinuations(preFix).length > 0, JSON.stringify(unguardedContinuations(preFix)));

// M-B2: a continuation that does not exist yet. The rule is about the SHAPE, not these six sites.
const NEW_SITE = `  const refreshCitiesSomehow = () => {
    void ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then(() => {
      setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
    });
  };
`;
const injected = idxSrc.replace('  const retryCityPool = () => {', NEW_SITE + '  const retryCityPool = () => {');
check('M-B2 anchor found', injected !== idxSrc, 'retryCityPool declaration moved — re-anchor M-B2');
mustCatch('M-B2-new-continuation — a pool continuation added tomorrow, in no list anywhere, is RED until it uses the writer',
  unguardedContinuations(injected).some((p) => p.includes('setCitySuggestions')),
  JSON.stringify(unguardedContinuations(injected)));

// M-B3: the SAME injection, routed through the writer, must be accepted — discrimination, not noise.
const injectedOk = idxSrc.replace('  const retryCityPool = () => {',
  NEW_SITE.replace(
    '      setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));',
    '      writeCitySuggestionsForCohort(cityCohortSig, true);') + '  const retryCityPool = () => {');
check('…and the same continuation routed through the writer is accepted',
  unguardedContinuations(injectedOk).length === 0, unguardedContinuations(injectedOk).join(' | '));

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §C — THE KEY MUST COVER WHAT THE POOL IS KEYED ON.
//
// A cohort check is only as good as the cohort it names. This reads the REAL argument list of the
// pool calls in the file and requires the signature to carry each argument's signature token, so a
// sixth pool parameter added later cannot be silently left out of the identity that guards it.
console.log('\n── §C: the cohort signature covers every argument the pool is keyed on ──');

/** argument identifier → the token that represents it inside a cohort signature. */
const SIG_OF: Record<string, string> = {
  effDeal: 'effDeal', rentPeriodTok: 'rentPeriodTok', effCategory: 'effCategory',
  cohortTypes: 'cohortTypesSig', cityAfParams: 'cityAfSig', cityTableScope: 'cityTableScopeSig',
  cid: 'cityId', 'citySelected.cityId': 'cityId',
};

/** The declaration of `name` and its continuation lines, up to and including the template it builds. */
function sigLine(source: string, name: string): string {
  const lines = source.split('\n');
  const at = lines.findIndex((l) => l.includes(`const ${name} =`));
  if (at < 0) return '';
  const out: string[] = [];
  for (let i = at; i < Math.min(at + 4, lines.length); i++) {
    out.push(lines[i]);
    if (i > at ? /`;\s*$/.test(lines[i]) : /`;\s*$/.test(lines[i].slice(lines[i].indexOf('`') + 1))) break;
  }
  return out.join('\n');
}
function poolArgs(source: string, fn: string): string[] {
  const m = new RegExp(`${fn}\\(([^)]*)\\)`).exec(source);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}
for (const [fn, sigName] of [['ensureCityFieldIndex', 'cityCohortSig'], ['ensureDistrictOptions', 'districtCohortSigOf']] as const) {
  const args = poolArgs(idxSrc, fn);
  check(`${fn}'s argument list was found (${args.length} arguments)`, args.length >= 5, JSON.stringify(args));
  const sig = sigLine(idxSrc, sigName);
  const missing = args.map((a) => SIG_OF[a] ?? a).filter((tok) => !sig.includes(tok));
  check(`${sigName} carries every one of ${fn}'s keyed arguments`, missing.length === 0,
    `missing from the signature: ${JSON.stringify(missing)} — a pool keyed on a value the guard does not name cannot detect that value changing`);
}

// M-C1: drop one key from the signature and the omission must be named.
const thinned = idxSrc.replace('|${cohortTypesSig}|${cityAfSig}`', '|${cityAfSig}`');
check('M-C1 anchor found', thinned !== idxSrc, 'cityCohortSig template changed — re-anchor M-C1');
{
  const args = poolArgs(thinned, 'ensureCityFieldIndex');
  const sig = sigLine(thinned, 'cityCohortSig');
  mustCatch('M-C1-key-dropped — a cohort signature that stops naming the property types is DETECTED',
    args.map((a) => SIG_OF[a] ?? a).some((tok) => !sig.includes(tok)), sig.trim());
}

if (failures) { console.error(`\n✗ ${failures} check(s) FAILED`); process.exit(1); }
console.log('\nOK — every city/district suggestion write names the cohort it was computed for, and the cohort names every value the pool is keyed on');
