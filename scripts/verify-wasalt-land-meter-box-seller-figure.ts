// WASALT LAND SHOWS THE SELLER'S FIGURE, NOT «TOTAL × AREA» (owner 2026-11-05: «we need to make sure that those listings never
// ever happen again» → «Show the real price»).
//
// wasalt 5893909 (جدة / حي البوادي, 504 m²) was served at 1,613,001,600: the seller typed the total into wasalt's per-m² box and
// wasalt multiplied it by the area. The owner's 2026-10-28 meter-box rule corrects exactly that, but it reads price_per_meter
// and wasalt never filled it. Migration 20261105233818 copies wasalt's OWN box figure (ar_data averageSalePricePerSqm) into
// price_per_meter for LAND sale rows when the rule proves the typo; the index and the card then serve the seller's figure.
//
// Hermetic (committed SQL + shipped TS, no DB):
//   1. the migration keeps every guard: land + Buy only, the unchanged owner rule, the holy-city bar, fill-only-when-empty,
//      triggers on BOTH wasalt tables ordered after the price-settling triggers, never writes price_total, detector repairs
//      before it raises and is on the roster — each guard mutation-proven;
//   2. the shipped card (src/lib/meterBoxPrice.ts → listingPriceString → the client budget net) on the real row: the seller's
//      figure with the box, wasalt's 1.6 B without it;
//   3. new rows: enrich_ar reads ≥100,000 SAR/m² sale rows first (executed by
//      scrapers/common/tests/test_wasalt_enrich_ar_multiplied_suspects_first_2026_11_05.py).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceTypedInMeterBox, servedSaleFigures } from '../src/lib/meterBoxPrice.ts';
import { listingPriceString } from '../src/data/listings.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const SQL = readFileSync(join(ROOT, 'supabase/migrations/20261105233818_wasalt_land_seller_figure_from_per_meter_box.sql'), 'utf8');
const ENRICH = readFileSync(join(ROOT, 'scrapers/wasalt/enrich_ar.py'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`catches: ${label}`, caught);

// ── 1. the migration's guards ────────────────────────────────────────────────────────────────────────────────────────
const fnBody = (sql: string, name: string) =>
  sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0] ?? '';

