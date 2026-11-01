// A district the SOURCE states must never become "no district" in the served index (owner 2026-10-18, SOURCE IS TRUTH).
//
// THE DEFECT THIS CLOSES. dealapp and abralosol have no native arm in listing_native_location_v1; their district reaches
// search_listings_ar only through district_recovery (v2: COALESCE(v1.district_ar, dr.district_ar)).
// refresh_district_recovery() kept a row only when resolve_district_ar() found the ad's neighborhood in the catalog, so
// «حي قريه ديراب» (المزاحمية), «حي الجامعة» (الدمام) and «ضاحية هجر» (الهفوف) were served as NULL — 2,036 dealapp + 714
// abralosol live rows. Migration 20261018*_district_recovery_carries_the_source_word.sql makes the recovery carry the
// source's own word when the catalog has no match, measures the drop per platform, and raises P1 for the carry platforms.
//
// This barrier pins the committed SQL's shape and proves each pin by mutating the text (a loosened copy must FAIL).
//   node --experimental-strip-types scripts/verify-source-district-never-dropped.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_district_recovery_carries_the_source_word\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_district_recovery_carries_the_source_word.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const file2 = readdirSync(dir).filter((f) => /^\d{14}_source_district_carried_fleet_wide_null_district_is_red\.sql$/.test(f)).sort().at(-1);
if (!file2) { console.log('FAIL  migration *_source_district_carried_fleet_wide_null_district_is_red.sql is missing'); process.exit(1); }
const sql2 = readFileSync(join(dir, file2), 'utf8');
const file3 = readdirSync(dir).filter((f) => /^\d{14}_district_recovery_resolves_in_the_served_city\.sql$/.test(f)).sort().at(-1);
if (!file3) { console.log('FAIL  migration *_district_recovery_resolves_in_the_served_city.sql is missing'); process.exit(1); }
const sql3 = readFileSync(join(dir, file3), 'utf8');
const file4 = readdirSync(dir).filter((f) => /^\d{14}_district_carry_folds_plot_codes\.sql$/.test(f)).sort().at(-1);
if (!file4) { console.log('FAIL  migration *_district_carry_folds_plot_codes.sql is missing'); process.exit(1); }
const sql4 = readFileSync(join(dir, file4), 'utf8');
const file5 = readdirSync(dir).filter((f) => /^\d{14}_district_recovery_never_truncates_and_mubarraz_city_correction\.sql$/.test(f)).sort().at(-1);
if (!file5) { console.log('FAIL  migration *_district_recovery_never_truncates_and_mubarraz_city_correction.sql is missing'); process.exit(1); }
const sql5 = readFileSync(join(dir, file5), 'utf8');
const file6 = readdirSync(dir).filter((f) => /^\d{14}_carried_district_no_latin_no_prose_and_card_label_contract_fast\.sql$/.test(f)).sort().at(-1);
if (!file6) { console.log('FAIL  migration *_carried_district_no_latin_no_prose_and_card_label_contract_fast.sql is missing'); process.exit(1); }
const sql6 = readFileSync(join(dir, file6), 'utf8');

