// A JOURNEY MUST SEARCH THE CITY IT ASKED FOR — and this is what proves the rule that decides it.
//
// WHY THIS EXISTS (routine #9, 2026-09-25). `e2e/live-sweep`'s `pickCity` chose its suggestion with
// `.pop()`: the LAST DOM node whose text merely STARTS WITH the typed city. Measured live against
// production, typing «الخبر» offers الخبر (6,606 إعلان) first and الخبراء (13 إعلان) second — so every
// الخبر journey the sweep has ever run actually searched الخبراء, 17 production_ready rows instead of
// 14,066, and wrote coverage for الخبر into `ops_qa_coverage_ledger` for a city it never touched.
//
// THE PRODUCT WAS HEALTHY THROUGHOUT. It offered both cities, correctly, biggest first. This is a
// harness defect of the shape `docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md` §41 exists for — a barrier's
// own imprecision wearing a product defect's clothes — except it did not even accuse: it silently
// passed, because assertChain's INTENT→UI equality is a SUBSTRING test and `'الخبراء'.includes('الخبر')`
// is true. The wrong pick and the guard that cannot see it are two blindnesses compounding.
//
// So the selection is now a pure rule (`e2e/live-sweep/cityOption.mjs`) and this executes it. It is
// hermetic — no browser, no network — so it belongs in the required `npm test`, and the strings it
// asserts on are the ones PRODUCTION RENDERS, captured from a real page, never a shape this file
// invented (AGENTS.md: *a barrier that supplies its own input proves nothing; feed it what PRODUCTION
// stores*).
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-city-option-pick-is-exact.ts
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { cityOptionName, pickCityOptionIndex } from '../e2e/live-sweep/cityOption.mjs';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  failed++;
  console.error(`  FAIL  ${label}`);
  if (why) console.error(`        ${why}`);
};

console.log('\nA journey picks the city it typed, not a longer city containing it\n');

// THE EXACT FOUR NODES production served for «الخبر» on 2026-09-25, in DOM order. Every option is
// rendered twice; that duplication is part of what made `.pop()` look harmless.
const KHOBAR_LIVE = [
  'الخبر\n6,606 إعلان',
  'الخبر\n6,606 إعلان',
  'الخبراء\n13 إعلان',
  'الخبراء\n13 إعلان',
];

// ── the name reader ───────────────────────────────────────────────────────────────────────────────
check('the count is stripped from a two-line option (the shape production renders)',
  cityOptionName('الخبر\n6,606 إعلان') === 'الخبر',
  `got ${JSON.stringify(cityOptionName('الخبر\n6,606 إعلان'))}`);
check('…and from a one-line option with a separator, in case the rendering changes',
  cityOptionName('الخبر · 6,606 إعلان') === 'الخبر',
  `got ${JSON.stringify(cityOptionName('الخبر · 6,606 إعلان'))}`);
check('…and from Arabic-Indic digits',
  cityOptionName('بيشة ١٤٧ إعلان') === 'بيشة',
  `got ${JSON.stringify(cityOptionName('بيشة ١٤٧ إعلان'))}`);
check('a multi-word city name is NOT truncated',
  cityOptionName('خيبر الجنوب\n2 إعلان') === 'خيبر الجنوب',
  `got ${JSON.stringify(cityOptionName('خيبر الجنوب\n2 إعلان'))}`);