export function guardProblems(sql: string): string[] {
  const p: string[] = [];
  const rule = fnBody(sql, 'wasalt_land_typed_total_ar');
  if (!/where p_deal = 'Buy' and \(p_type like '%Land' or p_type = 'Agriculture Plot'\)/.test(rule)) p.push('rule is not LAND + Buy only');
  if (!/public\.price_typed_in_meter_box_ar\(p_total, p_area, public\.wasalt_box_per_meter\(p_ar\)/.test(rule)) p.push('rule does not reuse the owner\'s price_typed_in_meter_box_ar');
  if (!/when p_city in \('Mecca', 'Medina'\) then 'مكة المكرمة'/.test(rule)) p.push('holy cities lost their stricter bar');
  const trg = fnBody(sql, 'wasalt_land_box_figure_from_source');
  if (!/if NEW\.price_per_meter is null then NEW\.price_per_meter := round\(v_fix\); end if;/.test(trg)) p.push('trigger overwrites a box figure it did not fill');
  if (/NEW\.price_total\s*:=/.test(trg)) p.push('trigger writes price_total (PRICE = SOURCE)');
  if (!/abs\(NEW\.price_total::numeric \/ NEW\.area_m2 - v_box\) > greatest\(v_box \* 0\.002, 1\)/.test(trg)) p.push('a stale box figure is never dropped');
  for (const t of ['wasalt_residential_listings', 'wasalt_commercial_listings']) {
    if (!new RegExp(`create trigger trg_wrz_land_box_figure before insert or update on public\\.${t}\\s+for each row execute function public\\.wasalt_land_box_figure_from_source\\(\\)`).test(sql)) p.push(`no trigger on ${t}`);
  }
  // Postgres fires same-timing triggers by name: the box must be judged AFTER the triggers that settle price_total.
  const name = sql.match(/create trigger (\w+) before insert or update on public\.wasalt_residential_listings/)?.[1] ?? '';
  for (const before of ['trg_wcl_preserve_detail', 'trg_wrl_preserve_detail', 'trg_wrm_rate_is_not_the_total']) {
    if (!(name > before)) p.push(`trigger ${name || '?'} fires before ${before}`);
  }
  if (!(name < 'zz_redact_pii')) p.push('trigger fires after zz_redact_pii');
  if (/update public\.wasalt_\w+ w\s+set price_total/.test(sql)) p.push('migration rewrites wasalt price_total');
  const det = fnBody(sql, 'mon_detect_wasalt_land_box_typo');
  const repair = det.indexOf('update public.search_listings_ar s set price_per_meter');
  const raise = det.indexOf("mon_raise('P1'");
  if (repair < 0 || raise < 0 || repair > raise) p.push('detector does not repair before it raises P1');
  if (!/'mon_detect_served_billion_price_unproven', 'mon_detect_wasalt_land_box_typo',/.test(sql)) p.push('detector is not on the roster');
  if (!/select public\.mon_detect_wasalt_land_box_typo\(\);/.test(sql)) p.push('today\'s rows are not repaired');
  return p;
}

const live = guardProblems(SQL);
check(`the migration keeps every guard${live.length ? ` — ${live.join('; ')}` : ''}`, live.length === 0);

const MUTANTS: [string, string, string][] = [
  ['villas and buildings get corrected too', "where p_deal = 'Buy' and (p_type like '%Land' or p_type = 'Agriculture Plot')", "where p_deal = 'Buy'"],
  ['a home-made rule replaces the owner\'s', 'public.price_typed_in_meter_box_ar(p_total, p_area, public.wasalt_box_per_meter(p_ar)', 'public.my_rule(p_total, p_area, public.wasalt_box_per_meter(p_ar)'],
  ['Makkah/Madinah on the ordinary bar', "when p_city in ('Mecca', 'Medina') then 'مكة المكرمة'", "when false then 'مكة المكرمة'"],
  ['the trigger overwrites any per-m² value', 'if NEW.price_per_meter is null then NEW.price_per_meter := round(v_fix); end if;', 'NEW.price_per_meter := round(v_fix);'],
  ['the trigger rewrites the price', 'if NEW.price_per_meter is null then NEW.price_per_meter := round(v_fix); end if;', 'if NEW.price_per_meter is null then NEW.price_per_meter := round(v_fix); end if; NEW.price_total := v_fix;'],
  ['the commercial table is left out', 'create trigger trg_wrz_land_box_figure before insert or update on public.wasalt_commercial_listings', 'create trigger trg_wrz_land_box_figure before insert or update on public.other_table'],
  ['the trigger fires before the price is settled', 'trg_wrz_land_box_figure', 'trg_aaa_land_box_figure'],
  ['the detector only shouts', 'update public.search_listings_ar s set price_per_meter', 'select 1 from public.search_listings_ar s where price_per_meter'],
  ['the detector is off the roster', "'mon_detect_served_billion_price_unproven', 'mon_detect_wasalt_land_box_typo',", "'mon_detect_served_billion_price_unproven',"],
];
for (const [label, from, to] of MUTANTS) {
  const m = SQL.split(from).join(to);
  mustCatch(label, m !== SQL && guardProblems(m).length > 0);
}

// ── 2. the shipped card on the real row ──────────────────────────────────────────────────────────────────────────────
const lifted = await liftSymbols(join(ROOT, 'src/data/search.ts'),
  [{ header: 'function listingPriceValue(' }, { header: 'function withinValue(' }], ['withinValue'], '');
const withinValue = lifted.withinValue as (price: string, min: number, max: number) => boolean;

/** TS mirror of public.wasalt_land_typed_total_ar, built on the card's own rule. */
const wasaltLandTypedTotal = (p: number, area: number, box: number | null, type: string, deal: string, city: string) =>
  deal === 'Buy' && (type.endsWith('Land') || type === 'Agriculture Plot') ? priceTypedInMeterBox(p, area, box, { city, commercial: false }) : null;

const P = 1_613_001_600, A = 504, BOX = 3_200_400;
check('wasalt 5893909: the rule proves the typo with wasalt\'s own box', wasaltLandTypedTotal(P, A, BOX, 'Residential Land', 'Buy', 'Jeddah') === BOX);
check('a villa with the same arithmetic is never touched', wasaltLandTypedTotal(P, A, BOX, 'Villa', 'Buy', 'Jeddah') === null);
check('a rent is never touched', wasaltLandTypedTotal(P, A, BOX, 'Residential Land', 'Rent', 'Jeddah') === null);
check('Makkah keeps the stricter bar', wasaltLandTypedTotal(P, A, BOX, 'Residential Land', 'Buy', 'Mecca') === null);
check('a corrected price with a stale box is never touched', wasaltLandTypedTotal(BOX, A, BOX, 'Residential Land', 'Buy', 'Jeddah') === null);
check('a sane plot is never touched', wasaltLandTypedTotal(1_600_000, A, 3175, 'Residential Land', 'Buy', 'Jeddah') === null);

const card = (ppm: number | null) => {
  const s = servedSaleFigures(P, null, A, ppm, { city: 'Jeddah', commercial: false });
  return { s, str: listingPriceString('Buy', null, null, s.priceTotal, s.pricePerMeter, A) };
};
const fixed = card(BOX);
check('the card prints the seller\'s 3,200,400 (as wasalt\'s own page shows per m²)', fixed.s.priceTotal === BOX && /3,200,400/.test(fixed.str));
check('a 4,000,000 budget keeps the card', withinValue(fixed.str, 0, 4_000_000));
const before = card(null);
mustCatch('without the box figure (before this migration) the card printed 1,613,001,600',
  before.s.priceTotal === P && !withinValue(before.str, 0, 4_000_000));

// ── 3. new rows are read first ───────────────────────────────────────────────────────────────────────────────────────
check('enrich_ar reads ≥100,000 SAR/m² sale rows first', /MULTIPLIED_SUSPECT_PPM = 100_000/.test(ENRICH)
  && /ms = _multiplied_suspect_rows\(c, table, _base, limit\)/.test(ENRICH));

if (failed) { console.error(`\n❌ verify-wasalt-land-meter-box-seller-figure: ${failed} failed`); process.exit(1); }
console.log('\n✅ verify-wasalt-land-meter-box-seller-figure: wasalt land shows the seller\'s figure, guards mutation-proven');
