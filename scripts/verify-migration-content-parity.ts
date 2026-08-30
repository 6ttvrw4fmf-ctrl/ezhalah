// DRIFT CONDITION #5 — migration content parity (routine #7, systems seam, 2026-08-30).
//
// THE HOLE THIS CLOSES. The four drift conditions AGENTS.md pins all compare IDENTIFIERS: a
// version, a name, a function signature. Not one of them ever reads what a migration file SAYS. So
// a committed file can contain SQL production never executed — or omit SQL production did execute —
// and every barrier in this repo stays green, because the version matches and the name matches.
//
// Measured the day this was written: 75 of 269 strict-era files (26%) disagreed with the statements
// production actually ran. That is not a formatting artifact — a faithful mirror is byte-identical
// to the applied statements modulo trailing whitespace, proven on 20260829223530. Two consequences,
// both real:
//   * 20260829234156's file carries a `do $do$` block registering mon_detect_ai_telemetry_health in
//     the twice-hourly sweep; the applied statements do not contain it. A detector registration
//     living only in git is the dark-detector shape — nine of those once read as a clean bill of
//     health here (AGENTS.md).
//   * AGENTS.md's documented drift repair is "recover the missing SQL verbatim from
//     supabase_migrations.schema_migrations.statements". That instruction assumes the repo is a
//     faithful record of production. Where the two disagree, it silently is not.
//
// HOW IT RUNS. Reads ops_migration_content_digests() on the PUBLIC anon key (read-only and
// anon-executable by design, exactly like ops_deploy_preflight_checks), hashes the repo's own files
// with the identical normalisation, and diffs. SUPABASE_SERVICE_ROLE_KEY, when present, additionally
// records the heartbeat and raises/resolves the alert — its absence only skips those side effects,
// never the exit code.
//
// NOT IN `npm test`, on purpose and for the same reason AGENTS.md pins verify-migration-drift-vs-
// production.ts out of it: `npm test` is a REQUIRED check on every PR, and content divergence
// anywhere in production would fail every unrelated PR. It rides the dedicated 15-minute
// migration-drift-guard workflow instead. scripts/test-exclusions.txt records that, and
// verify-migration-content-parity-wired.ts pins the whole arrangement in both directions.
//
//   node --experimental-strip-types scripts/verify-migration-content-parity.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { listMigrationFiles } from './build-repo-migration-versions.cjs';
import {
  findContentDivergence,
  normalizeMigrationSql,
  parseMigrationFilename,
  type AppliedDigest,
  type RepoMigrationContent,
} from './lib/migrationDrift.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ROOT = path.join(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
export const BASELINE_FILE = path.join(ROOT, 'scripts', 'migration-content-parity-baseline.txt');
const KIND = 'migration_content_parity';
const DEDUP_KEY = 'migration_content_parity_diverged';

// The digest must be computed identically on both sides or every file reads as diverged. Server:
// left(md5(array_to_string(statements, E'\n')), 10). Here: the same md5 over the file's bytes with
// trailing whitespace stripped. Exported so the offline barrier can prove the two agree.
export function digestOf(sql: string): string {
  return crypto.createHash('md5').update(normalizeMigrationSql(sql), 'utf8').digest('hex').slice(0, 10);
}

// `<version>  <name>` lines; # comments and blanks ignored. Only the version is load-bearing.
export function readBaseline(file: string = BASELINE_FILE): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.add(line.split(/\s+/)[0]);
  }
  return out;
}

export function readRepoMigrationContent(dir: string = MIGRATIONS_DIR): RepoMigrationContent[] {
  const out: RepoMigrationContent[] = [];
  for (const f of listMigrationFiles(dir)) {
    const parsed = parseMigrationFilename(f);
    if (!parsed) continue;
    out.push({
      version: parsed.version,
      name: parsed.name,
      file: f,
      md5: digestOf(fs.readFileSync(path.join(dir, f), 'utf8')),
    });
  }
  return out;
}

async function callRpc(url: string, apikey: string, body: unknown, timeoutMs = 20000) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

// Importable as a module (the offline barrier does exactly that) without firing the live check.
if (import.meta.filename === process.argv[1]) {
  let applied: AppliedDigest[];
  try {
    applied = await callRpc(`${URL_BASE}/rest/v1/rpc/ops_migration_content_digests`, ANON_KEY, {});
  } catch (e) {
    // Same posture as the drift checker: a container with no network must not silently pass in CI,
    // but must not fail a developer's local run either. CI runs it with network.
    console.warn(`⚠ migration-content-parity SKIPPED (network unavailable: ${e}) — run again with network; CI must not skip.`);
    process.exit(0);
  }

  const baseline = readBaseline();
  const repo = readRepoMigrationContent();
  const diverged = findContentDivergence(repo, applied, baseline);

  if (SERVICE_ROLE_KEY) {
    try {
      await callRpc(`${URL_BASE}/rest/v1/rpc/ops_record_content_parity_check`, SERVICE_ROLE_KEY, {
        p_divergences: diverged.length,
        p_baseline_entries: baseline.size,
        p_checker: 'migration-drift-guard.yml',
      });
      if (diverged.length) {
        await callRpc(`${URL_BASE}/rest/v1/rpc/mon_raise`, SERVICE_ROLE_KEY, {
          p_sev: 'P2',
          p_kind: KIND,
          p_platform: null,
          p_dedup: DEDUP_KEY,
          p_detail: {
            why: 'a committed migration file disagrees with the statements production actually executed, beyond the enumerated baseline',
            divergences: diverged.slice(0, 25),
            baseline_entries: baseline.size,
          },
        });
      } else {
        await callRpc(`${URL_BASE}/rest/v1/rpc/mon_resolve_key`, SERVICE_ROLE_KEY, {
          p_kind: KIND,
          p_dedup: DEDUP_KEY,
        });
      }
    } catch (e) {
      console.warn(`⚠ could not record heartbeat/alert (non-fatal, exit code is unaffected): ${e}`);
    }
  }

  if (diverged.length) {
    console.error(`✗ migration content parity: ${diverged.length} file(s) differ from what production executed`);
    console.error(`  (${baseline.size} pre-existing divergences are exempted by scripts/migration-content-parity-baseline.txt)`);
    for (const d of diverged) {
      console.error(`    ${d.file}`);
      console.error(`      repo md5 ${d.repoMd5} vs applied ${d.appliedMd5} at version ${d.appliedVersion} (matched by ${d.matchedBy})`);
    }
    console.error(`  Fix by making the file match what production ran — recover it verbatim from`);
    console.error(`  supabase_migrations.schema_migrations.statements — or apply the part production never got.`);
    console.error(`  Do NOT add a line to the baseline: it is a floor that may only shrink.`);
    process.exit(1);
  }

  console.log(
    `✓ migration content parity: ${repo.length} repo file(s) vs ${applied.length} applied migration(s); ` +
      `no new divergence (${baseline.size} baselined).`,
  );
}