// Every rule as a function of the SQL text, so the mutants below run the SAME verdict.
function problems(s: string): string[] {
  const fail: string[] = [];
  const fn = (name: string): string => {
    const m = s.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$(?:function|\\$)\\$;`));
    if (!m) fail.push(`function ${name} is not defined`);
    return m ? m[0] : '';
  };
  const carry = fn('source_district_carry_platforms');
  for (const p of ['dealapp', 'abralosol']) if (!carry.includes(`'${p}'`)) fail.push(`carry scope lost ${p}`);

  const helper = fn('district_recovery_value');
  const coalesce = helper.match(/coalesce\(\s*public\.resolve_district_ar\(p_city_id, p_neighborhood\)\s*,\s*case when p_platform = any \(public\.source_district_carry_platforms\(\)\)[\s\S]*?then btrim\(p_neighborhood\)/);
  if (!coalesce) fail.push('district_recovery_value no longer falls back to the source word (catalog first, then btrim(p_neighborhood) for carry platforms)');
  if (!/norm_district_tok\('غير محدد'\)/.test(helper)) fail.push('placeholder «غير محدد» is no longer excluded from the carry');
  if (!/p_neighborhood ~ '\[ء-ي\]'/.test(helper)) fail.push('the carry no longer requires an Arabic word — an English field («An-Narjis») would be served as a district');

  const table = fn('refresh_district_recovery_table');
  if (!/public\.district_recovery_value\(v1\.platform, v1\.city_id, x\.neighborhood\)/.test(table)) fail.push('the per-table recovery does not route neighborhood through district_recovery_value()');
  if (/v1\.city_id is not null/.test(table)) fail.push('the per-table recovery requires v1.city_id again — a source district without a city would be dropped');
  if (!/delete from public\.district_recovery where source_table = p_table/.test(table)) fail.push('the per-table recovery does not clear its own stale rows first');

  const full = fn('refresh_district_recovery');
  if (!/truncate public\.district_recovery;/.test(full) || !/public\.refresh_district_recovery_table\(r\.t\)/.test(full)) fail.push('refresh_district_recovery() no longer rebuilds every table through the per-table function');

  const rows = fn('source_district_dropped_rows');
  if (!/s\.district_ar is null/.test(rows) || !/nullif\(btrim\(r\.neighborhood\), ''\) is not null/.test(rows)) fail.push('source_district_dropped_rows() no longer measures "source has a district, index has none"');
  if (!/review_reason like 'city_only_match%%'/.test(rows)) fail.push('city-level matches (owner 2026-10-18) are no longer excluded from the drop measurement');

  const det = fn('mon_detect_source_district_dropped');
  if (!/mon_raise\('P1', 'source_district_dropped'/.test(det)) fail.push('the detector no longer raises P1 under dedup key source_district_dropped');
  if (!/d\.platform = any \(public\.source_district_carry_platforms\(\)\)/.test(det)) fail.push('the detector no longer scopes its raise to the carry platforms');
  if (!/mon_resolve\('source_district_dropped'/.test(det)) fail.push('the detector never resolves its own alert');
  if (!/position\('''mon_detect_source_district_dropped''' in d\) = 0 then raise exception 'roster edit did not land'/.test(s)) fail.push('mon_detect_source_district_dropped is not rostered in mon_run_all_detectors (an unrostered detector is decoration)');

  const city = fn('resolve_dealapp_city');
  if (!/or not exists \(select 1 from public\.listings_arabic_locations l[\s\S]*?normalize_ar\(l\.city_ar\) = normalize_ar\(r\.additional_info->>'city_ar'\)/.test(city)) fail.push('resolve_dealapp_city() fills gaps only again — a bridge city the source no longer states is never corrected');
  if (!/having count\(distinct c\.city_id\) = 1/.test(city)) fail.push('resolve_dealapp_city() lost the one-catalog-city rule (a city would be guessed)');

  if (!/select public\.resolve_district_ar\(p_city_id, p_neighborhood\) \$b\$\$m\$;[\s\S]*?if r < 500 then raise exception/.test(s)) fail.push('the apply-time proof no longer restores the resolver-only helper and demands ≥ 500 dropped rows');
  if (!/raise exception 'ROLLBACK_REVERT'/.test(s)) fail.push('the apply-time proof does not roll its mutant back');
  if (!/city_only_match: source gives no district \(owner 2026-10-18/.test(s)) fail.push('the 11 abralosol city-only ads are no longer marked');
  return fail;
}

// Step 2 (owner 2026-10-18, fleet-wide): every platform carries; a NULL district is red unless proven silent.
function problems2(s: string): string[] {
  const fail: string[] = [];
  const fn = (name: string): string => {
    const m = s.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$(?:function|\\$)\\$;`));
    if (!m) fail.push(`function ${name} is not defined in the fleet-wide step`);
    return m ? m[0] : '';
  };
  if (!/drop function if exists public\.source_district_carry_platforms\(\);/.test(s)) fail.push('the carry list is not retired — some platform could still be left out');
  const helper = fn('district_recovery_value');
  if (/p_platform = any/.test(helper)) fail.push('district_recovery_value() gates the carry by platform again');
  const order = helper.match(/coalesce\(\s*public\.resolve_district_ar\(p_city_id, p_neighborhood\),\s*case when p_platform = 'aqar' then public\.resolve_district_ar\(p_city_id, public\.aqar_address_district\(p_url\)\) end,\s*case when p_neighborhood ~ '\[ء-ي\]'/);
  if (!order) fail.push('the order field-catalog → aqar address slug → source word is broken (address-first would move ~24k aqar districts)');
  if (!/p_neighborhood !~ '\[0-9٠-٩\]'/.test(helper)) fail.push('a digit-bearing plot/plan code can be carried again (it stopped the canonical refresh on «حي 33ج»)');
  if (!/norm_district_tok\('غير محدد'\)/.test(helper)) fail.push('placeholder «غير محدد» is no longer excluded from the carry');
  const table = fn('refresh_district_recovery_table');
  if (!/public\.district_recovery_value\(v1\.platform, v1\.city_id, x\.neighborhood, x\.listing_url\)/.test(table)) fail.push('the per-table recovery no longer passes the ad URL (aqar address slug)');
  if (/v1\.city_id is not null/.test(table)) fail.push('the per-table recovery requires v1.city_id again');
  if (!/create table if not exists public\.district_silent_proven \(/.test(s) || !/checked_by\s+text not null/.test(s) || !/proof\s+text not null/.test(s)) fail.push('the proven-silent allowlist (platform, checked_at, checked_by, proof, note) is missing or lost its required columns');
  if (/insert into public\.district_silent_proven/.test(s)) fail.push('the allowlist is seeded — nothing is proven silent by this migration');
  const rows = fn('source_district_dropped_rows');
  if (!/s\.production_ready and s\.district_ar is null/.test(rows)) fail.push('the measurement no longer counts every production_ready row with no district');
  for (const col of ['dropped', 'blank', 'numbered', 'english', 'silent_proven']) if (!new RegExp(`${col} (bigint|boolean)`).test(rows)) fail.push(`measurement column ${col} is gone`);
  if (!/public\.district_silent_proven p where p\.platform = %L/.test(rows)) fail.push('silent_proven no longer reads the allowlist');
  const det = fn('mon_detect_source_district_dropped');
  if (!/mon_raise\('P1', 'source_district_dropped'/.test(det)) fail.push('a dropped source district no longer raises P1');
  if (!/mon_raise\('P2', 'district_null_unproven'/.test(det)) fail.push('an unproven blank district no longer raises');
  if (!/filter \(where not silent_proven\)/.test(det)) fail.push('the unproven count ignores the allowlist');
  if (!/order by null_rows desc/.test(det)) fail.push('the per-platform table is not biggest-first');
  if (!/plot\/plan code «33ج»/.test(s) || !/canonical guard did not land/.test(s)) fail.push('the canonical refresher guard (skip, never assert on, a numbered live label) is gone');
  if (!/select public\.resolve_district_ar\(p_city_id, p_neighborhood\) \$b\$\$m\$;[\s\S]*?if r < 300 then raise exception/.test(s)) fail.push('the apply-time proof no longer restores the resolver-only helper and demands ≥ 300 re-dropped aqar rows');
  if (!/raise exception 'ROLLBACK_REVERT'/.test(s)) fail.push('the apply-time proof does not roll its mutant back');
  if (!/public\.refresh_loc_canonical_district\(\);/.test(s)) fail.push('the proof no longer runs the canonical refresh');
  return fail;
}

// Step 3 (2026-10-18): the district is resolved in the SERVED city when v1 has none; one allowlist (#7485's).
function problems3(s: string): string[] {
  const fail: string[] = [];
  const fn = (name: string): string => {
    const m = s.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$(?:function|\\$)\\$;`));
    if (!m) fail.push(`function ${name} is not defined in the served-city step`);
    return m ? m[0] : '';
  };
  const table = fn('refresh_district_recovery_table');
  const served = table.match(/coalesce\(v1\.city_id, s\.city_id\)/g) || [];
  if (served.length !== 2) fail.push(`both recovery inserts must resolve in coalesce(v1.city_id, s.city_id) — found ${served.length}`);
  if ((table.match(/left join public\.search_listings_ar s on s\.source_table = v1\.source_table and s\.listing_id = v1\.listing_id/g) || []).length !== 2) fail.push('the served city is no longer joined from search_listings_ar in both inserts');
  const rows = fn('source_district_dropped_rows');
  if (!/public\.ops_district_silent_source o where o\.platform = %L and o\.source_table is null/.test(rows)) fail.push("the measurement no longer reads #7485's allowlist (ops_district_silent_source)");
  if (/district_silent_proven/.test(rows)) fail.push('the measurement reads the retired duplicate allowlist');
  const det = fn('mon_detect_source_district_dropped');
  if (!/mon_raise\('P1', 'source_district_dropped'/.test(det)) fail.push('a dropped source district no longer raises P1');
  if (/district_null_unproven/.test(det)) fail.push("the duplicate P2 limb is back (blank sources are #7485's district_blank_unexplained)");
  if (!/drop table public\.district_silent_proven;/.test(s)) fail.push('the duplicate allowlist table is not retired');
  if (!/'coalesce\(v1\.city_id, s\.city_id\)', 'v1\.city_id'\);[\s\S]*?if r < 200 then raise exception/.test(s)) fail.push('the apply-time proof no longer restores the v1-city-only recovery and demands ≥ 200 re-dropped rows');
  return fail;
}

// Step 4 (2026-10-18): a plot code is folded off a real district; pure codes stay NULL; the refill is MVCC-safe.
// The fold and the carry test are LIFTED from the committed SQL and executed here on the owner's cases.
function problems4(s: string): string[] {
  const fail: string[] = [];
  const fold = s.match(/create or replace function public\.district_plot_fold[\s\S]*?coalesce\(p, ''\),\s*'([^']+)', ''\),\s*'([^']+)', ''\),\s*'([^']+)', '', 'g'\)\), ''\)/);
  const carry = s.match(/create or replace function public\.district_word_carryable[\s\S]*?w ~ '([^']+)'\s*and regexp_replace\(w, '([^']+)', ''\) ~ '([^']+)'\s*and \(w !~ '([^']+)' or w ~ '([^']+)'\)/);
  if (!fold) fail.push('district_plot_fold() is missing or reshaped');
  if (!carry) fail.push('district_word_carryable() is missing or reshaped');
  if (fold && carry) {
    const js = (p: string, f = 'u') => new RegExp(p, f);
    const doFold = (v: string) => {
      const out = v.replace(js(fold[1]), '').replace(js(fold[2]), '').replace(js(fold[3], 'gu'), '').trim();
      return out === '' ? null : out;
    };
    const ok = (w: string | null) => w !== null && js(carry[1]).test(w) && js(carry[3]).test(w.replace(js(carry[2]), ''))
      && (!js(carry[4]).test(w) || js(carry[5]).test(w));
    const cases: Array<[string, string | null, boolean]> = [
      ['بوسحبل (345/4)', 'بوسحبل', true], ['شرق المحدود 176 أ', 'شرق المحدود', true],
      ['ضاحية هجر ،، الحي السابع رقم 351 / ب', 'ضاحية هجر ،، الحي السابع', true], ['الصفا ١ (93/14)', 'الصفا ١', true],
      ['الغسانية ٢', 'الغسانية ٢', true], ['33ج', '33ج', false], ['حي 1029 مخطط رقم', 'حي', false],
      ['حي (حي رقم (5', 'حي', false], ['حي ج1', 'حي ج1', false], ['7037 سلمان الفا', null, false],
      ['حي 1النخيل', 'حي 1النخيل', false], ['البصر3 مدينه', 'البصر3 مدينه', false], ['حي جو', 'حي جو', false],
    ];
    for (const [src, want, c] of cases) {
      const got = doFold(src);
      if (got !== want) fail.push(`fold «${src}» → «${got}», want «${want}»`);
      if (ok(got) !== c) fail.push(`carry «${src}» = ${ok(got)}, want ${c}`);
    }
  }
  const value = s.match(/create or replace function public\.district_recovery_value[\s\S]*?\$\$;/)?.[0] ?? '';
  if (!/district_word_carryable\(public\.district_plot_fold\(p_neighborhood\)\)\s*then public\.district_plot_fold\(p_neighborhood\)/.test(value)) fail.push('district_recovery_value() no longer carries the plot-folded word');
  if (/truncate/i.test(s.replace(/--[^\n]*/g, ''))) fail.push('the refill truncates district_recovery (not MVCC-safe; the coordinator forbade it)');
  if (!/pg_advisory_xact_lock\(hashtext\('location_pipeline:v1_refresh'\)\)/.test(s) || !/pg_try_advisory_xact_lock\(hashtext\('search_listings_ar:single_writer'\)\)/.test(s)) fail.push('the refill no longer holds the pipeline locks');
  if (!/after_total < 0\.99 \* before_total/.test(s) || !/p\.after_n < 0\.99 \* p\.before_n/.test(s)) fail.push('the ≥ 99% total/per-platform refill assertion is gone');
  if (!/\('33ج',\s+'33ج',\s+false\)/.test(s)) fail.push('the apply-time truth table lost the pure-code case «33ج»');
  return fail;
}

// Step 5 (2026-10-18): the hourly refill never TRUNCATEs and never loses > 1%; the المبرز city correction is deterministic.
function problems5(s: string): string[] {
  const fail: string[] = [];
  const code = s.replace(/--[^\n]*/g, '');
  const fn = (name: string): string => {
    const m = code.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$(?:function|\\$)\\$;`));
    if (!m) fail.push(`function ${name} is not defined in step 5`);
    return m ? m[0] : '';
  };
  const full = fn('refresh_district_recovery');
  const table = fn('refresh_district_recovery_table');
  if (/truncate/i.test(full) || /truncate/i.test(table)) fail.push('the hourly refill TRUNCATEs district_recovery (not MVCC-safe: a stale snapshot serves ~112k districts as NULL)');
  if (!/v_elig >= 50 and v_lost > 0\.01 \* v_elig/.test(table) || !/'district_recovery_shrank'/.test(table) || !/return 0;\s*end if;\s*delete from public\.district_recovery where source_table = p_table;/.test(table)) fail.push('the > 1% loss guard (keep the previous rows + alert, BEFORE the delete) is gone');
  if (!/perform public\.refresh_listing_city_correction\(\);/.test(full)) fail.push('the city correction is no longer refreshed hourly');
  const corr = fn('refresh_listing_city_correction');
  if (!/having count\(distinct d\.city_id\) = 1/.test(corr)) fail.push('the city correction no longer requires ONE governorate city');
  if (!/where v1\.city_id in \(12, 3677\)\s*and u\.city_id not in \(12, 3677\)/.test(corr)) fail.push('the city correction is no longer limited to office-default الهفوف/الاحساء rows moving elsewhere');
  if (!/u\.district_norm in \('غسانيه'/.test(corr)) fail.push('the city correction is no longer limited to the 10-08 hold names (uniqueness elsewhere is a guess)');
  if (!/'unique_district_in_governorate'/.test(corr)) fail.push('the correction lost its provenance');
  if (!/COALESCE\(xcc\.city_id, v1\.city_id/.test(code) || !/if k <> 3 then raise exception 'v2 anchor city found/.test(code)) fail.push('v2 no longer serves the correction ahead of v1 (or its anchor count check is gone)');
  if (!/rows lost their district in v2/.test(code)) fail.push('the apply-time proof no longer checks that no row lost its district');
  return fail;
}

// Step 6 (2026-10-18): a carried word never has Latin letters or prose length (they broke the whole detector roster), and
// card_label_contract's sample query computes `split` once.
function problems6(s: string): string[] {
  const fail: string[] = [];
  const carry = s.match(/create or replace function public\.district_word_carryable[\s\S]*?\$\$;/)?.[0] ?? '';
  if (!/and w !~ '\[A-Za-z\]'/.test(carry)) fail.push('a carried district may contain Latin letters again (page chrome such as «عقارات جدة JIJB»)');
  if (!/and length\(btrim\(w\)\) <= 40/.test(carry)) fail.push('a carried district may be an address chain or prose again (> 40 characters)');
  if (!/a_cte, 'with split as materialized \('\)/.test(s)) fail.push('card_label_contract\'s split CTE is no longer materialized (inlined per row = the 15-minute roster timeout)');
  if (!/in \(select p\.city_id, p\.tok from split p\)\)'\)/.test(s)) fail.push('card_label_contract still probes split with a correlated EXISTS');
  if (!/if secs > 120 then raise exception/.test(s)) fail.push('the apply-time timing proof of the detector is gone');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
// Mutation proof: the SAME verdict function, run on a deliberately loosened copy of the committed SQL, must go red.
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql);
check(`committed migration ${file} holds every pin`, live.length === 0, live.join('; '));

// Mutants: each loosening of the committed text must be caught by the same verdict.
const mutants: Array<[string, (s: string) => string]> = [
  ['resolver-only helper (the bug restored)', (s) => s.replace(/coalesce\(\s*public\.resolve_district_ar\(p_city_id, p_neighborhood\),[\s\S]*?end\)\n\$\$;/, 'public.resolve_district_ar(p_city_id, p_neighborhood)\n$$;')],
  ['abralosol dropped from the carry scope', (s) => s.replace("array['dealapp', 'abralosol']", "array['dealapp']")],
  ['city gate re-added to the per-table recovery', (s) => s.replace("where v1.source_table = %1$L\n      and (v1.district_ar is null", "where v1.source_table = %1$L\n      and v1.city_id is not null\n      and (v1.district_ar is null")],
  ['Arabic-only guard removed from the carry', (s) => s.replace(/\n\s*and p_neighborhood ~ '\[ء-ي\]'[^\n]*/, '')],
  ['detector downgraded to P2', (s) => s.replace("mon_raise('P1', 'source_district_dropped'", "mon_raise('P2', 'source_district_dropped'")],
  ['roster block removed', (s) => s.replace(/do \$roster\$[\s\S]*?\$roster\$;/, '')],
  ['dealapp city bridge fills gaps only again', (s) => s.replace(/\n\s*-- 2026-10-18: a bridge city the source no longer states[\s\S]*?additional_info->>'city_ar'\)\)\)/, ')')],
  ['city-only exclusion removed from the measurement', (s) => s.replace(/\n\s*and not exists \(select 1 from public\.listings_arabic_locations l\n\s*where l\.source_table = s\.source_table and l\.listing_id = s\.listing_id\n\s*and l\.review_reason like 'city_only_match%%'\)/, '')],
  ['apply-time mutant proof deleted', (s) => s.replace(/\n  begin\n    execute \$m\$create or replace function public\.district_recovery_value[\s\S]*?end;\n/, '\n')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const live2 = problems2(sql2);
check(`committed migration ${file2} holds every fleet-wide pin`, live2.length === 0, live2.join('; '));
const mutants2: Array<[string, (s: string) => string]> = [
  ['platform gate back in the helper', (s) => s.replace("case when p_neighborhood ~ '[ء-ي]'", "case when p_platform = any (array['dealapp']) and p_neighborhood ~ '[ء-ي]'")],
  ['digit guard removed (plot codes carried)', (s) => s.replace(/\n\s*and p_neighborhood !~ '\[0-9٠-٩\]'[^\n]*/, '')],
  ['address slug before the field (24k aqar districts move)', (s) => s.replace("public.resolve_district_ar(p_city_id, p_neighborhood),\n    case when p_platform = 'aqar' then public.resolve_district_ar(p_city_id, public.aqar_address_district(p_url)) end,", "case when p_platform = 'aqar' then public.resolve_district_ar(p_city_id, public.aqar_address_district(p_url)) end,\n    public.resolve_district_ar(p_city_id, p_neighborhood),")],
  ['allowlist seeded', (s) => s.replace('alter table public.district_silent_proven enable row level security;', "insert into public.district_silent_proven (platform, checked_by, proof) values ('haraj', 'x', 'y');\nalter table public.district_silent_proven enable row level security;")],
  ['unproven blanks no longer raise', (s) => s.replace("mon_raise('P2', 'district_null_unproven'", "mon_raise('P4', 'district_null_unproven'")],
  ['allowlist ignored by the detector', (s) => s.replace('filter (where not silent_proven)', '')],
  ['canonical guard block deleted', (s) => s.replace(/do \$canon\$[\s\S]*?\$canon\$;/, '')],
  ['apply-time mutant proof deleted', (s) => s.replace(/\n  begin\n    execute \$m\$create or replace function public\.district_recovery_value\(p_platform text, p_city_id integer, p_neighborhood text, p_url text default null\)[\s\S]*?end;\n/, '\n')],
];
for (const [label, mutate] of mutants2) {
  const m = mutate(sql2);
  mustCatch(`fleet-wide: ${label}`, m !== sql2 && problems2(m).length > 0, m === sql2 ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const live3 = problems3(sql3);
check(`committed migration ${file3} holds every served-city pin`, live3.length === 0, live3.join('; '));
const mutants3: Array<[string, (s: string) => string]> = [
  ['served-city fallback removed (239 wasalt rows drop again)', (s) => s.replace(/coalesce\(v1\.city_id, s\.city_id\)(?=, x\.neighborhood)/, 'v1.city_id')],
  ['duplicate P2 limb re-added', (s) => s.replace("if v_dropped = 0 then", "perform public.mon_raise('P2', 'district_null_unproven', 'location_pipeline', 'district_null_unproven', '{}'::jsonb);\n  if v_dropped = 0 then")],
  ['measurement back on the retired allowlist', (s) => s.replace('public.ops_district_silent_source o where o.platform = %L and o.source_table is null', 'public.district_silent_proven p where p.platform = %L')],
  ['served-city proof deleted', (s) => s.replace(/\n  begin\n    execute replace\(pg_get_functiondef[\s\S]*?end;\n/, '\n')],
];
for (const [label, mutate] of mutants3) {
  const m = mutate(sql3);
  mustCatch(`served-city: ${label}`, m !== sql3 && problems3(m).length > 0, m === sql3 ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const live4 = problems4(sql4);
check(`committed migration ${file4} holds every fold/hold pin`, live4.length === 0, live4.join('; '));
const mutants4: Array<[string, (s: string) => string]> = [
  ['any digits carried (codes like «33ج» become districts)', (s) => s.replace("or w ~ '^[^0-9٠-٩]*[ء-ي]{3,}[^0-9٠-٩]*[0-9٠-٩]{1,2}$'", "or w ~ '.'")],
  ['a bare «حي» counts as a name', (s) => s.replace("~ '[ء-ي]{3,}'\n    and (w !~", "~ '[ء-ي]{1,}'\n    and (w !~")],
  ['fold stops at the bracket only (plot numbers kept)', (s) => s.replace("'\\s*(\\(|\\[|رقم\\s*[\\(:0-9٠-٩]|[0-9٠-٩]{3,}).*$'", "'\\s*(\\(|\\[).*$'")],
  ['refill by TRUNCATE', (s) => s.replace('perform public.refresh_district_recovery_table(t);', 'truncate public.district_recovery; perform public.refresh_district_recovery_table(t);')],
  ['writer lock dropped', (s) => s.replace("got := pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer'));", 'got := true;')],
  ['per-platform 99% check dropped', (s) => s.replace('if p.after_n < 0.99 * p.before_n then', 'if false then')],
];
for (const [label, mutate] of mutants4) {
  const m = mutate(sql4);
  mustCatch(`fold/hold: ${label}`, m !== sql4 && problems4(m).length > 0, m === sql4 ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const live5 = problems5(sql5);
check(`committed migration ${file5} holds every refill/city pin`, live5.length === 0, live5.join('; '));
const mutants5: Array<[string, (s: string) => string]> = [
  ['TRUNCATE back in the hourly refill', (s) => s.replace("declare r record; n bigint := 0; m bigint;\nbegin\n  for r in", "declare r record; n bigint := 0; m bigint;\nbegin\n  truncate public.district_recovery;\n  for r in")],
  ['loss guard removed', (s) => s.replace('if v_elig >= 50 and v_lost > 0.01 * v_elig then', 'if false then')],
  ['correction without the uniqueness rule', (s) => s.replace('having count(distinct d.city_id) = 1) u', ') u')],
  ['correction for every name (not only the hold list)', (s) => s.replace(/\n\s*-- the 10-08 المبرز hold names[\s\S]*?'بو سحبل الاول'\)/, '')],
];
for (const [label, mutate] of mutants5) {
  const m = mutate(sql5);
  mustCatch(`refill/city: ${label}`, m !== sql5 && problems5(m).length > 0, m === sql5 ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

const live6 = problems6(sql6);
check(`committed migration ${file6} holds the carry and roster-speed pins`, live6.length === 0, live6.join('; '));
mustCatch('carry: Latin guard removed', problems6(sql6.replace("    and w !~ '[A-Za-z]'", '')).length > 0);
mustCatch('detector: split CTE inlined again', problems6(sql6.replace("a_cte, 'with split as materialized ('", "a_cte, 'with split as ('")).length > 0);

console.log(failed === 0 ? 'OK: a source district can never be dropped silently again' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
