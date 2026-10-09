// photo_sync_stale MUST JUDGE THE CHAIN BY THE TABLES IT REFRESHES, NEVER BY A FROZEN ROW (falcon, 2026-10-09).
//
// refresh_photo_capture_trust() upserts one ops_photo_capture_trust row per `distinct source_table
// from search_listings_ar`. A table that LEAVES the index keeps its last row forever. From 2026-09-26
// to 2026-10-09 the detector took min(checked_at) over the WHOLE table, so one frozen row
// (expattrusted_commercial_listings, checked 09-24, 0 rows served) read as "jobid 28 stopped
// refreshing" on every sweep — a standing P2 owned by a deleted routine, while 245 live tables were
// refreshed hourly. The repair scopes both aggregates to tables that hold rows in search_listings_ar.
//
// This pins the SHAPE of the deployed detector in the migration that carries it: both aggregates
// carry the index-scoped EXISTS, and no unscoped aggregate over ops_photo_capture_trust remains.
// Mutations below prove each clause is load-bearing.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const file = readdirSync(dir).filter(f => /_photo_sync_stale_judges_live_tables_not_a_frozen_row\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('  FAIL  the photo_sync_stale repair migration is missing from supabase/migrations'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

const SCOPE = /exists\s*\(\s*select\s+1\s+from\s+public\.search_listings_ar\s+s\s+where\s+s\.source_table\s*=\s*t\.source_table\s*\)/g;

export function problems(text: string): string[] {
  const out: string[] = [];
  const m = text.match(/create or replace function public\.mon_detect_photo_sync_stale\(\)[\s\S]*?\$function\$;/i);
  if (!m) return ['mon_detect_photo_sync_stale() is not (re)defined in the migration'];
  const body = m[0];
  const stalest = body.match(/select\s+min\(t\.checked_at\)\s+into\s+stalest[\s\S]*?;/i)?.[0] ?? '';
  const trusted = body.match(/select\s+count\(\*\)\s+into\s+trusted_ct[\s\S]*?;/i)?.[0] ?? '';
  if (!stalest) out.push('the stalest aggregate is missing');
  else if (!SCOPE.test(stalest)) out.push('the stalest aggregate is not scoped to tables present in search_listings_ar');
  SCOPE.lastIndex = 0;
  if (!trusted) out.push('the trusted_ct aggregate is missing');
  else if (!SCOPE.test(trusted)) out.push('the trusted_ct aggregate is not scoped to tables present in search_listings_ar');
  SCOPE.lastIndex = 0;
  if (!/where t\.trusted\s+and\s+exists/i.test(trusted)) out.push('trusted_ct must still count only trusted rows');
  if (/select\s+min\(checked_at\)\s+into\s+stalest\s+from\s+public\.ops_photo_capture_trust\s*;/i.test(body))
    out.push('the old unscoped min(checked_at) over the whole table is back');
  if (!/interval '36 hours'/.test(body)) out.push('the 36h staleness bar moved');
  if (!/mon_resolve_key\('photo_sync_stale', 'photo_sync_stale'\)/.test(body)) out.push('the detector no longer self-heals the alert');
  if (!/mon_raise\('P2', 'photo_sync_stale'/.test(body)) out.push('a real stall no longer raises photo_sync_stale');
  return out;
}

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

const real = problems(sql);
check(real.length === 0, `${file}: both aggregates are scoped to the served index`, real.join('; '));

const mutations: Array<[string, (s: string) => string]> = [
  ['stalest loses its index scope', s => s.replace(/select min\(t\.checked_at\) into stalest[\s\S]*?;/, 'select min(t.checked_at) into stalest from public.ops_photo_capture_trust t;')],
  ['stalest reverts to the old whole-table aggregate', s => s.replace(/select min\(t\.checked_at\) into stalest[\s\S]*?;/, 'select min(checked_at) into stalest from public.ops_photo_capture_trust;')],
  ['trusted_ct loses its index scope', s => s.replace(/select count\(\*\) into trusted_ct[\s\S]*?;/, 'select count(*) into trusted_ct from public.ops_photo_capture_trust t where t.trusted;')],
  ['trusted_ct stops requiring trusted', s => s.replace('where t.trusted\n     and exists', 'where exists')],
  ['the staleness bar is loosened', s => s.replace("interval '36 hours'", "interval '360 hours'")],
  ['the self-heal is removed', s => s.replace("perform public.mon_resolve_key('photo_sync_stale', 'photo_sync_stale');", 'null;')],
  ['the raise is removed', s => s.replace("n := public.mon_raise('P2', 'photo_sync_stale'", "n := 0; perform ('P2', 'x'")],
];
for (const [name, mutate] of mutations) {
  const mutated = mutate(sql);
  check(mutated !== sql, `mutation applies: ${name}`);
  check(problems(mutated).length > 0, `mutation caught: ${name}`);
}

if (failed) { console.log(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ photo_sync_stale judges the chain by the tables it refreshes, and every clause is load-bearing');
