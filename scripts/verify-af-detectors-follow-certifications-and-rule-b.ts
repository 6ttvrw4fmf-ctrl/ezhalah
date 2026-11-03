// Two AF detectors that went stale against rules the owner had already approved (🔬 2026-11-03):
//
// 1. alert 12568 (P1 since 2026-11-01): mon_check_filter_parity_legacy()'s Monthly freeze guard still allowed only
//    شقة/غرفة/فيلا while reviewed migrations 20261101110658 and 20261102101415 had certified studio, rest house,
//    chalet and camp short-stays cohorts. RULE: every شهري type a committed migration inserts into af_cohort_registry
//    is in the guard's certified list (the newest committed definition), so a certification and its guard travel
//    together, and an uncertified row still pages.
// 2. alert 12359: mon_detect_af_source_mapping_integrity() compared the search index with the BOX layer, but since
//    Rule B (owner 2026-10-25) the index serves af_rule_b(box, text). RULE: the index arm compares with the value
//    the writers serve.
//
//   node --experimental-strip-types scripts/verify-af-detectors-follow-certifications-and-rule-b.ts  (npm test)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const DIR = join(root, 'supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const noComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const newestDefining = (fn: string) => {
  const f = files.filter((x) => read(x).includes(`function public.${fn}(`)).pop();
  assert.ok(f, `no committed migration defines ${fn}`);
  return noComments(read(f!));
};
function mustCatch(label: string, caught: boolean) {
  assert.ok(caught, `mutation not caught: ${label}`);
}

// ── 1. certified شهري set ──────────────────────────────────────────────────────────────────────────
const certifiedIn = (code: string): Set<string> => {
  const m = code.match(/rent_period_ar = 'شهري'\s+and type_ar not in \(([^)]*\)?[^)]*)\)\) then/);
  assert.ok(m, 'the Monthly freeze guard (type_ar not in (...)) is not readable');
  return new Set([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
};
const insertedMonthly = new Set<string>();
for (const f of files) {
  const s = read(f);
  if (!/insert into public\.af_cohort_registry/.test(s)) continue;
  for (const x of s.matchAll(/\('([^']+)',\s*'إيجار',\s*'شهري'/g)) insertedMonthly.add(x[1]);   // (type, deal, period)
  for (const x of s.matchAll(/\('إيجار',\s*'شهري',\s*'([^']+)'/g)) insertedMonthly.add(x[1]);   // (deal, period, type)
}
const missing = (code: string) => [...insertedMonthly].filter((t) => !certifiedIn(code).has(t));
const guard = newestDefining('mon_check_filter_parity_legacy');
for (const t of ['استوديو', 'استراحة', 'شاليه', 'مخيم']) assert.ok(insertedMonthly.has(t), `scan missed the certified ${t}`);
mustCatch('the 2026-08-18 guard (شقة/غرفة/فيلا only)',
  missing(guard.replace(/type_ar not in \([\s\S]*?\)\) then/, "type_ar not in ('شقة','غرفة','فيلا')) then")).length > 0);
mustCatch('a guard that drops the chalet certification', missing(guard.replace("'شاليه',", '')).includes('شاليه'));
assert.deepEqual(missing(guard), [], 'a شهري cohort certified by a committed migration is missing from the freeze guard');
assert.ok(/mon_raise\('P1', 'af_registry_monthly_uncertified'/.test(guard), 'an uncertified شهري row no longer pages P1');
console.log(`✓ the Monthly freeze guard certifies all ${insertedMonthly.size} committed شهري cohort types and still pages on any other`);

// ── 2. the index arm reads what Rule B serves ──────────────────────────────────────────────────────
const integ = newestDefining('mon_detect_af_source_mapping_integrity');
const readsRuleB = (c: string) =>
  /public\.af_rule_b\(c\.%1\$I, tf\.%1\$I\)/.test(c)
  && /x\.%I is distinct from \(%s\)/.test(c)
  && /left join public\.listing_text_facts_af tf/.test(c);
mustCatch('the pre-fix arm (index compared with the box)',
  !readsRuleB(integ.replace('x.%I is distinct from (%s)', 'c.%I is distinct from x.%I')));
mustCatch('the text overlay join dropped', !readsRuleB(integ.replace(/left join public\.listing_text_facts_af tf[^\n]*\n/, '')));
assert.ok(readsRuleB(integ), 'mon_detect_af_source_mapping_integrity compares the index with the box, not with af_rule_b(box, text)');
console.log('✓ the mapping-integrity index arm compares with af_rule_b(box, text), the value the index serves');

// ── 3. filter-parity check (6) reads the results RPC's total, not its 5,000-row page (alert 10376) ─────────────
const parity = newestDefining('mon_filter_parity_barrier');
const readsTotal = (c: string) =>
  /select coalesce\(max\(c\.total_count\), 0\) into v_results from public\.location_search_candidates_ar\(/.test(c);
mustCatch('the pre-fix count of returned rows (capped at 5,000)',
  !readsTotal(parity.replace('select coalesce(max(c.total_count), 0) into v_results', 'select count(*) into v_results')));
assert.ok(readsTotal(parity), 'check (6) counts the 5,000-row page instead of the results RPC total_count');
assert.ok(/v_guided is distinct from v_results/.test(parity) && /v_age is distinct from v_results/.test(parity),
  'check (6) no longer compares BOTH count surfaces with the results RPC');
console.log('✓ filter parity compares the guided and age counts with the results RPC total_count');

// ── 4. the sadiqeltajer checker reads the two sources the parser reads, with the parser's two exclusions ───────
const sadiq = newestDefining('sadiqeltajer_af_outside_room_list');
const judgesLikeParser = (c: string) =>
  /regexp_split_to_table\(r\.description/.test(c)
  && /cl !~ 'يلي\|مقابل\|بجوار/.test(c)
  && /'Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm'\) then ''/.test(c)
  && /kitchen and c !~ 'مطبخ' and d !~ 'مطبخ'/.test(c);
mustCatch('neighbour clauses («يليه مواقف») counted as the ad’s own', !judgesLikeParser(sadiq.replace(/cl !~ 'يلي\|مقابل\|بجوار/g, "cl !~ 'zzz")));
mustCatch('a plot’s description allowed to answer', !judgesLikeParser(sadiq.replace(/'Farm'\) then ''/g, "'Farm') then r.description")));
mustCatch('the description no longer required to be silent too', !judgesLikeParser(sadiq.replace(" and d !~ 'مطبخ'", '')));
assert.ok(judgesLikeParser(sadiq), 'sadiqeltajer_af_outside_room_list no longer judges like the parser (room list + built-unit description, minus neighbour clauses)');
console.log('✓ the sadiqeltajer checker judges a yes against the room list and the built unit’s own description clauses');
