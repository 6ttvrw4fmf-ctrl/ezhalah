// HEADLINE FACTS COUNT EVERY SITE, AND A PROPERTY ON SEVERAL SITES ONCE (owner 2026-10-28: «it must be all, not just 1 …
// duplicates in the facts are considered 1»). Migration 20261028205944 adds mon_detect_welcome_facts_all_sites_once (P1,
// on the detector roster), which checks the LIVE builder and recount on every sweep: both de-duplicate across sites,
// neither narrows its base to some sites, and no count fact exceeds what is listed in its city. This pins the committed
// SQL so the guard cannot be quietly weakened.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /_short_welcome_lines_say_what_the_number_is\.sql$/.test(f)).sort().at(-1);
let fail = 0;
const check = (label: string, ok: boolean) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
check('the migration carrying the all-sites-once guard is committed', !!file);
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

const dedupe = (s: string) => s.includes("position('delete from w_b x using w_b y' in b) = 0 or position('x.platform <> y.platform' in b) = 0")
  && s.includes("position('delete from a_b x where exists' in a) = 0 or position('y.platform <> x.platform' in a) = 0");
check('it checks BOTH the builder and the recount count a property on several sites once', dedupe(sql));
mustCatch('the recount de-duplication check dropped', !dedupe(sql.replace("position('y.platform <> x.platform' in a) = 0", 'false')));

const allSites = (s: string) => (s.match(/position\('s\.production_ready' in seg\) = 0/g) ?? []).length === 2
  && s.includes("seg ~* 'platform\\s*(in\\s*\\(|=\\s*''|=\\s*any)'") && s.includes("seg ~* 's\\.platform\\s*(in\\s*\\(|=\\s*''|=\\s*any)'");
check('it checks both read every production-ready site, with no list of sites narrowing the base', allSites(sql));
mustCatch('the narrowing check removed from one reader', !allSites(sql.replace("seg ~* 's\\.platform\\s*(in\\s*\\(|=\\s*''|=\\s*any)'", 'false')));

const neverAbove = (s: string) => s.includes("w.kind in ('city_sale', 'city_land', 'city_bld_sale')")
  && s.includes('w.a::numeric > (select count(*) from public.search_listings_ar s where s.production_ready and s.city_ar = w.city_ar)');
check('it checks no count fact is larger than everything listed in its city', neverAbove(sql));
mustCatch('the count ceiling dropped', !neverAbove(sql.replace('w.a::numeric > (select count(*)', 'w.a::numeric > 1e12 + (select count(*)')));

const alarm = (s: string) => s.includes("public.mon_raise('P1', 'welcome_facts_all_sites_once'")
  && s.includes("'''mon_detect_welcome_facts_all_sites_once'', ' || anchor");
check('it raises a P1 and is on the detector roster (a detector off the roster is decoration)', alarm(sql));
mustCatch('the guard left off the roster', !alarm(sql.replace("'''mon_detect_welcome_facts_all_sites_once'', ' || anchor", 'anchor')));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ welcome-facts-all-sites-once: every site counted, a property on several sites counted once');
