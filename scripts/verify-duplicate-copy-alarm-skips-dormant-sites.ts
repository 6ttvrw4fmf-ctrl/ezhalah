// lifecycle_duplicate_stale_copy SKIPS DORMANT SITES, like every other liveness alarm (♻️ 2026-11-05).
//
// A dormant site (platform_registry.status = 'dormant') is down at its own end and none of its rows is
// served, so the alert's premise — «the other copy is active and still returned by search» — is false
// for it, and nothing can close its key: lifecycle_duplicate_stale_copy:sadin stood open from
// 2026-09-06 to 2026-11-05. Migration 20261105114710 added `where not ops_platform_is_dormant(...)` to
// the detector's loop (a needle edit, so the full body lives only in production; this reads the newest
// committed migration that touches the detector, executed text only, comments stripped).
//
//   node --experimental-strip-types scripts/verify-duplicate-copy-alarm-skips-dormant-sites.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const FN = 'mon_detect_lifecycle_duplicate_stale_copy';
const strip = (s: string) => s.replace(/^\s*--.*$/gm, '');
// A migration that DEFINES the detector (full body) or PATCHES it (needle edit on its own definition);
// a roster entry or a mere mention is not a change to its loop.
const CHANGES = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${'mon_detect_lifecycle_duplicate_stale_copy'}\b|pg_get_functiondef\(\s*'public\.${'mon_detect_lifecycle_duplicate_stale_copy'}\b`, 'i');

export function problems(files: Record<string, string>): string[] {
  const touching = Object.keys(files).filter((f) => CHANGES.test(strip(files[f]))).sort();
  if (touching.length === 0) return [`no committed migration touches public.${FN}`];
  const latest = touching[touching.length - 1];
  const sql = strip(files[latest]);
  const out: string[] = [];
  if (!/where\s+not\s+public\.ops_platform_is_dormant\(\s*d\.platform\s*\)/i.test(sql)) {
    out.push(`${latest}: the newest change to ${FN} does not skip dormant platforms in its loop`);
  }
  if (!/ops_lifecycle_duplicate_stale_copy\(\)\s+d/i.test(sql)) {
    out.push(`${latest}: the dormant skip is not attached to the ops_lifecycle_duplicate_stale_copy() loop`);
  }
  return out;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const files: Record<string, string> = {};
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) files[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
const real = problems(files);
check(`${FN} skips dormant sites`, real.length === 0, real.join('; '));
const latest = Object.keys(files).filter((f) => CHANGES.test(strip(files[f]))).sort().pop()!;
mustCatch('the skip removed',
  problems({ ...files, [latest]: files[latest].replace(/\n\s*where not public\.ops_platform_is_dormant\(d\.platform\)/, '') }).length > 0);
mustCatch('a newer change without the skip, judged instead of the old one',
  problems({ ...files, '29990101000000_x.sql': `create or replace function public.${FN}() returns int language sql as $$ select 1 $$;` }).length > 0);

if (failed) { console.log(`\n❌ verify-duplicate-copy-alarm-skips-dormant-sites: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-duplicate-copy-alarm-skips-dormant-sites');
