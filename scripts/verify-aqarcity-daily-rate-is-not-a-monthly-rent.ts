// A DAILY RATE IS NOT A MONTHLY RENT — AND NOT AN ANNUAL ONE EITHER.
//
// THE DEFECT (source-proven 2026-09-05, ops_incident #63). aqarcity hosts short-let ads that publish
// a DAILY rate. `rent_period` was BINARY — `"monthly" if is_monthly_rental(...) else "annual"` — so
// such an ad had to be called one or the other, and the keyword fallback saw «شهري» in the prose and
// chose monthly. Listing 30260 was stored rent_period=monthly, price_annual=3600, and the card read
// «300/month» for a room the source prices at 300 PER NIGHT.
//
// Verified by a DIRECT fetch of https://www.aqarcity.net/property/30260 — HTTP 200, 124,467 bytes.
// Body: «شقق مفروشة فاخرة للآجار اليومي والشهري … سعر الآجار اليومي غرفتين وصالة وحمامين ٣٠٠ ريال».
//
// THE FIX is a third state, not a different guess. Ezhalah cannot represent a daily rent —
// search_listings_ar.rent_period_ar has exactly three values (سنوي 44,469 / شهري 32,228 / NULL
// 127,763 as at 2026-09-05) — so the honest answer is UNKNOWN: keep the published number exactly as
// published, assert no period, and let the card render a bare figure with no suffix.
//
// WHAT THIS BARRIER MUST ALSO PROVE: that the detector is NARROW. A previous attempt made the
// source's `unitText=YEAR` authoritative and was reverted within the hour because three existing
// tests proved aqarcity emits YEAR as an unreliable DEFAULT on plainly monthly ads. The danger here
// is identical in shape — a daily rule that is too eager turns genuine monthly rentals into
// UNKNOWN and silently removes them from every price filter. So the negative cases below carry the
// same weight as the positive one, and `is_monthly_rental` is asserted UNCHANGED on the exact three
// cases that killed the last attempt.
//
// Run: node --experimental-strip-types scripts/verify-aqarcity-daily-rate-is-not-a-monthly-rent.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.aqarcity.run';
const SRC = join(ROOT, 'scrapers/aqarcity/run.py');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// The real body of listing 30260, verbatim from production. It is adversarial by construction: the
// ad genuinely offers daily AND monthly lets, so a careless reader has every excuse to say monthly.
const REAL = '🔔فرصة للآجار🔔🔶 شقق مفروشة فاخرة للآجار اليومي والشهري بحي المحمدية ببلجرشي. موقع مطل ومميز '
  + 'وقريب من جميع الخدمات. 🔶 سعر الآجار اليومي غرفتين وصالة وحمامين٣٠٠ ريالغرفة وحمام ٢٠٠ ريال🔶 '
  + 'رخصة رقم 1100264897🔶 ترخيص أعلان 7100301088🔶 جوال /';
const MONTHLY_1700 = '🏡 شقة للإيجار - حي التيسير...السعر: 1700 ريال شهري شامل: كهرباء';
const MULTI_UNIT = 'للايجار 3 شقق عزاب الايجار الشهري : 1100 ريال وايجار شهري 900';

// ── 1. THE RULE — it fires on the real daily ad ───────────────────────────────────────────────
const d = pyCall(ROOT, MOD, 'is_daily_priced', [
  [REAL, 300], [REAL, 200], [REAL, 5000],
  [MONTHLY_1700, 1700], [MULTI_UNIT, 14400],
  ['الإيجار السنوي : 50,115 ريال', 50115],
  ['متاح من اليوم الأول، الإيجار الشهري 2500', 2500],
  ['للإيجار اليومي والشهري 🔶 اليومي: 300 ريال 🔶 الشهري : 4500 ريال', 4500],
  ['للإيجار اليومي والشهري 🔶 اليومي: 300 ريال 🔶 الشهري : 4500 ريال', 300],
]) as boolean[];

check('listing 30260 — the captured 300 IS recognised as a daily rate', d[0] === true);
check('…and the second room rate (200) in the same daily clause', d[1] === true);
check('a number that is not in the ad at all does not fire', d[2] === false);

// ── 2. NARROWNESS — the half that killed the previous attempt ─────────────────────────────────
check('a genuine MONTHLY ad («1700 ريال شهري») is untouched', d[3] === false,
  'an over-eager daily rule silently drops real rentals out of every price filter');
check('a multi-unit monthly ad is untouched', d[4] === false);
check('an ANNUAL ad with no daily wording is untouched', d[5] === false);
check('the bare word «اليوم» in unrelated prose does not fire', d[6] === false,
  '«متاح من اليوم الأول» is availability, not a rate');
check('in a mixed daily+monthly ad, a number the prose calls شهري outranks the daily clause',
  d[7] === false);
check('…while the number in the DAILY clause of that same ad still fires', d[8] === true);

