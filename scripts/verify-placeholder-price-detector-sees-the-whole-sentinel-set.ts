// THE DETECTOR'S ONE WAY TO GO DARK, CHECKED FROM THE OTHER SIDE.
//
// mon_detect_placeholder_price_stored() (migration 20260906043755) reads a stored wasalt price
// against that row's own archived rentFreq payload and fires when the stored figure came from
// wasalt's unset-FORM DEFAULT rather than from a quote. To stay affordable at twice an hour it
// narrows its scan with `price_annual between 0 and 12` — an index-only scan of two rows instead of
// 68,323 jsonb reads (0.15 ms instead of 5.6 s). That window decides nothing on its own; the verdict
// comes entirely from the payload, and the migration proves it by forcing a both-real row into the
// window and asserting silence.
//
// But the window IS a coupling. It is only complete while 12 is the largest price the scraper's
// placeholder set can fabricate — today `_PLACEHOLDER_AMOUNTS = (0, 1)` in scrapers/wasalt/run.py,
// so the fabricated values are 0, 1 and 1x12 = 12. Add a 2 to that tuple tomorrow and the detector
// silently stops seeing a whole band of the defect it exists for: no error, no red test, just a
// standing 0 that means nothing. That is the exact failure mode AGENTS.md keeps naming — a barrier
// that went dark while looking green.
//
// SO THIS CHECK EXECUTES THE SCRAPER RATHER THAN READING ITS CONSTANT. It probes the REAL
// map_property with monthly amounts 0..199 beside a real 50,000 yearly and asks which ones it
// DISCARDS as placeholders. That is the behaviour the window has to cover, discovered by running
// the production function — so a rename, a refactor, or a second sentinel path all still answer
// truthfully. The SQL side is read from the newest committed migration that defines the detector,
// so a later redefinition is what gets checked, not this one forever.
//
// Run: node --experimental-strip-types scripts/verify-placeholder-price-detector-sees-the-whole-sentinel-set.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const DETECTOR = 'mon_detect_placeholder_price_stored';
const PROBE_MAX = 200;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

// ── THE SQL SIDE: every candidate window in the NEWEST migration that defines the detector ──────
const defining = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8')
    .includes(`create or replace function public.${DETECTOR}`))
  .sort();
check(`a committed migration defines ${DETECTOR}()`, defining.length > 0,
  'the detector exists only in production — unreviewable and unrestorable from git');
if (defining.length === 0) process.exit(1);

const newest = defining[defining.length - 1]!;
const sql = readFileSync(join(MIGRATIONS, newest), 'utf8');
const body = sql.slice(sql.indexOf(`create or replace function public.${DETECTOR}`));
const windows = [...body.matchAll(/price_annual\s+between\s+(\d+)\s+and\s+(\d+)/g)]
  .map((m) => [Number(m[1]), Number(m[2])] as const);
check(`${newest} narrows the scan with at least one price_annual window`, windows.length > 0,
  'no `price_annual between X and Y` found — this guard is checking nothing');
if (windows.length === 0) process.exit(1);

const ceiling = Math.min(...windows.map(([, hi]) => hi));
const floor = Math.max(...windows.map(([lo]) => lo));

// ── THE PYTHON SIDE: which amounts does the REAL scraper actually discard? ──────────────────────
const prop = (m: number) => ({
  id: 1, propertyInfo: {
    slug: 's', propertySubType: 'Commercial Building', title: 't', city: 'Riyadh', zone: 'z',
    rentFreq: {
      monthly: { freq: 'monthly', amount: m, default_freq: true },
      yearly: { freq: 'yearly', amount: 50000, default_freq: false },
    },
  },
});
const probes = [...Array.from({ length: PROBE_MAX }, (_, k) => k), 4000];
const out = pyCall(ROOT, 'scrapers.wasalt.run', 'map_property',
  probes.map((k) => [prop(k), 'rent'])) as Array<Record<string, unknown>>;
const priced = (k: number) => Number(out[probes.indexOf(k)]?.price_annual);

// A monthly amount is a PLACEHOLDER exactly when the scraper throws it away and keeps the real
// 50,000 yearly. Anything else is a quote and is multiplied out as one.
const sentinels = probes.filter((k) => priced(k) === 50000);
const quotes = probes.filter((k) => priced(k) === k * 12);

check('the probe discriminates: the real scraper both discards some amounts and honours others',
  sentinels.length > 0 && quotes.length > 0,
  `discarded=${sentinels.length} honoured=${quotes.length} of ${probes.length} — a probe where `
  + 'every amount lands the same way proves nothing about the window');
check('1 is still discarded as wasalt\'s form default (the WST5892686 defect)',
  sentinels.includes(1));
check('a real rent is still honoured verbatim (4,000/month → 48,000/year)',
  priced(4000) === 48000, `got ${priced(4000)}`);
check('every sentinel this probe found is small — an over-eager set that swallows real rents is '
  + 'a repricing bug, not a window problem', Math.max(...sentinels) < 100,
  `discarded amounts: ${sentinels.join(', ')}`);

// ── THE AGREEMENT ───────────────────────────────────────────────────────────────────────────────
const maxSentinel = Math.max(...sentinels);
const needed = maxSentinel * 12;      // the largest price this sentinel set can fabricate
check(`the SQL candidate window covers every price the sentinel set can fabricate `
  + `(sentinels up to ${maxSentinel} → needs ≥ ${needed}, window is ${floor}..${ceiling})`,
  ceiling >= needed,
  `${newest} would never look at a row priced ${needed}, so a placeholder-derived ${needed} would `
  + 'sit in production with the detector reading a healthy 0');
check('the window starts at or below the smallest sentinel', floor <= Math.min(...sentinels));

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
// The agreement above is one comparison, so both halves of it are mutated: a widened sentinel set
// (the realistic drift) and a narrowed window (the realistic "optimisation").
const agrees = (hi: number, maxSent: number) => hi >= maxSent * 12;
const mustCatch = (what: string, wouldFail: boolean) => check(`MUTATION: catches ${what}`, wouldFail);

mustCatch('the sentinel set being widened to (0,1,2) while the window stays 12',
  !agrees(ceiling, 2));
mustCatch('the window being narrowed below what today\'s sentinels fabricate',
  !agrees(maxSentinel * 12 - 1, maxSentinel));
check('NOT VACUOUS: the real pair passes the same predicate that rejected both mutants',
  agrees(ceiling, maxSentinel));

// A widened sentinel set has to be DISCOVERABLE by the probe, or the mutation above is theatre:
// prove the probe would actually report a 2 as a sentinel if the scraper started discarding it.
const widened = readFileSync(join(ROOT, 'scrapers/wasalt/run.py'), 'utf8')
  .replace('_PLACEHOLDER_AMOUNTS = (0, 1)', '_PLACEHOLDER_AMOUNTS = (0, 1, 2)');
const widenedOut = pyCall(ROOT, 'scrapers.wasalt.run', 'map_property', [[prop(2), 'rent']],
  widened) as Array<Record<string, unknown>>;
mustCatch('a widened sentinel set through the PROBE itself — a scraper that discards 2 reports 2, '
  + 'while the real one still honours it',
  Number(widenedOut[0]?.price_annual) === 50000 && priced(2) !== 50000);

check('npm test runs this guard',
  npmTestRuns(ROOT, 'verify-placeholder-price-detector-sees-the-whole-sentinel-set'));

console.log(failed === 0
  ? `\n✅ placeholder-price detector: window ${floor}..${ceiling} still covers every price the `
    + `scraper's sentinels (${sentinels.join(', ')}) can fabricate.\n`
  : `\n❌ placeholder-price detector: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
