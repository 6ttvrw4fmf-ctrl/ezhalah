// A FACT PACK FROM ANOTHER DAY NEVER SAYS «أمس», «آخر 7 أيام» OR A COUNT (owner 2026-10-27: «yesterday, 1 week should be
// based on real fact … we can go to jail»; owner 2026-11-09: «those numbers count needs to be exact»).
// Since 2026-11-06 the first open of a day may pick a fact from the last 36 h's pack (useFilterWelcome readRecentPack).
// Nothing checked the pack's `day`, so «نزل أمس …» built yesterday was shown today. The pack's templates now carry
// day_bound (migration 20261109055302) and chooseInsightLine uses another day's pack only for day_bound = false.
// EXECUTED: the real chooseInsightLine runs on packs dated today / yesterday / undated, plus mutations of its source.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const SRC = new URL('../src/lib/insightWelcome.ts', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'stale-pack-'));
let n = 0;
async function load(code: string) {
  const f = join(dir, `insightWelcome-${n++}.ts`);
  writeFileSync(f, code);
  return import(pathToFileURL(f).href);
}

const en = { city: () => 'Riyadh', district: () => 'Al Malqa' };
const tpl = (id: number, kind: string, day_bound?: boolean) =>
  ({ id, kind, personal: false, ar: `تدري إن {a} في {city}؟`, en: `did you know {a} in {city}?`, ...(day_bound === undefined ? {} : { day_bound }) });
const fact = (id: number, kind: string) =>
  ({ id, kind, region: 'منطقة الرياض', city: 'الرياض', city_id: 3, district: null, district2: null, type: null, a: 5, b: 2 });
const now = Date.UTC(2026, 10, 9, 9);          // 12:00 Riyadh, 2026-11-09
const TODAY = '2026-11-09', YESTERDAY = '2026-11-08';

type Mod = { chooseInsightLine: (...a: unknown[]) => { templateId: number } | null; riyadhDate?: (t: number) => string };
async function verdicts(m: Mod) {
  const pick = (day: string | null, templates: unknown[], kinds: string[]) =>
    m.chooseInsightLine({ day, templates, insights: kinds.map((k, i) => fact(i + 1, k)) }, {}, now, en, { rand: () => 0.5 });
  return {
    todayYesterday: pick(TODAY, [tpl(1, 'yesterday', true)], ['yesterday'])?.templateId === 1,
    staleYesterday: pick(YESTERDAY, [tpl(1, 'yesterday', true)], ['yesterday']) === null,
    staleCount: pick(YESTERDAY, [tpl(2, 'city_land', true)], ['city_land']) === null,
    staleNoField: pick(YESTERDAY, [tpl(3, 'week_land')], ['week_land']) === null,
    staleTimeless: pick(YESTERDAY, [tpl(4, 'villa_area', false)], ['villa_area'])?.templateId === 4,
    staleMixedPicksTimeless: pick(YESTERDAY, [tpl(1, 'yesterday', true), tpl(4, 'villa_area', false)], ['yesterday', 'villa_area'])?.templateId === 4,
    undatedPack: pick(null, [tpl(1, 'yesterday', true)], ['yesterday']) === null,
    midnight: m.riyadhDate ? m.riyadhDate(Date.UTC(2026, 10, 8, 21, 0, 1)) === TODAY && m.riyadhDate(Date.UTC(2026, 10, 8, 20, 59, 59)) === YESTERDAY : false,
  };
}
const allOk = (v: Record<string, boolean>) => Object.values(v).every(Boolean);

const real = await verdicts(await load(src) as Mod);
check('today\'s pack may say «أمس»', real.todayYesterday);
check('yesterday\'s pack never says «أمس»', real.staleYesterday);
check('yesterday\'s pack never states a count', real.staleCount);
check('a pack read before day_bound existed gives no day fact from another day', real.staleNoField);
check('yesterday\'s pack still gives a timeless fact (never pop up late)', real.staleTimeless);
check('from a mixed old pack only the timeless fact is picked', real.staleMixedPicksTimeless);
check('a pack with no day is never treated as today\'s', real.undatedPack);
check('the Riyadh day turns at 21:00 UTC', real.midnight);

const mutate = async (label: string, from: string, to: string) => {
  if (!src.includes(from)) { check(`mutation target present: ${label}`, false); return; }
  mustCatch(label, !allOk(await verdicts(await load(src.replace(from, to)) as Mod)));
};
await mutate('the day check removed', 'const today = pack.day != null && pack.day === riyadhDate(now);', 'const today = true;');
await mutate('a missing day_bound read as timeless', 't.day_bound === false', 't.day_bound !== true');
await mutate('Riyadh time read as UTC', 'new Date(t + 3 * 3600_000)', 'new Date(t)');

// the server stamps the field the app reads
const mig = readFileSync(new URL('../supabase/migrations/20261109055302_welcome_pack_templates_carry_day_bound.sql', import.meta.url), 'utf8');
check('welcome_insights_pick sends day_bound from the kind\'s time window or a count', /'day_bound',\s*coalesce\(k\.time_window is not null or k\.stat = 'count', true\)/.test(mig));

if (failed) { console.error(`\n❌ verify-stale-pack-never-says-yesterday: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-stale-pack-never-says-yesterday: another day\'s pack never says «أمس», «آخر 7 أيام» or a count');