// ── 3. is_monthly_rental IS UNCHANGED — the exact three cases that reverted the last attempt ──
const m = pyCall(ROOT, MOD, 'is_monthly_rental', [
  [MONTHLY_1700, 'YEAR', 1700, 'شقة'],
  [MULTI_UNIT, 'YEAR', 14400, 'شقق للإيجار'],
  ['أي نص', 'MONTH', 2500, 'شقة'],
]) as boolean[];
check('is_monthly_rental: unitText=YEAR + «1700 ريال شهري» is STILL monthly', m[0] === true,
  'aqarcity emits YEAR as an unreliable default; this is the case that reverted the unitText attempt');
check('is_monthly_rental: the multi-unit keyword fallback is STILL monthly', m[1] === true);
check('is_monthly_rental: unitText=MONTH is STILL monthly', m[2] === true);

// ── 4. MUTATION PROOFS — executed against mutated copies of the REAL module ───────────────────
const real = readFileSync(SRC, 'utf8');
// An anchor that no longer matches must be LOUD. Returning null for both "anchor missed" and
// "python threw" is how the first draft of this file reported three surviving mutants as three
// failures with no way to tell which — fixed by separating the two.
const mutate = (label: string, fn: (s: string) => string, calls: unknown[][], sym = 'is_daily_priced') => {
  const mutated = fn(real);
  if (mutated === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  try { return pyCall(ROOT, MOD, sym, calls, mutated) as boolean[]; }
  catch (e) { check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n')[0]}`, false); return null; }
};
const mustCatch = (what: string, wouldFail: boolean) => check(`MUTATION: catches ${what}`, wouldFail);

// Each mutant below is paired with an input that DISCRIMINATES — one where the guard being removed
// is the only thing deciding the answer. The first draft paired them with inputs that an earlier
// guard already short-circuited, so all three mutants "survived" while proving nothing. A mutation
// that cannot change an answer is not a proof; it is a comment that runs.

// (a) the daily branch at the call site, disabled — listing 30260 returns to a false monthly.
const noBranch = real.replace(
  '        if is_daily_priced(body, price):\n            rent_period = None\n        else:\n',
  '        if False:\n            rent_period = None\n        else:\n');
check('MUTATION: catches the daily branch being disabled at the call site',
  noBranch !== real && !noBranch.includes('if is_daily_priced(body, price):'),
  'the call-site anchor drifted — the branch may no longer be wired');

// (b) the SEGMENT requirement dropped. Input: a daily ad whose captured number lives in a
//     NON-daily segment (an area, not a rate) and is not شهري-labelled, so only the segment rule
//     can reject it.
const segAd = 'للإيجار اليومي: 300 ريال 🔶 المساحة 4500 متر';
const noSeg = mutate('(b)', (s2) => s2.replace(
  '    for seg in _SEGMENT_SPLIT.split(body):\n        if _DAILY_PHRASE.search(seg) and price in _numbers_in(seg):\n            return True\n    return False',
  '    return True'), [[segAd, 4500]]);
mustCatch('a daily rule that drops the segment requirement (an area read as a rate)',
  noSeg !== null && noSeg[0] === true);

// (c) the «شهري»-outranks-daily guard removed. Input: ONE segment carrying both the daily phrase
//     and a شهري-labelled number equal to the captured price, so only that guard can reject it.
const mixedAd = 'للإيجار اليومي والشهري 300 ريال شهرياً';
const noGuard = mutate('(c)', (s2) => s2.replace('    if price in monthly_nums:\n        return False\n', ''),
  [[mixedAd, 300]]);
mustCatch('a daily rule that stops letting a «شهري» number outrank the daily clause',
  noGuard !== null && noGuard[0] === true);

// (d) the daily PHRASE loosened to the bare word «يوم». Input: availability prose with no شهري
//     anywhere, so the monthly guard cannot mask the loosening.
const availAd = 'متاح من اليوم الأول. السعر 2500 ريال';
const loose = mutate('(d)', (s2) => s2.replace(/_DAILY_PHRASE = re\.compile\([\s\S]*?\n\)/,
  '_DAILY_PHRASE = re.compile(r"يوم")'), [[availAd, 2500]]);
mustCatch('the daily phrase loosened to the bare word «يوم» («متاح من اليوم الأول» is availability)',
  loose !== null && loose[0] === true);

// (e) NOT VACUOUS — the real module must reject every one of those adversarial inputs.
const sane = pyCall(ROOT, MOD, 'is_daily_priced', [[segAd, 4500], [mixedAd, 300], [availAd, 2500]]) as boolean[];
mustCatch('nothing — the REAL rule rejects all three adversarial inputs, so (b)-(d) are not inverted',
  sane[0] === false && sane[1] === false && sane[2] === false);

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-aqarcity-daily-rate-is-not-a-monthly-rent'));

console.log(failed === 0
  ? '\n✅ aqarcity-daily-rate: a published daily rate keeps its number and asserts no period.\n'
  : `\n❌ aqarcity-daily-rate: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