// ── mutation proofs ───────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — against the real production options\n');
let mut = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  (mutation) ${label}`); return; }
  mut++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};

// M-1: THE INCIDENT. The old rule was `.pop()` = index 3 = الخبراء. The rule must choose الخبر.
const picked = pickCityOptionIndex(KHOBAR_LIVE, 'الخبر');
mustCatch('THE INCIDENT: «الخبر» must not resolve to «الخبراء» (the old .pop() took index 3)',
  picked >= 0 && cityOptionName(KHOBAR_LIVE[picked]) === 'الخبر');
mustCatch('…and the OLD rule really would have failed this, so the proof is not vacuous',
  cityOptionName(KHOBAR_LIVE[KHOBAR_LIVE.length - 1]) === 'الخبراء');

// M-2: the longer city must still be reachable when it is what was asked for. A fix that made الخبراء
// unselectable would have traded one wrong answer for another.
const longer = pickCityOptionIndex(KHOBAR_LIVE, 'الخبراء');
mustCatch('«الخبراء» still resolves to «الخبراء» when that is what was typed',
  longer >= 0 && cityOptionName(KHOBAR_LIVE[longer]) === 'الخبراء');

// M-3: every remaining colliding pair measured in production, both directions. These are the pairs
// `b.city_ar LIKE a.city_ar||'%'` finds over distinct production_ready cities (2026-09-25).
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['الجبيل', 'الجبيلة'], ['صبيا', 'صبياء'], ['بيش', 'بيشة'], ['الشنان', 'الشنانة'],
  ['الجلة', 'الجلة وتبراك'], ['الخرماء', 'الخرماء الجنوبية'], ['خيبر', 'خيبر الجنوب'],
  ['السلام', 'السلام العليا'], ['القاع', 'القاعد'], ['العمار', 'العمارية'],
];
let pairFail = '';
for (const [shortCity, longCity] of PAIRS) {
  // Production order: the bigger city first, as observed for الخبر. Both rendered twice.
  const nodes = [`${shortCity}\n100 إعلان`, `${shortCity}\n100 إعلان`,
                 `${longCity}\n5 إعلان`, `${longCity}\n5 إعلان`];
  const s = pickCityOptionIndex(nodes, shortCity);
  const l = pickCityOptionIndex(nodes, longCity);
  if (s < 0 || cityOptionName(nodes[s]) !== shortCity) pairFail += ` ${shortCity}→${cityOptionName(nodes[s] ?? '')}`;
  if (l < 0 || cityOptionName(nodes[l]) !== longCity) pairFail += ` ${longCity}→${cityOptionName(nodes[l] ?? '')}`;
}
mustCatch(`all ${PAIRS.length} other production prefix-colliding pairs resolve exactly, both directions`,
  pairFail === '');
if (pairFail) console.error(`        wrong:${pairFail}`);

// M-4: ORDER MUST NOT DECIDE IT. If the product ever renders the longer city first, the rule must
// still pick the exact one — otherwise this is a fix that depends on production's presentation order,
// which is not a contract anybody promised.
mustCatch('the exact city is chosen even when the longer city is rendered FIRST',
  (() => {
    const reversed = ['الخبراء\n13 إعلان', 'الخبر\n6,606 إعلان'];
    const i = pickCityOptionIndex(reversed, 'الخبر');
    return i >= 0 && cityOptionName(reversed[i]) === 'الخبر';
  })());

// M-5: the historical fallback survives. With NO exact match the old last-match behaviour must remain,
// so a city the product decorates differently still resolves as it always did.
mustCatch('with no exact match, the last prefix match is still returned (the fallback is intact)',
  pickCityOptionIndex(['الرياض الشمالية\n9 إعلان', 'الرياض الجنوبية\n4 إعلان'], 'الرياض') === 1);

// M-6: fail-closed inputs. Nothing to click must be -1, never 0 — index 0 would click a node the
// caller never qualified.
mustCatch('an empty option list returns -1, not 0', pickCityOptionIndex([], 'الخبر') === -1);
mustCatch('a blank requested city returns -1', pickCityOptionIndex(KHOBAR_LIVE, '   ') === -1);
mustCatch('a city nothing offers returns -1',
  pickCityOptionIndex(KHOBAR_LIVE, 'مدينة لا توجد') === -1);

// M-7: duplicates must not change WHICH city is chosen. Production renders each option twice; a rule
// that reacted to duplication would be reading the DOM's wrapper nesting as meaning.
mustCatch('duplicate nodes for one city do not change which city is chosen',
  cityOptionName(KHOBAR_LIVE[pickCityOptionIndex(KHOBAR_LIVE, 'الخبر')])
  === cityOptionName(['الخبر\n6,606 إعلان', 'الخبراء\n13 إعلان'][
    pickCityOptionIndex(['الخبر\n6,606 إعلان', 'الخبراء\n13 إعلان'], 'الخبر')]));

// ── BOTH harnesses must actually USE the rule, proven by EXECUTION ────────────────────────────────
// Not grepped. A source-text tripwire for `.pop()` would be PART 3.3 shape 1 of
// PRODUCTION_RED_TEAM_ENGINEER.md — it proves a string is absent, never that the right option is
// clicked, and a refactor that keeps the string and breaks the behaviour walks straight through.
// So the REAL pickCity of each harness is lifted and RUN against the four option nodes production
// served for «الخبر», and the assertion is on the index it actually asks the page to click.
//
// e2e/guardian/harness.mjs carried the identical `.pop()` — found as the §G.9(2) related variant of
// the sweep's defect on 2026-09-25 and fixed in the same change. Guardian asserts product
// INVARIANTS, so a silently substituted city makes every one of its assertions a statement about a
// different place.
console.log('\n  execution proof — the REAL pickCity of each harness, against production\'s own options\n');

const PRELUDE = `
import { pickCityOptionIndex } from ${JSON.stringify(
  pathToFileURL(join(ROOT, 'e2e', 'live-sweep', 'cityOption.mjs')).href)};
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1)));
const CITY_OPTION_TIMEOUT_MS = 1;
const until = async (fn) => await fn();
`;

/** A page offering exactly the four nodes production served for «الخبر», recording what got clicked. */
const khobarPage = () => {
  const clicked: number[] = [];
  const el = {
    evaluate: async (_fn: unknown) => undefined,
    scrollIntoView: () => {},
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {},
    asElement() { return this; },
  };
  const page = {
    locator: () => ({ click: async () => {}, fill: async () => {}, inputValue: async () => 'الخبر' }),
    waitForFunction: async () => true,
    // The harness asks for the option TEXTS with a string arg, and for the chosen NODE with {c,i}.
    // Recording `i` is how this reads the decision rather than believing a comment about it.
    evaluate: async (_fn: unknown, arg?: unknown) =>
      (typeof arg === 'string' ? KHOBAR_LIVE : undefined),
    evaluateHandle: async (_fn: unknown, arg?: { c: string; i: number }) => {
      if (arg && typeof arg.i === 'number') clicked.push(arg.i);
      return el;
    },
    waitForSelector: async () => el,
  };
  return { page, clicked };
};

const HARNESSES = [
  { name: 'e2e/live-sweep/sweep.mjs', file: 'e2e/live-sweep/sweep.mjs',
    header: 'async function pickCity(page, city) {' },
  { name: 'e2e/guardian/harness.mjs', file: 'e2e/guardian/harness.mjs',
    header: 'export async function pickCity(page, city) {' },
];

for (const h of HARNESSES) {
  const lifted = await liftSymbols(
    join(ROOT, h.file), [{ header: h.header, endsWith: /^\}$/ }], ['pickCity'], PRELUDE,
  ).catch((e) => { check(`${h.name}: pickCity could be lifted and executed`, false, String(e)); return null; });
  if (!lifted) continue;
  const pickCity = lifted.pickCity as (page: unknown, city: string) => Promise<boolean>;

  const w = khobarPage();
  const ok = await pickCity(w.page, 'الخبر');
  const chosen = w.clicked.length ? KHOBAR_LIVE[w.clicked[0]] : null;
  mustCatch(`${h.name}: asked for «الخبر», it clicks a «الخبر» node — NOT «الخبراء» (the .pop() defect)`,
    ok === true && chosen !== null && cityOptionName(chosen) === 'الخبر');
  if (chosen !== null && cityOptionName(chosen) !== 'الخبر') {
    console.error(`        it clicked index ${w.clicked[0]} = ${JSON.stringify(chosen)}`);
  }

  const w2 = khobarPage();
  await pickCity(w2.page, 'الخبراء');
  const chosen2 = w2.clicked.length ? KHOBAR_LIVE[w2.clicked[0]] : null;
  mustCatch(`${h.name}: and asked for «الخبراء», it still reaches «الخبراء»`,
    chosen2 !== null && cityOptionName(chosen2) === 'الخبراء');
}

if (mut > 0) failed += mut;

console.log(
  failed === 0
    ? '\n✅ a journey resolves the city it typed, for every prefix-colliding pair production has,\n'
      + '   and both harnesses were EXECUTED to prove they click it.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
