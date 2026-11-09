// THE HEADLINE TOTAL COUNTS ONLY ADS A USER CAN FIND (owner 2026-11-09: «I noticed that the number sometimes is wrong»).
// loader_scale_stats_ar() feeds the WhatsApp card, the search loader's «نتحقق من N إعلان» and the welcome line. On
// 2026-11-09 it said 463,281 while search could reach 462,476: its view counted rows that are not production_ready
// (almost all with no readable city), which no search returns. Migration 20261109051420 re-pointed it at a view that
// counts production_ready rows only, and proved total = searchable at apply time.
//
// Hermetic: reads the committed SQL only. The SERVED definition is the last committed migration that creates the
// function; the view it reads must be built (in the last migration that creates THAT view) from search_listings_ar
// filtered by production_ready.
import { readdirSync, readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const DIR = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, sql: readFileSync(new URL(f, DIR), 'utf8') }));

const FN = /create\s+or\s+replace\s+function\s+public\.loader_scale_stats_ar\s*\(\s*\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/i;

/** Problems with the served headline total, given the migrations in apply order. */
export function totalProblems(migs: Array<{ f: string; sql: string }>): string[] {
  const fnMig = migs.filter((m) => FN.test(m.sql)).at(-1);
  if (!fnMig) return ['no committed migration creates loader_scale_stats_ar()'];
  const body = (fnMig.sql.match(FN) ?? [])[1] ?? '';
  const view = (body.match(/from\s+public\.(\w+)/i) ?? [])[1];
  if (!view) return [`${fnMig.f}: loader_scale_stats_ar() reads no public view`];
  const VIEW = new RegExp(`create\\s+materialized\\s+view\\s+public\\.${view}\\s+as([\\s\\S]*?);`, 'i');
  const viewMig = migs.filter((m) => VIEW.test(m.sql)).at(-1);
  if (!viewMig) return [`no committed migration creates the view ${view}`];
  const def = (viewMig.sql.match(VIEW) ?? [])[1] ?? '';
  const out: string[] = [];
  if (!/from\s+public\.search_listings_ar\b/i.test(def)) out.push(`${view} does not count search_listings_ar`);
  // The TOP-LEVEL predicate, right after the table: a production_ready inside an aggregate's FILTER (where …) or a
  // comment would leave the count itself unfiltered (CodeRabbit on #11427).
  const viewSql = def.replace(/--[^\n]*/g, '');
  if (!/from\s+public\.search_listings_ar\s+where\s+(?:\(\s*)?production_ready\b/i.test(viewSql)) out.push(`${view} counts rows that are not production_ready (search cannot reach them)`);
  return out;
}

const real = totalProblems(files);
check('the served headline total counts only production_ready rows', real.length === 0);
for (const p of real) console.log(`    ${p}`);

// Mutations: each must be caught.
const last = files.filter((m) => /loader_scale_stats_ready_mv/.test(m.sql)).at(-1);
if (last) {
  const swap = (from: RegExp, to: string) => files.map((m) => (m === last ? { f: m.f, sql: m.sql.replace(from, to) } : m));
  mustCatch('the production_ready filter dropped', totalProblems(swap(/\n\s*where production_ready;/, ';')).length > 0);
  mustCatch('the function pointed back at the old every-row view',
    totalProblems(swap(/from public\.loader_scale_stats_ready_mv;\n\$function\$/, 'from public.loader_scale_stats_total_mv;\n$function$')).length > 0);
  mustCatch('production_ready moved into an aggregate filter, the count left unfiltered',
    totalProblems(swap(/filter \(where district_ar is not null and district_ar <> ''\)\)::integer as district_count\n  from public\.search_listings_ar\n  where production_ready;/,
      "filter (where production_ready and district_ar is not null and district_ar <> ''))::integer as district_count\n  from public.search_listings_ar;")).length > 0);
  mustCatch('production_ready kept only in a comment',
    totalProblems(swap(/\n\s*where production_ready;/, '\n  -- where production_ready\n;')).length > 0);
  mustCatch('the view counting another table', totalProblems(swap(/from public\.search_listings_ar\n/, 'from public.some_other_table\n')).length > 0);
} else {
  check('the migration that built loader_scale_stats_ready_mv is committed', false);
}

if (failed) { console.error(`\n❌ verify-headline-total-counts-only-searchable: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-headline-total-counts-only-searchable: the headline total is what search can find');
