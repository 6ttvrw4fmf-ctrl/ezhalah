// P1 SPEED (owner 2026-10-23): the loader's site list must not scan all of search_listings_ar.
//
// loader_active_platforms_ar() (called by loader_strip_platforms_ar() too) ran array_agg(DISTINCT platform)
// over 405k rows on every cold load — 5.8 s measured live on a phone. Migration
// *_loader_platforms_read_the_platform_index.sql answers it with a skip scan over idx_slar_platform
// (~150 index probes, ~20 ms), still live. This file fails if the newest definition goes back to a
// full-table DISTINCT, or if a later migration drops the index the skip scan needs.
//   node --experimental-strip-types scripts/verify-loader-platforms-skip-scan.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const migs = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const DEF = /create\s+or\s+replace\s+function\s+public\.loader_active_platforms_ar\s*\(\s*\)[\s\S]*?as\s+\$function\$([\s\S]*?)\$function\$/i;

function problems(ms: { f: string; s: string }[]): string[] {
  const fail: string[] = [];
  const defs = ms.filter(({ s }) => DEF.test(s));
  const last = defs.at(-1);
  if (!last) return ['no migration defines loader_active_platforms_ar()'];
  const body = DEF.exec(last.s)![1];
  if (/distinct/i.test(body)) fail.push(`${last.f}: loader_active_platforms_ar() is a full-table DISTINCT again`);
  if (!/with\s+recursive/i.test(body) || !/s\.platform\s*>\s*p\.platform\s+order\s+by\s+s\.platform\s+limit\s+1/i.test(body)) fail.push(`${last.f}: not the index skip scan`);
  const made = ms.findIndex(({ s }) => /create\s+index\s+(if\s+not\s+exists\s+)?idx_slar_platform\s+on\s+public\.search_listings_ar\s*\(\s*platform\s*\)/i.test(s));
  if (made < 0) fail.push('idx_slar_platform is never created');
  const dropped = ms.slice(made + 1).find(({ s }) => /drop\s+index\s+(concurrently\s+)?(if\s+exists\s+)?(public\.)?idx_slar_platform\b/i.test(s));
  if (made >= 0 && dropped) fail.push(`${dropped.f} drops idx_slar_platform — the skip scan becomes a full scan`);
  if (!/raise exception 'loader_active_platforms_ar: the skip scan disagrees with the full scan/.test(last.s)) fail.push(`${last.f}: no apply-time proof against the full scan`);
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(migs);
check('loader_active_platforms_ar() reads the platform index (skip scan), proved against the full scan at apply', p.length === 0, p.join('; '));

const last = migs.filter(({ s }) => DEF.test(s)).at(-1)!;
const swap = (s: string) => migs.map((m) => (m.f === last.f ? { f: m.f, s } : m));
mustCatch('the old full-table DISTINCT back', problems(swap(last.s.replace(/with recursive[\s\S]*?from p;/, "select coalesce(array_agg(distinct platform order by platform), '{}'::text[]) from public.search_listings_ar where platform <> '';"))).length > 0);
mustCatch('a later migration dropping idx_slar_platform', problems([...migs, { f: '29990101000000_x.sql', s: 'drop index if exists public.idx_slar_platform;' }]).length > 0);
mustCatch('a later full-scan redefinition', problems([...migs, { f: '29990101000001_y.sql', s: "create or replace function public.loader_active_platforms_ar() returns text[] language sql as $function$ select array_agg(distinct platform) from public.search_listings_ar $function$;" }]).length > 0);
mustCatch('no apply-time proof', problems(swap(last.s.replace('the skip scan disagrees with the full scan', 'x'))).length > 0);

if (failed) { console.error(`\n❌ verify-loader-platforms-skip-scan: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-loader-platforms-skip-scan: the loader site list reads the index, not the table.');
