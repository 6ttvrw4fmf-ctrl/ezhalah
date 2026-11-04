// APPLY ONE MIGRATION WITHOUT THE MCP's QUESTION (owner 2026-11-04). Driven by .github/workflows/apply-migration.yml.
//
// The Supabase MCP sometimes asks its own «are you sure?» for apply_migration and for UPDATE/DELETE in execute_sql.
// An unattended routine cannot answer, the call times out, and on 2026-11-03 the 🦅 applied no SQL after 20:12 UTC.
// This applies a committed migration file through the Management API instead, with the guards the MCP never had.
//
// WHY THE QUERY ENDPOINT AND NOT POST /database/migrations: that endpoint mints its OWN version (now()), so the
// history row would disagree with the committed file's name and the auto-mirror would save a second copy under a
// new version. Here the file's SQL and its history row (version + name from the filename, statements = the exact
// file bytes, so ops_migration_sql() and the mirror stay byte-exact) go in ONE request; a multi-statement simple
// query is one implicit transaction, so a failing statement records nothing and changes nothing.
//
//   node --experimental-strip-types scripts/ops/apply-migration.mjs applied <file>        exit 1 when the version is already applied
//   node --experimental-strip-types scripts/ops/apply-migration.mjs lint <file>           exit 1 on a forbidden statement (offline)
//   node --experimental-strip-types scripts/ops/apply-migration.mjs quiet                 exit 1 when the database is busy (AGENTS.md rule 1)
//   node --experimental-strip-types scripts/ops/apply-migration.mjs apply <file>
//   node --experimental-strip-types scripts/ops/apply-migration.mjs audit <file> <result> [why]
//   node --experimental-strip-types scripts/ops/apply-migration.mjs --self-test
// Needs SUPABASE_ACCESS_TOKEN (never printed) for every subcommand except lint and --self-test.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { basename } from 'node:path';
// The repo's own «what does this migration EXECUTE» reader (function bodies are definitions, DO blocks run).
import { executedSql } from '../lib/repairClassifier.ts';

const REF = 'aannarbkwcymrotzwdbo';
export const FILE_RE = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/;
// Tables the public roles must never be granted. ponytail: prefix list, extend when a new internal family appears.
const INTERNAL = /^(public\.)?("?)(ops_|mon_|alert_|supabase_migrations\.)/i;
// AGENTS.md "PRODUCTION IS THE ONLY DATABASE" rule 1: active authenticator queries > 8, or any running > 5 s → wait.
const MAX_ACTIVE = 8;

/** Comments and single-quoted literals removed, so prose about «delete from …» is not a statement. */
const code = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/'(?:[^']|'')*'/g, "''");

/** Why this SQL is refused; [] = allowed. Reads only what runs at migration time (executedSql); a temp table
 *  the same file creates may be dropped, truncated or rewritten freely. */
