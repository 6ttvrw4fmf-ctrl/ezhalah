// SECURITY: no public.mon_* view is readable, and no view at all is writable, with the key that ships in the web bundle
// (owner P1, 2026-10-18 — the second half of verify-mon-functions-are-not-public.ts).
//
// THE HOLE. All 26 mon_* views were SELECT/INSERT/UPDATE/DELETE-able by anon, authenticated and PUBLIC, read AS THEIR
// OWNER past RLS, and three were auto-updatable over live data (mon_price_size_integrity_review → search_listings_ar):
// the publishable key could PATCH served listings. Six non-mon views had the same write-through shape.
//
// THE RULE (migration *_mon_views_are_not_a_public_api.sql): every mon_* view / matview: REVOKE ALL from PUBLIC, anon,
// authenticated, service_role keeps SELECT; every other view: REVOKE INSERT, UPDATE, DELETE, TRUNCATE from the same three;
// an event trigger does both at CREATE VIEW / CREATE MATERIALIZED VIEW. No mon_* view stays on the public key (the one
// public-key reader, verify-district-source-truth-live.ts, uses the service key).
//   node --experimental-strip-types scripts/verify-mon-views-are-not-public.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const file = files.filter((f) => /_mon_views_are_not_a_public_api\.sql$/.test(f)).at(-1);
if (!file) { console.log('FAIL  migration *_mon_views_are_not_a_public_api.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const later = files.filter((f) => f > file).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
const liveReader = readFileSync(join(root, 'scripts', 'verify-district-source-truth-live.ts'), 'utf8');

const BRANCH = /if r\.relname like 'mon\\_%' then\s+execute format\('revoke all on table public\.%I from public, anon, authenticated', r\.relname\);\s+execute format\('grant select on table public\.%I to service_role', r\.relname\);\s+elsif r\.relkind = 'v' then\s+execute format\('revoke insert, update, delete, truncate on table public\.%I from public, anon, authenticated', r\.relname\);/g;
const OPENERS = /grant\s+[^;]*\bon\s+(table\s+)?(public\.)?(mon_[a-z0-9_]+|all\s+tables)[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/gi;

function problems(s: string, rest: ReadonlyArray<readonly [string, string]>, reader: string): string[] {
  const fail: string[] = [];
  const branches = s.match(BRANCH) ?? [];
  if (branches.length !== 2) fail.push(`both the existing-view loop and the event trigger must revoke ALL on mon_* (service_role keeps SELECT) and writes on every other view (found ${branches.length} of 2)`);
  if (!/for r in select c\.relname, c\.relkind from pg_class c\s+where c\.relnamespace = 'public'::regnamespace and c\.relkind in \('v', 'm'\) loop/.test(s)) fail.push('the revoke no longer walks EVERY public view and materialized view');
  if (!/create event trigger mon_views_born_revoked on ddl_command_end\s+when tag in \('CREATE VIEW', 'CREATE MATERIALIZED VIEW'\)\s+execute function public\.mon_views_born_revoked\(\);/.test(s)) fail.push('the event trigger no longer fires on CREATE VIEW and CREATE MATERIALIZED VIEW');
  if (!/if leaked is not null then raise exception/.test(s) || !/if writable is not null then raise exception/.test(s) || !/mon_zz_born_revoked_probe/.test(s)) fail.push('the apply-time proof (0 readable mon_* views, 0 writable views, new views born revoked) is missing');
  if (/resolvePublicSupabase\(\);?\s*$/m.test(reader) && /key:\s*KEY\s*\}\s*=\s*resolvePublicSupabase/.test(reader)) fail.push('verify-district-source-truth-live.ts reads mon_* views with the public key again');
  if (!/const KEY = process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(reader)) fail.push('verify-district-source-truth-live.ts no longer uses the service key for the mon_* views');
  rest.forEach(([f, body], idx) => {
    for (const m of body.matchAll(OPENERS)) fail.push(`${f} re-opens a mon_* view to the public key: «${m[0].slice(0, 120)}»`);
    if (/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+(table\s+)?[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(body) && /create (or replace )?view/i.test(body)) {
      // An applied migration cannot be rewritten (content parity), so such a slip is closed only by a LATER migration
      // that revokes the writes on that same view from anon AND authenticated (20261022230940 → *_rich_attrs_read_only).
      const views = [...body.matchAll(/grant\s+[^;']*?\b(?:insert|update|delete|all)\b[^;']*?\bon\s+(?:table\s+)?(?:public\.)?(\w+)[^;']*?\bto\b[^;']*\b(?:anon|authenticated)\b/gi)].map((m) => m[1]);
      const closed = (v: string) => rest.slice(idx + 1).some(([, b]) =>
        new RegExp(String.raw`revoke\s+insert,\s*update,\s*delete[^;]*\bon\s+(?:table\s+)?(?:public\.)?${v}\b[^;]*\bfrom\b[^;]*\banon\b[^;]*\bauthenticated\b`, 'i').test(b));
      if (!views.length || !views.every(closed)) fail.push(`${f} grants writes to the public key in a migration that defines a view — check it is not a view`);
    }
    if (/drop\s+event\s+trigger[^;]*mon_views_born_revoked/i.test(body) && !/create event trigger mon_views_born_revoked/.test(body)) fail.push(`${f} drops the born-revoked view trigger`);
  });
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql, later, liveReader);
check(`committed ${file} (+ ${later.length} later migrations) keep mon_* views off the public key and every view read-only`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['anon left out of the mon_* revoke', (s) => s.replaceAll("'revoke all on table public.%I from public, anon, authenticated'", "'revoke all on table public.%I from public, authenticated'")],
  ['only SELECT revoked (write-through stays)', (s) => s.replace("execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);\n      execute format('grant select on table public.%I to service_role', r.relname);\n    elsif r.relkind = 'v' then\n      execute format('revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated', r.relname);\n    end if;\n  end loop;\nend\n$revoke$", "execute format('revoke select on table public.%I from public, anon, authenticated', r.relname);\n      execute format('grant select on table public.%I to service_role', r.relname);\n    elsif r.relkind = 'v' then\n      execute format('revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated', r.relname);\n    end if;\n  end loop;\nend\n$revoke$")],
  ['non-mon views keep their write grants', (s) => s.replaceAll("'revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated'", "'revoke truncate on table public.%I from public'")],
  ['service_role loses SELECT', (s) => s.replaceAll("'grant select on table public.%I to service_role'", "'grant select on table public.%I to postgres'")],
  ['materialized views skipped', (s) => s.replace("where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') loop", "where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' loop")],
  ['event trigger ignores CREATE VIEW', (s) => s.replace("when tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW')", "when tag in ('CREATE MATERIALIZED VIEW')")],
  ['apply-time proof removed', (s) => s.replace(/-- APPLY-TIME PROOF[\s\S]*$/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m, later, liveReader).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
{
  const grantsView = ['29991231000001_view.sql', "create or replace view public.v_x as select 1; grant all on public.v_x to anon, authenticated;"] as const;
  mustCatch('a view migration that grants writes to the public key and is never revoked',
    problems(sql, [...later, grantsView], liveReader).length > 0);
  mustCatch('a later revoke that leaves out authenticated does not close the grant',
    problems(sql, [...later, grantsView, ['29991231000002_half.sql', 'revoke insert, update, delete, truncate on table public.v_x from public, anon;']], liveReader).length > 0);
  check('a view grant closed by a later revoke from anon AND authenticated is accepted',
    problems(sql, [...later, grantsView, ['29991231000002_fix.sql', 'revoke insert, update, delete, truncate on table public.v_x from public, anon, authenticated;']], liveReader).length === 0);
}
mustCatch('a later migration grants a mon_* view back to anon',
  problems(sql, [...later, ['29991231000000_oops.sql', 'grant select on public.mon_searchability_alerts to anon;']], liveReader).length > 0);
mustCatch('the live district check goes back to the public key',
  problems(sql, later, liveReader.replace(/const KEY = process\.env\.SUPABASE_SERVICE_ROLE_KEY \|\| '';/, "const KEY = resolvePublicSupabase().key;")).length > 0);
console.log(failed === 0 ? 'OK: no mon_* view is readable and no view is writable with the public key' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
