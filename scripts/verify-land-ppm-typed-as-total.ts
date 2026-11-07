// A LAND PER-METRE PRICE TYPED INTO THE TOTAL BOX (owner 2026-11-04: «build the best solution, a strong guard»).
//
// abwbna 10777645 (الأحساء / المطيرفي الغربي, 375 m²) published «1,700» as the total; it is the per-metre price (≈ 637,500).
// The index decides (migrations 20261104221247 + 20261104221607: land_ppm_typed_as_total_served_ar in
// enforce_price_size_sanity) and the card follows the index's verdict (src/lib/landPerMeterTotal.ts) — so the card, the
// client budget net and the four count RPCs carry ONE number.
//
// This barrier is hermetic (committed SQL + shipped TS, no DB):
//   1. the SQL rule keeps every guard (a–f), the trigger edit is an exact text replace with a RAISE guard, the RNPL block
//      is untouched, price_fidelity excuses ONLY flagged rows whose served total is exactly source × area, the detector
//      REPAIRS before it raises P1;
//   2. the SQL proof cases, executed through the TS recognizer (the shape the index serves ↔ the shape the card accepts);
//   3. the real round trip: the card's printed price → withinValue() lifted from src/data/search.ts (the client net);
//   4. real production rows, as served on 2026-11-04 after the repair.
// The LIVE proof (the same real rows, read from the database) is scripts/ops/proof_land_ppm_typed_as_total_2026-11-04.sql.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { servedTotalFromTypedPerMeter, followIndexPerMeterVerdict } from '../src/lib/landPerMeterTotal.ts';
import { derivedTotalEquation, DERIVED_TOTAL_MAX } from '../src/data/listings.ts';
import { SERVED_TOTAL_MAX } from '../src/lib/landPerMeterTotal.ts';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const RULE_SQL = readFileSync(join(MIG, '20261104221247_land_ppm_typed_as_total_rule_and_band.sql'), 'utf8');
const WIRE_SQL = readFileSync(join(MIG, '20261104221607_land_ppm_typed_as_total_served_and_guarded.sql'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`catches: ${label}`, caught);

const lifted = await liftSymbols(join(ROOT, 'src/data/search.ts'),
  [{ header: 'function listingPriceValue(' }, { header: 'function withinValue(' }], ['withinValue'], '');
const withinValue = lifted.withinValue as (price: string, min: number, max: number) => boolean;

// ── 1. the SQL rule and its wiring ──────────────────────────────────────────────────────────────────────────────────
const fn = RULE_SQL.match(/create or replace function public\.land_ppm_typed_as_total_ar\([\s\S]*?\$function\$;/)?.[0] ?? '';
export function ruleGuardsOk(body: string): boolean {
  const b = body.replace(/\s+/g, ' ');
  return /p > 0 and p < 20000 and area >= 100 and p \/ area < 50/.test(b)                         // a
    && /not \(ppm is not null and abs\(ppm \* area - p\) <= 0\.05 \* p\)/.test(b)                 // b real cheap land
    && /band_lo is not null and band_hi is not null and p between band_lo and band_hi/.test(b)     // c band
    && /abs\(p - area\) > 1/.test(b)                                                                // d price = area
    && /not coalesce\(says_thousands, false\)/.test(b)                                              // e words say «الف»
    && /coalesce\(says_per_m2, false\) or not \(p \* 1000 \/ area between band_lo and band_hi\)/.test(b) // e ambiguity
    && /p \* area <= 500000000/.test(b);                                                            // f bound
}
check('the rule exists in the committed migration', fn.length > 0);
check('the rule keeps all six guards (signature, source box, band, price=area, thousands, 500M bound)', ruleGuardsOk(fn));
mustCatch('a rule without the source-box guard (real cheap land would be touched)',
  !ruleGuardsOk(fn.replace('and not (ppm is not null and abs(ppm * area - p) <= 0.05 * p)', '')));
mustCatch('a rule without the ambiguity guard (a thousands typo would be read per-metre)',
  !ruleGuardsOk(fn.replace('(coalesce(says_per_m2, false) or not (p * 1000 / area between band_lo and band_hi))', 'true')));
check('the band excludes agricultural land and rows the rule already rewrote',
  /type_ar not like '%زراع%'/.test(RULE_SQL) && /not s\.ppm_typed_as_total/.test(RULE_SQL));
check('the trigger is edited by ONE exact text replace with a RAISE guard (never a full-function replace)',
  /if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 anchor/.test(WIRE_SQL)
  && !/create\s+or\s+replace\s+function\s+public\.enforce_price_size_sanity/i.test(WIRE_SQL));
check('the inserted trigger text names neither payment_monthly nor rent_now_pay_later (RNPL block untouched)',
  !/payment_monthly|rent_now_pay_later/.test(windowBetween(WIRE_SQL, 'b_trig text', 'a_fid text', 'wire migration')));
check('the trigger keeps the source figure as the per-metre rate and flags the row',
  /NEW\.price_per_meter := NEW\.price_total;\\n'[\s\S]*NEW\.price_total := v_fix;\\n'[\s\S]*NEW\.ppm_typed_as_total := true;/.test(WIRE_SQL));
check('an UPDATE that leaves the price alone keeps the flag (idempotent re-judge)',
  /elsif TG_OP = ''INSERT'' or NEW\.price_total is distinct from OLD\.price_total/.test(WIRE_SQL));
check('price_fidelity excuses ONLY flagged rows served at exactly source × area',
  /and not \(s\.ppm_typed_as_total and s\.price_total = x\.src_total \* s\.area_m2\)\)/.test(WIRE_SQL));
{
  const det = WIRE_SQL.slice(WIRE_SQL.indexOf('function public.mon_detect_land_ppm_typed_as_total'));
  const upd = det.indexOf('update public.search_listings_ar s set price_total = s.price_total');
  const p1 = det.indexOf("mon_raise('P1'");
  check('the detector REPAIRS (no-op update fires the trigger) before it can raise P1', upd > 0 && p1 > upd);
  check('every key the detector raises has a resolve path',
    ['land_ppm_typed_as_total_self_healed', 'land_ppm_typed_as_total_served', 'land_price_unit_review']
      .every((k) => det.includes(`mon_resolve_key('${k}'`)));
  check('the detector is scheduled daily', /cron\.schedule\('mon-land-ppm-typed-as-total', '36 5 \* \* \*'/.test(WIRE_SQL));
}
check('the derived-total bound is the same number on both sides', SERVED_TOTAL_MAX === DERIVED_TOTAL_MAX);

// ── 2. the SQL proof cases through the TS recognizer ────────────────────────────────────────────────────────────────
// Each «land_ppm_typed_as_total_ar(p, area, …) is distinct from N» case: the index serves N, the card must print N.
// Each «… is not null» case: the index serves the SOURCE figure, the card must not touch it.
const CASE = /land_ppm_typed_as_total_ar\((\d+), (\d+), [^)]*\) (is distinct from (\d+)|is not null)/g;
const cases = [...RULE_SQL.matchAll(CASE)];
check(`the migration's proof block has derived AND untouched cases (${cases.length})`,
  cases.some((c) => c[4]) && cases.some((c) => !c[4]));
for (const c of cases) {
  const p = Number(c[1]), area = Number(c[2]);
  if (c[4]) {
    check(`SQL case ${p} × ${area} m² → ${Number(c[4]).toLocaleString('en')}: the card recognises it`,
      servedTotalFromTypedPerMeter('Buy', p, area, Number(c[4])) === Number(c[4]));
  } else {
    check(`SQL case ${p} on ${area} m² stays as published: the card leaves it`,
      servedTotalFromTypedPerMeter('Buy', p, area, p) === null);
  }
}

// ── 3. the round trip: card → client budget net ─────────────────────────────────────────────────────────────────────
type Card = Parameters<typeof followIndexPerMeterVerdict>[0];
const card = (p: number, area: number, extra: Partial<Card> = {}): Card =>
  ({ deal: 'Buy', price: `SAR ${p.toLocaleString('en-US')}`, area, salePriceTotal: p, pricePerMeter: null, priceIsDerived: false, ...extra });
{
  const l = card(1700, 375);
  check('abwbna 10777645: the card follows the index (≈ 637,500)', followIndexPerMeterVerdict(l, 637500) && l.price === '≈ SAR 637,500');
  check('…marks it derived, keeps the seller\'s 1,700 as the per-metre rate and as the «the ad wrote» figure',
    l.priceIsDerived === true && l.pricePerMeter === 1700 && l.typedTotalAsPerMeter === 1700);
  check('…and the card\'s working line equals the price (1,700 × 375 = 637,500)', derivedTotalEquation(l.pricePerMeter, l.area)?.total === 637500);
  check('…a 500k–700k budget keeps the card the server matched', withinValue(l.price, 500_000, 700_000));
  mustCatch('the pre-fix card (1,700) is dropped by that budget', !withinValue(card(1700, 375).price, 500_000, 700_000));
  check('the RPC may send numeric as a string', followIndexPerMeterVerdict(card(1700, 375), '637500'));
}
check('a row the index serves as published is left alone', !followIndexPerMeterVerdict(card(15055, 1158), 15055));
check('a rent row is never touched', !followIndexPerMeterVerdict(card(185, 817, { deal: 'Rent' }), 151145));
check('an already-derived card is never touched twice', !followIndexPerMeterVerdict(card(1700, 375, { priceIsDerived: true }), 637500));
check('a served figure that is not exactly source × area is not this rule', servedTotalFromTypedPerMeter('Buy', 1700, 375, 637000) === null);
check('a source figure ≥ 20,000 is not this rule', servedTotalFromTypedPerMeter('Buy', 20000, 375, 7_500_000) === null);
check('no effective_price (deep link, older RPC) → the card stays as published', !followIndexPerMeterVerdict(card(1700, 375), null));

// ── 4. real production rows, as served 2026-11-04 after the repair (source figure, area, served total) ─────────────
const REAL: [string, number, number, number][] = [
  ['abwbna 10777645 الأحساء/المطيرفي الغربي', 1700, 375, 637_500],
  ['abralosol 10301815 المبرز/الغسانية (site box also 1,700)', 1700, 350, 595_000],
  ['alshawaf 12605926 الأحساء/المحدود', 2400, 612, 1_468_800],
  ['haraj 22803608 الرياض/المنار', 3400, 1750, 5_950_000],
  ['ksaaqar 12225790 الرياض/حطين', 9000, 2290, 20_610_000],
];
for (const [name, p, area, served] of REAL) {
  const l = card(p, area);
  check(`${name}: «${p.toLocaleString('en')}» → ≈ ${served.toLocaleString('en')}`, followIndexPerMeterVerdict(l, served) && withinValue(l.price, served, served));
}

// ── 5. the wiring in the shipped files ──────────────────────────────────────────────────────────────────────────────
const REMOTE = read('src/data/remote.ts');
const CARD = read('src/components/ResultCard.tsx');
const I18N = read('src/i18n.tsx');
check('remote.ts carries effective_price on every candidate', /effective_price: \(c\.effective_price \?\? null\) as unknown,/.test(REMOTE));
check('remote.ts applies the verdict to every ranked card', /followIndexPerMeterVerdict\(l, c\.effective_price\);/.test(REMOTE));
check('finalize() records the sale total the verdict is recognised against',
  /salePriceTotal: deal === 'Buy' && typeof sale\.priceTotal === 'number' \? sale\.priceTotal : null,/.test(REMOTE));
check('both card layouts show the seller\'s own figure', (CARD.match(/listing\.typedTotalAsPerMeter != null \?/g) ?? []).length === 2);
check('the Arabic line exists', I18N.includes("'The ad put {n} SAR in the price box — read as the price per m²': 'الإعلان كتب {n} ريال في خانة السعر — قرأناه سعراً للمتر'"));
check('no later migration redefines the rule without its guards',
  readdirSync(MIG).filter((f) => f > '20261104221247' && f.endsWith('.sql') && !f.startsWith('20261104221247'))
    .every((f) => { const s = readFileSync(join(MIG, f), 'utf8');
      const m = s.match(/create or replace function public\.land_ppm_typed_as_total_ar\([\s\S]*?\$function\$;/);
      return !m || ruleGuardsOk(m[0]); }));

// ── 6. the welcome facts follow the guard (owner 2026-11-04) ───────────────────────────────────────────────────────
// A land price the guard refuses to read joins no welcome median, in the builder AND in the recount; the audit fails
// every land price fact if the builder ever loses that exclusion; no later full redefinition may drop it.
{
  const W = readFileSync(join(MIG, '20261104223852_welcome_land_facts_follow_the_land_price_guard.sql'), 'utf8');
  check('the welcome builder nulls the per-metre figure of every review-list sale row',
    W.includes("update w_b b set price_per_meter = null\\n'") && W.includes("from public.land_price_unit_review_ar r\\n'"));
  check('the recount (audit) applies the same exclusion, written again',
    W.includes('case when rv.listing_id is null then s.price_per_meter end price_per_meter') && W.includes('left join a_review rv'));
  check('the audit fails land price facts when the builder lost the exclusion',
    /elsif r\.kind in \(''land_ppm_city'', ''land_gap'', ''month_land_ppm''\) and not v_build_excludes then why := ''land_fact_reads_review_rows''/.test(W));
  check('all welcome edits are exact text replaces with RAISE guards',
    /build_welcome_insights: expected exactly 1 anchor/.test(W) && /audit_welcome_insights: anchor % found % times/.test(W)
    && !/create\s+or\s+replace\s+function\s+public\.(build|audit)_welcome_insights/i.test(W));
  const later = readdirSync(MIG).filter((f) => f > '20261104223852' && f.endsWith('.sql'));
  for (const fn of ['build_welcome_insights', 'audit_welcome_insights']) {
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'i');
    check(`no later migration redefines ${fn} without the guard's exclusion`,
      later.every((f) => { const s = readFileSync(join(MIG, f), 'utf8'); return !re.test(s) || s.includes('land_price_unit_review_ar'); }));
  }
}

console.log(failed === 0 ? '\n✓ land per-metre-in-total: rule guarded, index and card agree, budget search finds the plot'
                         : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