export function lint(sql) {
  const why = [];
  const run = code(executedSql(sql));
  const temp = new Set([...run.matchAll(/\bcreate\s+(?:local\s+)?temp(?:orary)?\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)]
    .map((m) => m[1].toLowerCase().replace(/"/g, '')));
  const onTemp = (s, re) => { const m = re.exec(s); return m && temp.has(m[1].toLowerCase().replace(/"/g, '')); };
  for (const raw of run.split(';')) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const short = s.slice(0, 120);
    if (/\bdrop\s+table\b/i.test(s) && !onTemp(s, /\bdrop\s+table\s+(?:if\s+exists\s+)?([\w."]+)\s*(?:cascade|restrict)?$/i))
      why.push(`DROP TABLE: ${short}`);
    if (/\bdrop\s+schema\b/i.test(s)) why.push(`DROP SCHEMA: ${short}`);
    if (/(?<!\b(?:before|after|or)\s)\btruncate\b/i.test(s) && !/^(grant|revoke)\b/i.test(s) && !onTemp(s, /\btruncate\s+(?:table\s+)?(?:only\s+)?([\w."]+)$/i))
      why.push(`TRUNCATE: ${short}`);
    if (/\balter\s+role\b/i.test(s)) why.push(`ALTER ROLE: ${short}`);
    const g = /\bgrant\b.*?\bon\b(?:\s+table)?\s+(.+?)\s+to\s+(.+)$/i.exec(s);
    if (g && /\b(anon|authenticated|public)\b/i.test(g[2])) {
      const targets = g[1].split(',').map((t) => t.trim());
      if (/all\s+tables\s+in\s+schema/i.test(g[1]) || targets.some((t) => INTERNAL.test(t)))
        why.push(`GRANT on an internal table to a public role: ${short}`);
    }
    if (/\bupdate\s+(only\s+)?[\w."]+(\s+(as\s+)?\w+)?\s+set\b/i.test(s) && !/\bwhere\b/i.test(s)
      && !onTemp(s, /\bupdate\s+(?:only\s+)?([\w."]+)/i)) why.push(`UPDATE without WHERE: ${short}`);
    if (/\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s) && !onTemp(s, /\bdelete\s+from\s+(?:only\s+)?([\w."]+)/i))
      why.push(`DELETE without WHERE: ${short}`);
  }
  return why;
}

function parse(file) {
  const m = FILE_RE.exec(file ?? '');
  if (!m) throw new Error(`file must match ${FILE_RE}: ${file}`);
  const sql = readFileSync(file, 'utf8');
  return { version: m[1], name: m[2], sql, md5: createHash('md5').update(sql).digest('hex') };
}

/** Dollar-quote with a tag the text cannot contain. */
function dq(text) {
  let tag;
  do tag = `$am_${randomBytes(6).toString('hex')}$`; while (text.includes(tag));
  return `${tag}${text}${tag}`;
}

async function query(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 2000)}`);
  return body ? JSON.parse(body) : [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main([cmd, file, ...rest]) {
  if (cmd === 'lint') {
    const why = lint(parse(file).sql);
    for (const w of why) console.log(`::error::refused — ${w}`);
    console.log(why.length ? `REFUSED: ${why.length} forbidden statement(s)` : 'lint: clean');
    return why.length ? 1 : 0;
  }
  if (cmd === 'applied') {
    const { version, name } = parse(file);
    const rows = await query(`select version, name from supabase_migrations.schema_migrations where version = '${version}'`);
    if (rows.length) { console.log(`::error::refused — version ${version} is already applied (name ${rows[0].name})`); return 1; }
    console.log(`not applied yet: ${version}_${name}`);
    return 0;
  }
  if (cmd === 'quiet') {
    for (let i = 1; i <= 6; i++) {
      const [r] = await query(`select count(*) filter (where state = 'active')::int as active,
        count(*) filter (where state = 'active' and now() - query_start > interval '5 seconds')::int as slow
        from pg_stat_activity where usename = 'authenticator' and pid <> pg_backend_pid()`);
      console.log(`check ${i}/6: ${r.active} active authenticator queries, ${r.slow} running > 5 s`);
      if (r.active <= MAX_ACTIVE && r.slow === 0) { console.log('database is quiet'); return 0; }
      if (i < 6) await sleep(15_000);
    }
    console.log(`::error::refused — database busy for 90 s (AGENTS.md rule 1: > ${MAX_ACTIVE} active authenticator queries or one > 5 s); dispatch again later`);
    return 1;
  }
  if (cmd === 'apply') {
    const { version, name, sql } = parse(file);
    const actor = `apply-migration.yml:${process.env.GITHUB_ACTOR ?? 'unknown'}`;
    await query(`${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements, created_by)
values ('${version}', '${name}', array[${dq(sql)}], ${dq(actor)});`);
    const [row] = await query(`select version, name, md5(array_to_string(statements, E';\\n')) as md5
      from supabase_migrations.schema_migrations where version = '${version}'`);
    if (!row) { console.log('::error::applied but no history row found'); return 1; }
    const ok = row.md5 === parse(file).md5;
    console.log(`history row: ${row.version} ${row.name} md5 ${row.md5} ${ok ? '= file' : '≠ FILE'}`);
    return ok ? 0 : 1;
  }
  if (cmd === 'audit') {
    const { version, md5 } = parse(file);
    const [result, why = ''] = rest;
    const e = process.env;
    const metrics = {
      file, version, md5, result, why, actor: e.GITHUB_ACTOR, ref: e.GITHUB_REF_NAME, sha: e.GITHUB_SHA,
      reason: e.REASON, run_url: `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}`,
    };
    await query(`insert into public.ops_daily_engineer_run (phase, report, metrics)
      values ('apply-migration', ${dq(`${result}: ${file}`)}, ${dq(JSON.stringify(metrics))}::jsonb)`);
    console.log(`audit row written: ${result}`);
    return 0;
  }
  throw new Error(`unknown subcommand: ${cmd}`);
}

function selfTest() {
  const cases = [
    ['comment on function public.ops_x() is \'delete from listings; truncate\';', 0],
    ['-- update listings set x = 1\nselect 1;', 0],
    ['update listings set x = 1 where id = 2;', 0],
    ['update listings l set x = 1;', 1],
    ['delete from ops_x;', 1],
    ['delete from ops_x where at < now();', 0],
    ['drop table if exists foo;', 1],
    ['drop schema s cascade;', 1],
    ['truncate ops_x;', 1],
    ['alter role authenticator set statement_timeout = 0;', 1],
    ['grant select on public.ops_daily_engineer_run to anon;', 1],
    ['grant select on table ops_x, listings to authenticated;', 1],
    ['grant select on all tables in schema public to anon;', 1],
    ['grant select on public.listings to anon;', 0],
    ['grant execute on function ops_x() to service_role;', 0],
    ['create function f() returns void language sql as $$ update t set a = 1 $$;', 0],
    ['do $$ begin update t set a = 1; end $$;', 1],
    ['create temp table _t as select 1 a; update _t set a = 2; truncate _t; drop table _t;', 0],
    ['create temp table _t as select 1 a; drop table listings;', 1],
    ['revoke insert, update, delete, truncate on public.t from anon;', 0],
    ['create trigger tr before truncate on t for each statement execute function f();', 0],
    ['alter table t add constraint c foreign key (a) references b on delete cascade on update cascade;', 0],
    ['create trigger tr before update on t for each row execute function f();', 0],
  ];
  let bad = 0;
  for (const [sql, n] of cases) {
    const got = lint(sql).length;
    const ok = (got > 0) === (n > 0);
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n ? 'refuses' : 'allows '}: ${sql.split('\n')[0].slice(0, 90)}`);
  }
  for (const [f, ok] of [['supabase/migrations/20261104230000_x_y.sql', true], ['supabase/migrations/2026_x.sql', false],
    ['supabase/migrations/20261104230000_X.sql', false], ['../supabase/migrations/20261104230000_x.sql', false]]) {
    const pass = FILE_RE.test(f) === ok;
    if (!pass) bad++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  file ${ok ? 'accepted' : 'rejected'}: ${f}`);
  }
  console.log(bad ? `\n❌ apply-migration self-test: ${bad} failed` : '\n✅ apply-migration self-test passed');
  return bad ? 1 : 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'apply-migration.mjs') {
  const args = process.argv.slice(2);
  Promise.resolve(args[0] === '--self-test' ? selfTest() : main(args))
    .then((code) => process.exit(code))
    .catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
}
