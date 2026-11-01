// SECURITY (owner-approved plan, Phase 1.3, 2026-10-20): internal views are not readable with the publishable key.
//
// THE HOLE. 39 views were SELECT-able by anon; none is security_invoker, so each ran with its owner's rights and
// bypassed row security on what it reads: ops dashboards, the engineer alert queue, scraper heartbeat, crawl stats,
// AI costs, liveness outcomes — competitor intel for anyone with the key. Migration
// *_internal_views_are_not_a_public_api.sql revokes 34 of them from anon/authenticated (service_role keeps SELECT).
// Kept public on purpose: the four location views the app reads, and ops_platform_liveness_coverage (a live check
// reads it with the public key). Measured live after apply: the public key gets 401 on monitoring_dashboard,
// ai_usage_costed, scraper_heartbeat and ops_engineer_alert_queue; a real Riyadh Filter search still shows cards.
//   node --experimental-strip-types scripts/verify-internal-views-are-not-public.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_internal_views_are_not_a_public_api\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_internal_views_are_not_a_public_api.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

const MUST_HIDE = ['ai_usage_costed', 'monitoring_dashboard', 'ops_engineer_alert_queue', 'ops_active_claims', 'scraper_heartbeat',
  'crawl_stats_daily', 'crawl_stats_platform_daily', 'ops_aqar_recent_kills', 'ops_dealapp_liveness_outcomes', 'ops_freshness_by_layer'];
const APP_NEEDS = ['listing_location_canonical_mv', 'listing_location_index', 'location_index', 'location_index_live'];

function problems(s: string, app: string): string[] {
  const fail: string[] = [];
  const listed = [...s.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  for (const v of MUST_HIDE) if (!listed.includes(v)) fail.push(`${v} is no longer hidden from the public key`);
  for (const v of APP_NEEDS) if (listed.includes(v)) fail.push(`${v} is hidden but the app reads it (search would break)`);
  if (!/execute format\('revoke all on public\.%I from anon, authenticated', v\);/.test(s)) fail.push('the revoke no longer covers anon AND authenticated');
  // Anything the app reads with .from('<view>') must not be on the hidden list.
  for (const m of app.matchAll(/\.from\(['"`]([a-z0-9_]+)['"`]\)/g)) if (listed.includes(m[1])) fail.push(`app reads ${m[1]} but it is hidden`);
  return fail;
}

const appSrc = ['src/data/locations.ts', 'src/data/remote.ts', 'src/data/adPageData.ts']
  .map((f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } }).join('\n');

// EVERY public-key reader, not just three app files (2026-10-21). scripts/verify-all-platforms-have-extra-attrs-branch-live.ts
// read listing_extra_attrs_mv with the publishable key, and this barrier, which only looked at src/data, stayed green
// while that live check started answering 401. Now: all of src/, plus every script that talks to production with the
// public key (public-supabase / resolvePublicSupabase / postgrestFetch). A quoted hidden-view name in one of them is RED.
const walk = (d: string): string[] => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [join(d, e.name).replace(/\\/g, '/')] : []);
const publicReaders: [string, string][] = [...walk('src'), ...walk('scripts').filter((f) => !f.endsWith('verify-internal-views-are-not-public.ts'))]
  .map((f): [string, string] => [f, readFileSync(join(root, f), 'utf8')])
  .filter(([f, s]) => f.startsWith('src') || /public-supabase|resolvePublicSupabase|postgrestFetch/.test(s));
function readerProblems(s: string, readers: [string, string][]): string[] {
  const listed = [...s.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const fail: string[] = [];
  for (const [f, src] of readers) for (const v of listed) {
    if (new RegExp(`['"\`/]${v}['"\`?]`).test(src)) fail.push(`${f} reads ${v} with the public key, but it is hidden`);
  }
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(sql, appSrc);
check('internal ops/cost/crawl views are hidden from the public key; the app\'s location views stay readable', p.length === 0, p.join('; '));
mustCatch('the AI-cost view made public again', problems(sql.replace("'ai_usage_costed',", ''), appSrc).length > 0);
mustCatch('hiding a view the app reads (location_index_live)', problems(sql.replace("'scraper_heartbeat'", "'scraper_heartbeat', 'location_index_live'"), appSrc).length > 0);
const rp = readerProblems(sql, publicReaders);
check(`no public-key reader (${publicReaders.length} files in src/ and scripts/) reads a hidden view`, rp.length === 0, rp.join('; '));
mustCatch('a live check reading a hidden view with the public key',
  readerProblems(sql, [['scripts/x-live.ts', 'await fetch(`${REST}/listing_extra_attrs_mv?select=listing_id`)']]).length > 0);
mustCatch('a revoke that forgets signed-in users', problems(sql.replace('from anon, authenticated', 'from anon'), appSrc).length > 0);

if (failed) { console.error(`\n❌ verify-internal-views-are-not-public: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-internal-views-are-not-public: internal views are not a public API.');
