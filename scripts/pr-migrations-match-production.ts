// THE DATABASE LANE of .github/workflows/engineer-automerge.yml (owner 2026-11-07: «yeah do that» — let the robot
// land database PRs by itself when they are green, after 20 h with no frontend deploy on 11-06/07).
//
// Why it was stuck: the deploy gate refuses every deploy while a migration applied to production is missing from git.
// Five were; their PRs sat for a person because they touched supabase/ or sql/mirrors/ (#10856 cron mirror, #10913
// Falcon's registry half, #10929 the pin-candidates guard). Merging such a file changes nothing in production — it is
// the git copy of SQL production ALREADY ran — but only if it really is that copy. This script is that proof:
//   every supabase/migrations/<version>_*.sql file in the PR must equal ops_migration_sql(version), i.e. exactly what
//   production executed (trailing whitespace aside, the same normalisation as verify-migration-content-parity.ts).
// A migration production has NOT run (an engineer's PR meant to be applied on merge), an unreadable file, or any
// difference → exit 1 and the PR stays with a person. sql/mirrors/ files are git copies with their own required
// barriers (verify-sql-mirrors-not-stale, …) and need no production read here. Nothing here writes anywhere.
//
//   node --experimental-strip-types scripts/pr-migrations-match-production.ts <git-ref> <file>...
//   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; hermetic proof: scripts/verify-pr-migrations-match-production.ts)
import { execFileSync } from 'node:child_process';
import { normalizeMigrationSql } from './lib/migrationDrift.ts';

export const MIGRATION_FILE = /^supabase\/migrations\/(\d{14})_[A-Za-z0-9_]+\.sql$/;
/** The only files outside the robot lanes the database lane admits. */
export const DB_LANE_FILE = /^(supabase\/migrations\/\d{14}_[A-Za-z0-9_]+\.sql|sql\/mirrors\/[A-Za-z0-9_.-]+)$/;

export type PrFile = { path: string; text: string | null };

export function judge(files: PrFile[], applied: Map<string, string | null>): { ok: boolean; why: string[] } {
  const why: string[] = [];
  for (const f of files) {
    if (!DB_LANE_FILE.test(f.path)) { why.push(`${f.path}: not a migration or sql/mirrors file`); continue; }
    const m = MIGRATION_FILE.exec(f.path);
    if (!m) continue;
    const prod = applied.get(m[1]);
    if (typeof prod !== 'string' || !prod.trim()) { why.push(`${f.path}: production has not run ${m[1]}`); continue; }
    if (f.text == null) { why.push(`${f.path}: unreadable at the PR head`); continue; }
    if (normalizeMigrationSql(f.text) !== normalizeMigrationSql(prod)) why.push(`${f.path}: differs from what production ran`);
  }
  return { ok: files.length > 0 && why.length === 0, why: files.length ? why : ['no files'] };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/pr-migrations-match-production.ts')) {
  const [ref, ...paths] = process.argv.slice(2);
  const URL_BASE = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const die = (why: string) => { console.error(`✗ database lane: ${why}`); process.exit(1); };
  if (!ref || !paths.length) die('usage: pr-migrations-match-production.ts <git-ref> <file>...');
  if (!URL_BASE || !KEY) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (unverifiable is never a pass)');
  const files: PrFile[] = paths.map((path) => {
    try { return { path, text: execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch { return { path, text: null }; }
  });
  const applied = new Map<string, string | null>();
  for (const f of files) {
    const v = MIGRATION_FILE.exec(f.path)?.[1];
    if (!v) continue;
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/ops_migration_sql`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_version: v }), signal: AbortSignal.timeout(60_000),
    }).catch((e) => die(`ops_migration_sql(${v}): ${e.message}`));
    if (!r || !r.ok) die(`ops_migration_sql(${v}) http ${r?.status}`);
    applied.set(v, await r!.json());
  }
  const v = judge(files, applied);
  for (const w of v.why) console.log(`  ✗ ${w}`);
  console.log(v.ok ? `✓ database lane: ${files.length} file(s), every migration is exactly what production ran` : '✗ database lane: left for a person');
  process.exit(v.ok ? 0 : 1);
}
