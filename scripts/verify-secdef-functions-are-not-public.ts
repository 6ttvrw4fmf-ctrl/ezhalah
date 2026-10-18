// SECURITY: a SECURITY DEFINER function in public is callable with the publishable key only if an explicit, reasoned
// allowlist says so (owner P1, 2026-10-18).
//
// THE HOLE. 45 SECURITY DEFINER + VOLATILE functions were EXECUTE-able by anon/authenticated/PUBLIC and ran as their
// owner: anyone could reset the AI spend breaker (ai_spend_reset — unlimited cost), take or drop the deploy lock, flip
// listing lifecycle, claim work areas, promote alerts, run the sync/resolve/remediate writers.
//
// THE RULE (migration *_secdef_functions_are_not_a_public_api.sql): public.ops_public_secdef_allowlist (name, roles,
// reason ≥ 20 chars) is the only door; every SECURITY DEFINER function gets exactly its listed roles and none otherwise;
// event trigger ops_secdef_born_revoked does the same at CREATE FUNCTION / CREATE PROCEDURE / ALTER FUNCTION. Of the 45,
// three survive — each validated and rate-capped. This barrier reads the committed SQL; each loosening must turn it red.
//   node --experimental-strip-types scripts/verify-secdef-functions-are-not-public.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const file = files.filter((f) => /_secdef_functions_are_not_a_public_api\.sql$/.test(f)).at(-1);
if (!file) { console.log('FAIL  migration *_secdef_functions_are_not_a_public_api.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const later = files.filter((f) => f > file).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

// The only VOLATILE (write-capable) definer functions the public key may call, and why. Adding one is a security decision.
const WRITERS = ['log_zero_result', 'ops_qa_record_coverage', 'ops_qa_record_scope'];
// Never on the public key — each is an attack on its own (cost, deploys, lifecycle, ops state).
const NEVER = ['ai_spend_reset', 'ai_spend_gate', 'acquire_deploy_lock', 'release_deploy_lock', 'ops_selftest_deploy_lock_exclusive',
  'inactive_now', 'auto_recover_false_inactive', 'reactivate_recovered_dormant_platforms', 'claim_work_area', 'release_work_area',
  'promote_aged_alerts_to_incidents', 'refresh_loc_canonical_district', 'sync_search_first_seen_at', 'remediate_dangling_scrape_run'];

function problems(s: string, rest: ReadonlyArray<readonly [string, string]>): string[] {
  const fail: string[] = [];
  if (!/grant_to text\[\] not null check \(cardinality\(grant_to\) > 0 and grant_to <@ array\['anon', 'authenticated'\]::text\[\]\)/.test(s)) fail.push('the allowlist no longer limits roles to anon/authenticated');
  if (!/reason\s+text not null check \(length\(btrim\(reason\)\) >= 20\)/.test(s)) fail.push('an allowlist row no longer needs a reason');
  const listed = [...s.matchAll(/^\s+\('([a-z0-9_]+)', '\{[a-z,]+\}', '/gm)].map((m) => m[1]);
  for (const n of NEVER) if (listed.includes(n)) fail.push(`${n} is on the public allowlist`);
  for (const n of WRITERS) if (!listed.includes(n)) fail.push(`the public writer ${n} lost its allowlist row (the app/e2e would break)`);
  const loop = /for f in select p\.oid::regprocedure sig, p\.proname from pg_proc p\s+where p\.pronamespace = 'public'::regnamespace and p\.prosecdef loop\s+execute format\('revoke execute on function %s from public, anon, authenticated', f\.sig\);\s+execute format\('grant execute on function %s to service_role, postgres', f\.sig\);\s+for g in select unnest\(a\.grant_to\) from public\.ops_public_secdef_allowlist a where a\.proname = f\.proname loop/.test(s);
  if (!loop) fail.push('the existing-function pass no longer revokes EVERY definer function from public/anon/authenticated and re-grants only the allowlist');
  const born = /where c\.classid = 'pg_proc'::regclass and p\.pronamespace = 'public'::regnamespace and p\.prosecdef loop\s+execute format\('revoke execute on function %s from public, anon, authenticated', r\.objid::regprocedure\);\s+execute format\('grant execute on function %s to service_role', r\.objid::regprocedure\);\s+for g in select unnest\(a\.grant_to\) from public\.ops_public_secdef_allowlist a where a\.proname = r\.proname loop/.test(s);
  if (!born) fail.push('the event trigger no longer gives a new definer function only its allowlisted roles');
  if (!/create event trigger ops_secdef_born_revoked on ddl_command_end\s+when tag in \('CREATE FUNCTION', 'CREATE PROCEDURE', 'ALTER FUNCTION'\)/.test(s)) fail.push('the event trigger no longer covers CREATE FUNCTION, CREATE PROCEDURE and ALTER FUNCTION (… SECURITY DEFINER)');
  if (!/hourly cap of 10,000 keys reached/.test(s) || !/every entry must be an existing public table/.test(s) || !/hourly cap of 30 scopes reached/.test(s)) fail.push('a surviving public writer lost its validation or rate cap');
  if (!/if leaked is not null then raise exception/.test(s) || !/zz_secdef_later_probe/.test(s)) fail.push('the apply-time proof (0 leaked; new and ALTERed definer functions born revoked) is missing');
  for (const [f, body] of rest) {
    for (const m of body.matchAll(/grant\s+(execute|all)[^;]*\bon\s+(function|all\s+functions)\s+(public\.)?([a-z0-9_]+)?[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/gi)) {
      const name = m[4] ?? '';
      if (/all\s+functions/i.test(m[2]) || NEVER.includes(name)) fail.push(`${f} opens a definer function to the public key: «${m[0].slice(0, 120)}»`);
    }
    if (/insert into public\.ops_public_secdef_allowlist[^;]*'(ai_spend_reset|acquire_deploy_lock|release_deploy_lock|inactive_now|claim_work_area)'/i.test(body)) fail.push(`${f} allowlists a never-public function`);
    if (/drop\s+event\s+trigger[^;]*ops_secdef_born_revoked/i.test(body) && !/create event trigger ops_secdef_born_revoked/.test(body)) fail.push(`${f} drops the born-revoked definer trigger`);
  }
  return fail;
}

// THE APP'S OWN CALLS (the 18:26 regression: create_shared_chat lost `authenticated` because the caller audit only looked at
// anon-callable functions). Every function the web app or an edge function names in .rpc('…') that some migration defines
// as SECURITY DEFINER must have an allowlist row — in the guard migration or a later one — or the app breaks on revoke.
const root = join(import.meta.dirname, '..');
function walk(d: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = join(d, e.name);
    if (e.isDirectory()) out.push(...walk(f)); else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(f);
  }
  return out;
}
const appRpcs = new Set<string>();
for (const sub of ['src', join('supabase', 'functions')]) {
  for (const f of walk(join(root, sub))) for (const m of readFileSync(f, 'utf8').matchAll(/\.rpc\(\s*['"`]([a-z0-9_]+)['"`]/g)) appRpcs.add(m[1]);
}
const definer = new Set<string>();
for (const f of files) {
  const body = readFileSync(join(dir, f), 'utf8');
  for (const m of body.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\$(?:[a-z_]*)\$/gi)) if (/security\s+definer/i.test(m[2])) definer.add(m[1]);
}
function appProblems(allSql: string): string[] {
  const rows = new Set([...allSql.matchAll(/\('([a-z0-9_]+)', '\{[a-z,]+\}', '/g)].map((m) => m[1]));
  return [...appRpcs].filter((n) => definer.has(n) && !rows.has(n)).map((n) => `the app calls the definer function ${n} but it has no allowlist row (it would be revoked)`);
}
const allGuardSql = [sql, ...later.map(([, b]) => b)].join('\n');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql, later);
check(`committed ${file} (+ ${later.length} later migrations) keep definer functions off the public key`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['ai_spend_reset allowlisted', (s) => s.replace("  ('log_zero_result', '{anon,authenticated}',", "  ('ai_spend_reset', '{anon}', 'convenient for a support page, no reason really'),\n  ('log_zero_result', '{anon,authenticated}',")],
  ['reason requirement dropped', (s) => s.replace('reason   text not null check (length(btrim(reason)) >= 20)', 'reason   text')],
  ['service-only roles widened to PUBLIC', (s) => s.replace("grant_to <@ array['anon', 'authenticated']::text[]", "grant_to <@ array['anon', 'authenticated', 'public']::text[]")],
  ['existing functions keep anon', (s) => s.replace("execute format('revoke execute on function %s from public, anon, authenticated', f.sig);", "execute format('revoke execute on function %s from public, authenticated', f.sig);")],
  ['new functions keep authenticated', (s) => s.replace("execute format('revoke execute on function %s from public, anon, authenticated', r.objid::regprocedure);", "execute format('revoke execute on function %s from public, anon', r.objid::regprocedure);")],
  ['ALTER FUNCTION … SECURITY DEFINER slips past', (s) => s.replace("when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE', 'ALTER FUNCTION')", "when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')")],
  ['the scope registry accepts made-up tables', (s) => s.replace("raise exception 'ops_qa_record_scope: every entry must be an existing public table';", "null;")],
  ['the e2e writer lost its allowlist row', (s) => s.replace(/^\s+\('ops_qa_record_coverage', [^\n]+\n/m, '')],
  ['apply-time proof removed', (s) => s.replace(/-- APPLY-TIME PROOF[\s\S]*$/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m, later).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
mustCatch('a later migration grants acquire_deploy_lock to anon',
  problems(sql, [...later, ['29991231000000_oops.sql', 'grant execute on function public.acquire_deploy_lock(text,text,integer,text) to anon;']]).length > 0);
mustCatch('a later migration drops the guard trigger',
  problems(sql, [...later, ['29991231000001_oops.sql', 'drop event trigger if exists ops_secdef_born_revoked;']]).length > 0);
const app = appProblems(allGuardSql);
check(`every definer function the app calls (${[...appRpcs].filter((n) => definer.has(n)).length}) has an allowlist row`, app.length === 0, app.join('; '));
mustCatch('create_shared_chat row removed (signed-in sharing breaks)', appProblems(allGuardSql.replace(/\('create_shared_chat', [^\n]+/, '')).length > 0);
console.log(failed === 0 ? 'OK: no SECURITY DEFINER function is callable with the public key outside the reasoned allowlist' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
