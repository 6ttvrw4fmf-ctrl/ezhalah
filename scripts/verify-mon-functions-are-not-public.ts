// SECURITY: no public.mon_* function is callable with the key that ships in the web bundle (owner P1, 2026-10-18).
//
// THE HOLE. 346 of 378 mon_* functions were EXECUTE-able by anon/authenticated/PUBLIC (Supabase's default privileges grant
// every new public function to both): anyone could POST /rest/v1/rpc/mon_raise to spam alert_event, or loop
// mon_run_all_detectors / mon_detect_card_label_contract to load the database.
//
// THE RULE (migration *_mon_functions_are_not_a_public_api.sql): REVOKE EXECUTE from PUBLIC, anon, authenticated on every
// public.mon_* (service_role + postgres keep it), an event trigger revokes the same from every NEW mon_* at CREATE
// FUNCTION, and exactly four read-only checks stay anon-callable because public-key CI calls them (pinned below).
//
// This barrier reads the committed SQL; each loosening below must turn it red. The live half is the apply-time proof in
// the migration itself (0 leaked, a probe function born revoked) and the anon POST that answers 401.
//   node --experimental-strip-types scripts/verify-mon-functions-are-not-public.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const file = files.filter((f) => /_mon_functions_are_not_a_public_api\.sql$/.test(f)).at(-1);
if (!file) { console.log('FAIL  migration *_mon_functions_are_not_a_public_api.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const later = files.filter((f) => f > file).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

// The ONLY mon_* functions anon may call — each read-only, STABLE, SECURITY DEFINER, called with the public key by CI.
// Adding one here is a security decision: say which caller needs it and why it cannot use the service key.
const ALLOWED = [
  'public.mon_orphaned_detectors(text[])',                    // verify-orphaned-detector-meta-check.ts (required npm test, no secrets)
  'public.mon_oracle_never_retires(integer)',                 // verify-oracle-never-retires-live.ts
  'public.mon_oracle_retirement_facts()',                     // verify-oracle-never-retires-live.ts
  'public.mon_detectors_outside_raise_candidate_set(jsonb)',  // verify-detector-candidate-set-is-not-blind-live.ts
];
const OPENERS = /grant\s+(execute|all)[^;]*on\s+(function|all\s+functions)[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/gi;

function problems(s: string, rest: ReadonlyArray<readonly [string, string]>): string[] {
  const fail: string[] = [];
  const allow = s.match(/create or replace function public\.mon_anon_readable\(\) returns regprocedure\[\][\s\S]*?select array\[([\s\S]*?)\]::regprocedure\[\]/);
  const listed = allow ? [...allow[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  if (!allow) fail.push('the anon allowlist function mon_anon_readable() is missing');
  else if (listed.length !== ALLOWED.length || listed.some((x) => !ALLOWED.includes(x))) fail.push(`the anon allowlist changed: [${listed.join(', ')}] ≠ the four pinned read-only checks`);
  const loop = /for f in select p\.oid::regprocedure from pg_proc p\s+where p\.pronamespace = 'public'::regnamespace and p\.proname like 'mon\\_%' loop\s+execute format\('revoke execute on function %s from public, anon, authenticated', f\);\s+execute format\('grant execute on function %s to service_role, postgres', f\);/.test(s);
  if (!loop) fail.push('the revoke over EVERY existing public.mon_* (from public, anon, authenticated; service_role + postgres kept) is missing or narrowed');
  const born = /p\.proname like 'mon\\_%'\s+and not \(c\.objid::regprocedure = any \(public\.mon_anon_readable\(\)\)\) loop\s+execute format\('revoke execute on function %s from public, anon, authenticated', r\.objid::regprocedure\);/.test(s);
  if (!born) fail.push('the event-trigger function no longer revokes public/anon/authenticated from a NEW mon_* (or skips more than the allowlist)');
  if (!/create event trigger mon_functions_born_revoked on ddl_command_end\s+when tag in \('CREATE FUNCTION', 'CREATE PROCEDURE'\)\s+execute function public\.mon_functions_born_revoked\(\);/.test(s)) fail.push('the event trigger no longer fires on CREATE FUNCTION');
  if (!/if leaked is not null then raise exception/.test(s) || !/mon_zz_born_revoked_probe/.test(s)) fail.push('the apply-time proof (0 leaked; a new mon_* is born revoked) is missing');
  for (const [f, body] of rest) {
    for (const m of body.matchAll(OPENERS)) {
      if (/\bmon_/.test(m[0]) || /all\s+functions/i.test(m[0])) fail.push(`${f} re-opens EXECUTE to anon/authenticated/PUBLIC: «${m[0].slice(0, 120)}»`);
    }
    if (/alter\s+default\s+privileges[^;]*grant[^;]*on\s+functions[^;]*\b(anon|authenticated)\b/i.test(body)) fail.push(`${f} widens default function privileges to anon/authenticated`);
    if (/drop\s+event\s+trigger[^;]*mon_functions_born_revoked/i.test(body) && !/create event trigger mon_functions_born_revoked/.test(body)) fail.push(`${f} drops the born-revoked event trigger`);
  }
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql, later);
check(`committed ${file} (+ ${later.length} later migrations) keep mon_* off the public key`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string, ReadonlyArray<readonly [string, string]>?]> = [
  ['anon left out of the revoke', (s) => s.replace("'revoke execute on function %s from public, anon, authenticated', f)", "'revoke execute on function %s from public, authenticated', f)")],
  ['mon_raise added to the anon allowlist', (s) => s.replace("'public.mon_oracle_retirement_facts()',", "'public.mon_oracle_retirement_facts()', 'public.mon_raise(text,text,text,text,jsonb)',")],
  ['service_role loses EXECUTE (job 38 / workflows break)', (s) => s.replace("'grant execute on function %s to service_role, postgres', f)", "'grant execute on function %s to postgres', f)")],
  ['event trigger no longer fires on CREATE FUNCTION', (s) => s.replace("when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')", "when tag in ('CREATE PROCEDURE')")],
  ['new mon_* functions keep authenticated', (s) => s.replace("'revoke execute on function %s from public, anon, authenticated', r.objid::regprocedure)", "'revoke execute on function %s from public, anon', r.objid::regprocedure)")],
  ['apply-time proof removed', (s) => s.replace(/-- APPLY-TIME PROOF[\s\S]*$/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m, later).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
mustCatch('a later migration grants mon_raise back to anon',
  problems(sql, [...later, ['29991231000000_oops.sql', 'grant execute on function public.mon_raise(text,text,text,text,jsonb) to anon;']]).length > 0);
mustCatch('a later migration widens default function privileges to anon',
  problems(sql, [...later, ['29991231000001_oops.sql', 'alter default privileges in schema public grant execute on functions to anon;']]).length > 0);
console.log(failed === 0 ? 'OK: no mon_* function is callable with the public key beyond the four pinned read-only checks' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
