// A PRICE TYPED IN THOUSANDS (owner 2026-11-06, option A: «≈ figure × 1000 + a small note, keep the source figure»).
//
// Asas Makeen «سنا مكين — حي القيروان» shows «75 ﷼» for a yearly flat (= 75,000); Haraj land ads write «السوم 750 ألف»
// and type 750. The index decides (migration 20261106224834: price_in_thousands_served_ar in enforce_price_size_sanity)
// and the card follows the index's verdict (src/lib/priceInThousands.ts) — so the card, the client budget net and the
// four count RPCs carry ONE number.
//
// Hermetic (committed SQL + shipped TS, no DB). Auto-discovered by `npm test` (scripts/verify-*.ts).
//   1. the SQL rule keeps every guard, with MUTATION PROOFS (each guard removed → this file must notice);
//   2. the wiring: trigger edited by one exact text replace between the land rule and the hide, the sync hands the flags
//      over, price_fidelity knows the rule, the detector REPAIRS before it raises P1, the review list grows by appending;
//   3. the migration's own proof cases, executed through the TS recognizer (the shape the index serves ↔ the card);
//   4. the real round trip: card → the client nets lifted from src/data/search.ts (withinValue, rentAnnualValue);
//   5. the shipped files carry the verdict and both card layouts show the source figure.
// The LIVE proof (the same real rows, read from the database) is scripts/ops/proof_price_typed_in_thousands_2026-11-06.sql.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { servedFromThousands, followIndexThousandsVerdict, THOUSANDS_SERVED_MAX } from '../src/lib/priceInThousands.ts';
import { followIndexPerMeterVerdict } from '../src/lib/landPerMeterTotal.ts';
import { DERIVED_TOTAL_MAX } from '../src/data/listings.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const FILE = '20261106224834_price_typed_in_thousands_served_and_guarded.sql';
const SQL = readFileSync(join(MIG, FILE), 'utf8');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`catches: ${label}`, caught);

const lifted = await liftSymbols(join(ROOT, 'src/data/search.ts'),
  [{ header: 'function listingPriceValue(' }, { header: 'function withinValue(' }, { header: 'function rentAnnualValue(' }],
  ['withinValue', 'rentAnnualValue'], 'type Listing = any;\n');
const withinValue = lifted.withinValue as (price: string, min: number, max: number) => boolean;
const rentAnnualValue = lifted.rentAnnualValue as (l: unknown) => number;

