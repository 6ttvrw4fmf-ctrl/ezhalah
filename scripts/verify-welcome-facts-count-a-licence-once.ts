// THE WELCOME FACTS COUNT ONE PROPERTY ONCE, BY ITS REGA LICENCE (owner 2026-11-08: «look for duplicates in the fact,
// don't show it or count it. But for the search, count it, it's fine»). Measured 2026-11-08: 57,900 licences appeared on
// more than one served row (84,805 extra copies) and every count fact counted each copy — الخفجي said 72 land ads for
// 51 properties. The rule lives in ONE helper (welcome_fold_licence_twins: same licence + city + type + deal, licences
// the set carries ≤ 5 times, first copy kept) that the builder AND the independent recount call on their base sets, and
// the customer-search check compares «search ≥ fact», repairs a fact only DOWN and ranks the top district on the same
// de-duplicated set. Hermetic: reads the committed SQL; the migration proves the fold against a hand-made set on apply.
import { readdirSync, readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const DIR = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, s: readFileSync(new URL(f, DIR), 'utf8') }));

/** The helper's delete: licence key with city, type and deal; a cap on how often the set carries the licence; first copy kept. */
export function foldsLicenceTwins(src: string): boolean {
  const key = /x\.license_number = l\.license_number and y\.license_number = l\.license_number/.test(src)
    && /x\.city_id = y\.city_id and x\.type_ar = y\.type_ar and x\.deal_ar = y\.deal_ar/.test(src);
  const cap = /where license_number ~ '\^\[0-9\]\{6,\}\$'\s*group by 1 having count\(\*\) <= %2\$s/.test(src);
  const keepFirst = /\(x\.platform, x\.listing_id::text\) > \(y\.platform, y\.listing_id::text\)/.test(src);
  const defaultCap = /p_max integer default 5\b/.test(src);
  return key && cap && keepFirst && defaultCap;
}
/** The check never lifts a fact to the search, requires search ≥ fact, and ranks districts on the de-duplicated set. */
export function checksAfterDedup(src: string): boolean {
  return /if c < r\.a then update public\.welcome_insight set a = c/.test(src)
    && /welcome_unique_district_counts\(r\.city_ar, k\.repro_deal, k\.repro_types\)/.test(src)
    && /array\[t1d\], k\.repro_types\) < t1n then ok := false;/.test(src);
}

const helperDefs = files.filter(({ s }) => /create or replace function public\.welcome_fold_licence_twins\s*\(/i.test(s));
const helper = helperDefs.at(-1);
check(`the served fold helper (${helper?.f ?? 'none'}) keys on licence + city + type + deal, caps at 5, keeps the first copy`, !!helper && foldsLicenceTwins(helper.s));

// the call lands inside an E'…' string in the in-place edit, so the committed text carries doubled quotes
const B = /perform public\.welcome_fold_licence_twins\(''?w_b''?\);/, A = /perform public\.welcome_fold_licence_twins\(''?a_b''?\);/;
const builderLast = files.filter(({ s }) => /create or replace function public\.build_welcome_insights\s*\(/i.test(s) || B.test(s)).at(-1);
const auditLast = files.filter(({ s }) => /create or replace function public\.audit_welcome_insights\s*\(/i.test(s) || A.test(s)).at(-1);
const verifyLast = files.filter(({ s }) => /create or replace function public\.verify_welcome_insights\s*\(/i.test(s) || /if c (<|<>) r\.a then update public\.welcome_insight set a = c/.test(s)).at(-1);
check(`the builder's governing migration (${builderLast?.f ?? 'none'}) folds licence twins on w_b`, !!builderLast && B.test(builderLast.s));
check(`the recount's governing migration (${auditLast?.f ?? 'none'}) folds licence twins on a_b`, !!auditLast && A.test(auditLast.s));
check(`the check's governing migration (${verifyLast?.f ?? 'none'}) compares search ≥ fact and ranks districts de-duplicated`, !!verifyLast && checksAfterDedup(verifyLast.s));
const rule = files.find(({ s }) => B.test(s) && A.test(s));
check(`the migration that made the rule (${rule?.f ?? 'none'}) proves the fold on a hand-made set at apply time`,
  !!rule && /PROOF: licence fold expected 18 → 16 rows/.test(rule.s) && /a 6-copy broker number was folded/.test(rule.s));

if (helper) {
  mustCatch('cap removed (a broker number on 233 ads folded to one)', !foldsLicenceTwins(helper.s.replace("group by 1 having count(*) <= %2$s", 'group by 1')));
  mustCatch('deal dropped from the key (a sale and its rent twin folded)', !foldsLicenceTwins(helper.s.replace(' and x.deal_ar = y.deal_ar', '')));
  mustCatch('city dropped from the key (a namesake in another city folded)', !foldsLicenceTwins(helper.s.replace('x.city_id = y.city_id and ', '')));
  mustCatch('default cap changed', !foldsLicenceTwins(helper.s.replace('p_max integer default 5', 'p_max integer default 50')));
}
if (verifyLast) {
  mustCatch('the check lifting a fact back up to the search count', !checksAfterDedup(verifyLast.s.replaceAll('if c < r.a then update public.welcome_insight set a = c', 'if c <> r.a then update public.welcome_insight set a = c')));
  mustCatch('the top district ranked on raw copies again', !checksAfterDedup(verifyLast.s.replace('welcome_unique_district_counts(r.city_ar, k.repro_deal, k.repro_types)', 'public.search_listings_ar s')));
}

if (failed) { console.error(`\n❌ verify-welcome-facts-count-a-licence-once: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-facts-count-a-licence-once: one licence, one property, in every welcome fact; the search keeps its copies.');
