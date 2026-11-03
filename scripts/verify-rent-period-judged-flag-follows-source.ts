// THE «JUDGED» RENT-PERIOD FLAG FOLLOWS THE SOURCE, AND THE RENT-PERIOD DETECTORS KNOW THE JUDGMENT RULE.
//
// Measured 2026-11-03 (alert_event 12411 rent_period_source_truth, 11387 rent_period_contract, 7257
// unlocated_search_contract):
//   * 10,872 of the 10,880 «period inferred from silence» rows were the owner's own silent-period
//     judgment (2026-09-28, docs/ARCHITECTURE.md «A SILENT period is JUDGED from the price»). Both
//     detectors predated the rule and read it as manufactured evidence.
//   * The other 8, and 1,939 rows the other way round (judged=true while the source STATES a period),
//     came from the upsert: sync_search_listings_ar's ON CONFLICT never handed over the flag its own
//     INSERT pass computed, and enforce_rent_period_judgment() kept OLD's flag whenever the period word
//     was unchanged. A judged flag on a stated row hides it from every detector that skips judged rows.
//   * rent_period_contract's other limbs still expected «شهري» for any stated monthly ad (5,094 rows)
//     although the 2026-10-25 pool rule serves those as «سنوي» ×12 — the writer is rent_pool_ar().
//   * trg_set_match_city_ids() handed two UNLOCATED rows city match ids by resolving a composite name
//     («الدوادمي - البجادية») part by part nationally.
//
// The production state is watched twice an hour by the detectors themselves (the new limb
// judged_flag_on_stated_period). This hermetic half pins the committed SQL that fixes the writers, so a
// later migration re-creating any of these functions from an older copy goes RED at PR time.
//
//   node --experimental-strip-types scripts/verify-rent-period-judged-flag-follows-source.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const migDir = join(root, 'supabase/migrations');
let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? `\n      ${extra}` : ''}`);
};

type Mig = { file: string; sql: string };
const migrations: Mig[] = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((file) => ({ file, sql: readFileSync(join(migDir, file), 'utf8') }));

/** The newest migration that (re)defines or patches `fn` — what production runs today. */
function newest(all: Mig[], touches: (sql: string) => boolean): Mig | undefined {
  return [...all].reverse().find((m) => touches(m.sql));
}
const definesFn = (fn: string) => (sql: string) =>
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fn}\\s*\\(`, 'i').test(sql)
  || new RegExp(`pg_get_functiondef\\('public\\.${fn}'::regproc\\)`, 'i').test(sql);

type Rule = { label: string; fn: string; must: RegExp[]; why: string };
const RULES: Rule[] = [
  { label: 'the silent-source detector excludes the owner\'s judgment and watches the flag the other way',
    fn: 'mon_detect_rent_period_inferred_when_source_silent',
    must: [/rent_period_judgment_holds\(/, /judged_flag_on_stated_period/],
    why: 'without the predicate every judged row reads as manufactured; without the limb a stale flag is invisible' },
  { label: 'the rent-period contract judges stated periods by rent_pool_ar() and excludes the judgment',
    fn: 'mon_detect_rent_period_contract',
    must: [/rent_period_judgment_holds\(/, /is distinct from public\.rent_pool_ar\(s\.platform, lv\.rent_period\)/,
           /rent_period_judged=excluded\.rent_period_judged/],
    why: 'stated monthly ads on mixed sites pool as «سنوي» ×12 (owner 2026-10-25)' },
  { label: 'the judgment trigger accepts a handed-over flag only when the judgment backs it',
    fn: 'enforce_rent_period_judgment',
    must: [/NEW\.rent_period_judged is distinct from OLD\.rent_period_judged/,
           /rent_period_judgment_holds\(true, NEW\.rent_period_ar/],
    why: 'otherwise the UPDATE pass keeps OLD\'s flag whenever the period word is unchanged' },
  { label: 'the sync hands over the flag and revisits a judged row whose source now states a period',
    fn: 'sync_search_listings_ar',
    must: [/rent_period_judged=excluded\.rent_period_judged/, /\(s3\.rent_period_judged and v\.rent_period is not null\)/],
    why: 'the ON CONFLICT SET dropped the INSERT pass\'s verdict' },
  { label: 'an unlocated row (no proven city) is given no city match ids',
    fn: 'trg_set_match_city_ids',
    must: [/case when new\.city_id is null then null/],
    why: 'composite_match_city_ids resolves composite names nationally (owner location decision 2026-08-18)' },
];

function evaluate(all: Mig[]): string[] {
  const bad: string[] = [];
  for (const r of RULES) {
    const m = newest(all, definesFn(r.fn));
    if (!m) { bad.push(`${r.fn}: no committed migration defines it`); continue; }
    const missing = r.must.filter((re) => !re.test(m.sql));
    if (missing.length) bad.push(`${r.fn} (newest: ${m.file}) lacks ${missing.map(String).join(', ')} — ${r.why}`);
  }
  // The shared predicate must exist and know both directions of the judgment.
  const helper = newest(all, definesFn('rent_period_judgment_holds'));
  if (!helper) bad.push('rent_period_judgment_holds: no committed migration defines it');
  else if (!/judge_silent_rent_period_ar\(p_price_annual \/ 12/.test(helper.sql)
        || !/'gathern', 'aqarmonthly'/.test(helper.sql)) {
    bad.push(`rent_period_judgment_holds (${helper.file}) no longer covers the ×12 per-month path or the stay-length platforms`);
  }
  return bad;
}

const real = evaluate(migrations);
for (const r of RULES) check(r.label, !real.some((b) => b.startsWith(r.fn)), real.filter((b) => b.startsWith(r.fn)).join('; '));
check('rent_period_judgment_holds covers the ×12 path and the stay-length platforms',
  !real.some((b) => b.startsWith('rent_period_judgment_holds')), real.filter((b) => b.startsWith('rent_period_judgment_holds')).join('; '));

// MUTATION PROOFS: a newer migration re-creating each function from its pre-fix shape must go RED.
const MUTANTS: Array<[string, string]> = [
  ['the old silent detector (no judgment predicate)',
   `create or replace function public.mon_detect_rent_period_inferred_when_source_silent() returns integer as $$ select 1 $$;`],
  ['the old contract (stated monthly must read «شهري»)',
   `create or replace function public.mon_detect_rent_period_contract() returns integer as $$ select 1 $$;`],
  ['the old trigger (keeps OLD flag)',
   `create or replace function public.enforce_rent_period_judgment() returns trigger as $$ begin return new; end $$;`],
  ['a sync patch that drops the flag hand-over',
   `do $$ begin perform pg_get_functiondef('public.sync_search_listings_ar'::regproc); end $$;`],
  ['the old match-ids trigger (composite ids for unlocated rows)',
   `create or replace function public.trg_set_match_city_ids() returns trigger as $$ begin return new; end $$;`],
  ['a helper without the ×12 path',
   `create or replace function public.rent_period_judgment_holds(a boolean) returns boolean as $$ select true $$;`],
];
for (const [name, sql] of MUTANTS) {
  check(`(mutation) catches: ${name}`, evaluate([...migrations, { file: '99999999999999_mutant.sql', sql }]).length > 0);
}

if (failed) { console.error(`\nverify-rent-period-judged-flag-follows-source: ${failed} FAILED`); process.exit(1); }
console.log('\nverify-rent-period-judged-flag-follows-source: all checks passed');