// ── 1. the SQL rule ───────────────────────────────────────────────────────────────────────────────────────────────────
const fn = SQL.match(/create or replace function public\.price_in_thousands_ar\([\s\S]*?\$function\$;/)?.[0] ?? '';
const GUARDS: [string, RegExp][] = [
  ['the 500,000,000 bound', /p \* 1000 <= 500000000/],
  ['idempotence: served rent ≥ 15,000, served sale ≥ 20,000', /p \* 1000 >= case when is_rent then 15000 else 20000 end/],
  ['never price = area', /\(area is null or abs\(p - area\) > 1\)/],
  ['never when the ad says per-metre', /not coalesce\(says_per_m2, false\)/],
  ['land: the land signature', /not is_rent and p < 20000 and area >= 100 and p \/ area < 50/],
  ['land: the site\'s own box agreeing = real cheap land', /not \(ppm is not null and abs\(ppm \* area - p\) <= 0\.05 \* p\)/],
  ['land: ×1000 in the per-m² band AND the per-metre reading out', /p \* 1000 \/ area between band_lo and band_hi and not \(p between band_lo and band_hi\)/],
  ['homes: sale < 10,000, rent < 300', /\(case when is_rent then p < 300 else p < 10000 end\)/],
  ['homes: ×1000 in band AND the per-m² reading not also in band', /p \* 1000 between band_lo and band_hi\s+and not coalesce\(p \* area between band_lo and band_hi, false\)/],
];
export function ruleGuardsOk(body: string): boolean { return GUARDS.every(([, re]) => re.test(body)); }
check('the rule exists in the committed migration', fn.length > 0);
for (const [name, re] of GUARDS) check(`the rule keeps: ${name}`, re.test(fn));
// MUTATION PROOFS: remove each guard and the checker must fail.
for (const [name, re] of GUARDS) mustCatch(`a rule without «${name}»`, !ruleGuardsOk(fn.replace(re, 'true')));
check('the types are the silent-period judge\'s home/business list (no rooms, rest houses, chalets, farms)',
  /p_type in \('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري'\)/.test(SQL));
check('short stays (gathern, aqarmonthly) are never read in thousands',
  /coalesce\(p_platform, ''\) not in \('gathern', 'aqarmonthly'\)/.test(SQL));
check('land rents are never read in thousands (they stay on the review list)', /if v_rent or area is null or area < 100/.test(SQL));
check('the band excludes rows the rule already rewrote', /where s\.production_ready and not s\.price_in_thousands/.test(SQL));

// ── 2. the wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
check('no live function is fully replaced (trigger, sync, price_fidelity, evidence reader)',
  !/create\s+or\s+replace\s+function\s+public\.(enforce_price_size_sanity|sync_search_listings_ar|price_fidelity|refresh_land_price_unit_text_evidence)\b/i.test(SQL));
for (const f of ['enforce_price_size_sanity', 'sync_search_listings_ar', 'refresh_land_price_unit_text_evidence'])
  check(`${f}: one exact text replace with a RAISE guard`, SQL.includes(`raise exception '${f}: expected exactly 1 anchor, found %'`));
check('the trigger applies the rule to price_annual for a rent, price_total for a sale, and flags the row',
  /if NEW\.deal_ar = ''إيجار'' then NEW\.price_annual := v_fix; else NEW\.price_total := v_fix; end if;\\n'[\s\S]*NEW\.price_in_thousands := true;/.test(SQL));
check('a flag the writer handed over is kept (both rules) — the falcon 2026-11-06 root cause',
  SQL.includes('and NEW.ppm_typed_as_total is not distinct from OLD.ppm_typed_as_total) then')
  && SQL.includes('and NEW.price_in_thousands is not distinct from OLD.price_in_thousands) then'));
check('the sync hands both verdicts over', SQL.includes('ppm_typed_as_total=excluded.ppm_typed_as_total, price_in_thousands=excluded.price_in_thousands,'));
check('price_fidelity excuses a served figure only when it IS the rule\'s answer (× 1000, flag or rule)',
  SQL.includes('and not (s.price_total = x.src_total * 1000 and (s.price_in_thousands or s.price_total = public.price_in_thousands_served_ar(')
  && SQL.includes('and not (s.price_annual = x.src_annual * 1000 and (s.price_in_thousands or s.price_annual = public.price_in_thousands_served_ar('));
check('the ad\'s words are read for the SOURCE figure, so a corrected row keeps them',
  /when s\.ppm_typed_as_total then s\.price_per_meter::numeric/.test(SQL) && /when s\.price_in_thousands then \(case when s\.deal_ar = ''إيجار'' then s\.price_annual else s\.price_total end\) \/ 1000/.test(SQL));
check('the review list is APPENDED to the live view, never re-typed', /v := pg_get_viewdef\('public\.land_price_unit_review_ar'::regclass\);/.test(SQL)
  && !/create\s+or\s+replace\s+view\s+public\.land_price_unit_review_ar\s+with\s*\(security_invoker = true\)\s+as\s+select/i.test(SQL));
check('the review list names the three refused shapes', ['tiny_price_no_band', 'tiny_price_thousands_unclear', 'tiny_price_reads_per_m2'].every((r) => SQL.includes(`'${r}'`)));
{
  const det = SQL.slice(SQL.indexOf('function public.mon_detect_price_typed_in_thousands'));
  const upd = det.indexOf('update public.search_listings_ar s set price_total = s.price_total');
  const p1 = det.indexOf("mon_raise('P1'");
  check('the detector REPAIRS (no-op update fires the trigger) before it can raise P1', upd > 0 && p1 > upd);
  check('every key the detector raises has a resolve path',
    ['price_typed_in_thousands_self_healed', 'price_typed_in_thousands_served'].every((k) => det.includes(`mon_resolve_key('${k}'`)));
  check('the detector is scheduled daily, after the land detector (05:36)', /cron\.schedule\('mon-price-typed-in-thousands', '56 5 \* \* \*'/.test(SQL));
}
check('the welcome facts: the migration proves every welcome price floor still keeps review rows out',
  SQL.includes("price_annual between 3000 and 2000000") && SQL.includes("price_total between 100000 and 20000000")
  && SQL.includes("a welcome price floor moved"));
check('the served bound is the same number on both sides', THOUSANDS_SERVED_MAX === DERIVED_TOTAL_MAX);

// ── 3. the migration's proof cases through the TS recognizer ─────────────────────────────────────────────────────────
// price_in_thousands_ar(p, is_land, is_rent, …) is distinct from N → the index serves N, the card must print N.
// … is not null → the index serves the SOURCE figure, the card must leave it.
const CASE = /price_in_thousands_ar\((\d+), (true|false), (true|false), [^)]*\) (is distinct from (\d+)|is not null)/g;
const cases = [...SQL.matchAll(CASE)];
check(`the proof block has served AND untouched cases (${cases.length})`, cases.some((c) => c[5]) && cases.filter((c) => !c[5]).length >= 5);
for (const c of cases) {
  const p = Number(c[1]), deal = c[3] === 'true' ? 'Rent' : 'Buy';
  if (c[5]) check(`SQL case ${deal} «${p}» → ${Number(c[5]).toLocaleString('en')}: the card recognises it`, servedFromThousands(deal, p, Number(c[5])) === Number(c[5]));
  else check(`SQL case ${deal} «${p}» stays as published: the card leaves it`, servedFromThousands(deal, p, p) === null);
}

// ── 4. the round trip through the client nets ────────────────────────────────────────────────────────────────────────
type Card = Parameters<typeof followIndexThousandsVerdict>[0] & { area: number; pricePerMeter?: number | null };
const rent = (p: number): Card => ({ deal: 'Rent', price: `SAR ${p}`, area: 98, priceAnnual: p, rentPeriod: null, priceIsDerived: false });
const sale = (p: number, area = 1008): Card => ({ deal: 'Buy', price: `SAR ${p.toLocaleString('en-US')}`, area, salePriceTotal: p, pricePerMeter: null, priceIsDerived: false });
{
  const l = rent(75);
  check('Asas Makeen 24218839 «75»: the card follows the index (≈ 75,000 a year)', followIndexThousandsVerdict(l, 75000) && l.price === '≈ SAR 75,000/yr');
  check('…keeps the site\'s 75 for the «الموقع كتب 75» line, and is a yearly card', l.typedInThousands === 75 && l.rentPeriod === 'annual');
  check('…the 70k–80k yearly rent budget keeps the card the server matched', (() => { const a = rentAnnualValue(l); return a >= 70_000 && a <= 80_000; })());
  mustCatch('the pre-fix card (75) is dropped by that budget', rentAnnualValue(rent(75)) < 70_000);
  check('the RPC may send numeric as a string', followIndexThousandsVerdict(rent(75), '75000'));
}
{
  const l = sale(750);
  check('haraj 18706322 «السوم 750 ألف»: ≈ 750,000, inside a 700k–800k budget', followIndexThousandsVerdict(l, 750000) && withinValue(l.price, 700_000, 800_000));
  mustCatch('the pre-fix card (750) is dropped by that budget', !withinValue(sale(750).price, 700_000, 800_000));
}
check('real cheap land (15,055 served as published) is left alone', !followIndexThousandsVerdict(sale(15055, 1158), 15055));
check('a rent served under 15,000 is never this rule', servedFromThousands('Rent', 12, 12000) === null);
check('a served figure that is not exactly source × 1000 is not this rule', servedFromThousands('Rent', 75, 75600) === null);
check('a rent at 300 or above is not this rule', servedFromThousands('Rent', 300, 300000) === null);
check('a sale at 20,000 or above is not this rule', servedFromThousands('Buy', 20000, 20_000_000) === null);
check('no effective_price (deep link, older RPC) → the card stays as published', !followIndexThousandsVerdict(rent(75), null));
check('a card the land per-metre verdict already changed is never touched twice', (() => {
  const l = sale(750, 1000); followIndexPerMeterVerdict(l as never, 750000); return !followIndexThousandsVerdict(l, 750000);
})());

// ── 5. the shipped files ─────────────────────────────────────────────────────────────────────────────────────────────
const REMOTE = read('src/data/remote.ts');
const CARD = read('src/components/ResultCard.tsx');
const I18N = read('src/i18n.tsx');
check('remote.ts applies the verdict to every ranked card, after the land verdict',
  /followIndexPerMeterVerdict\(l, c\.effective_price\);[\s\S]{0,400}followIndexThousandsVerdict\(l, c\.effective_price\);/.test(REMOTE));
check('finalize() carries the raw rent figure the verdict is recognised against',
  /priceAnnual: deal === 'Rent' && typeof servedAnnual === 'number' \? servedAnnual : null,/.test(REMOTE));
check('both card layouts show the site\'s own figure', (CARD.match(/listing\.typedInThousands != null \?/g) ?? []).length === 2);
check('the Arabic line exists', I18N.includes("'The site wrote {n} — we read it in thousands': 'الموقع كتب {n} — قرأناه بالألف'"));
check('no later migration redefines the rule without its guards',
  readdirSync(MIG).filter((f) => f > FILE && f.endsWith('.sql'))
    .every((f) => { const m = readFileSync(join(MIG, f), 'utf8').match(/create or replace function public\.price_in_thousands_ar\([\s\S]*?\$function\$;/);
      return !m || ruleGuardsOk(m[0]); }));

console.log(failed === 0 ? '\n✓ price typed in thousands: rule guarded, index and card agree, budget search finds the ad'
                         : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
