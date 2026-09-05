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
  stripSqlCommentsAndBlanks,
  type AppliedDigest,
  type ContentDivergence,
  type RepoMigrationContent,
} from './lib/migrationDrift.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ROOT = path.join(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
export const BASELINE_FILE = path.join(ROOT, 'scripts', 'migration-content-parity-baseline.txt');
const KIND = 'migration_content_parity';
// One key per class — see the raise block below and 20260831105431. These MUST stay distinct:
// mon_raise() suppresses dispatch on an already-open key, so a shared key let a standing benign
// divergence hide a new dangerous one. verify-migration-parity-class-split.ts pins the split.
export const CODE_DEDUP_KEY = 'migration_content_parity_diverged:code';
export const COMMENT_DEDUP_KEY = 'migration_content_parity_diverged:comments';
/** Separate key: "the check could not run" is a different fact from "the content diverged". */
export const PARITY_UNAVAILABLE_KEY = 'migration_content_parity_check_unavailable';

// The digest must be computed identically on both sides or every file reads as diverged. Server:
// left(md5(array_to_string(statements, E'\n')), 10). Here: the same md5 over the file's bytes with
// trailing whitespace stripped. Exported so the offline barrier can prove the two agree.
export function digestOf(sql: string): string {
  return crypto.createHash('md5').update(normalizeMigrationSql(sql), 'utf8').digest('hex').slice(0, 10);
}

// The CLASSIFYING digest (2026-08-31). Server: code_md5 in ops_migration_content_digests(). Never
// decides whether a file diverges — digestOf() above still does that, byte-exactly — only whether
// an already-found divergence is code-level or comment-only, so the two get distinct dedup keys.
export function codeDigestOf(sql: string): string {
  return crypto
    .createHash('md5')
    .update(stripSqlCommentsAndBlanks(sql), 'utf8')
    .digest('hex')
    .slice(0, 10);
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
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({
      version: parsed.version,
      name: parsed.name,
      file: f,
      md5: digestOf(sql),
      codeMd5: codeDigestOf(sql),
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
    const raw: Array<Record<string, string>> = await callRpc(
      `${URL_BASE}/rest/v1/rpc/ops_migration_content_digests`,
      ANON_KEY,
      {},
    );
    // The RPC speaks snake_case. A row without code_md5 (an older server, a rollback) keeps
    // codeMd5 undefined, and classifyDivergence() then fails CLOSED to the 'code' class.
    applied = raw.map((d) => ({
      version: d.version,
      name: d.name,
      md5: d.md5,
      codeMd5: d.code_md5,
    }));
  } catch (e) {
    // FAILS CLOSED (2026-09-04), same as the drift checker it shares a workflow with. The old
    // posture ("must not fail a developer's local run") bought a quiet laptop at the price of a
    // lying schedule: every 15 minutes this could fail to read production and still exit 0.
    // A read that did not happen tells us NOTHING about parity, and nothing is not clean.
    if (SERVICE_ROLE_KEY) {
      try {
        await callRpc(`${URL_BASE}/rest/v1/rpc/mon_raise`, SERVICE_ROLE_KEY, {
          p_sev: 'P1',
          p_kind: PARITY_UNAVAILABLE_KEY,
          p_platform: null,
          p_dedup: PARITY_UNAVAILABLE_KEY,
          p_detail: { reason: String(e).slice(0, 500), checker: 'verify-migration-content-parity.ts', at: new Date().toISOString() },
        });
      } catch (e2) {
        console.warn(`\u26a0 could not raise ${PARITY_UNAVAILABLE_KEY} (the exit code below is still the gate): ${e2}`);
      }
    }
    console.error(`✗ migration-content-parity COULD NOT CHECK (${e}).`);
    console.error(`  Failing closed: an unchecked production is not a clean production.`);
    process.exit(1);
  }

  const baseline = readBaseline();
  const repo = readRepoMigrationContent();
  const diverged = findContentDivergence(repo, applied, baseline);

  const codeDiverged = diverged.filter((d) => d.kind === 'code');
  const commentDiverged = diverged.filter((d) => d.kind === 'comments');

  if (SERVICE_ROLE_KEY) {
    try {
      await callRpc(`${URL_BASE}/rest/v1/rpc/ops_record_content_parity_check`, SERVICE_ROLE_KEY, {
        p_divergences: diverged.length,
        p_baseline_entries: baseline.size,
        p_checker: 'migration-drift-guard.yml',
      });

      // ONE DEDUP KEY PER CLASS (2026-08-31). Previously both classes shared
      // 'migration_content_parity_diverged', and because mon_raise() returns 0 and leaves
      // dispatched_at set on an already-open key, a standing benign divergence meant a NEW
      // code-level one was never dispatched — it only rewrote the open alert's payload. Keying
      // them apart is what makes the dangerous class reach a human while the benign one stands.
      const raiseOrResolve = async (
        dedup: string,
        sev: 'P1' | 'P2',
        rows: ContentDivergence[],
        why: string,
      ) => {
        if (rows.length) {
          await callRpc(`${URL_BASE}/rest/v1/rpc/mon_raise`, SERVICE_ROLE_KEY, {
            p_sev: sev,
            p_kind: KIND,
            p_platform: null,
            p_dedup: dedup,
            p_detail: { why, divergences: rows.slice(0, 25), baseline_entries: baseline.size },
          });
        } else {
          await callRpc(`${URL_BASE}/rest/v1/rpc/mon_resolve_key`, SERVICE_ROLE_KEY, {
            p_kind: KIND,
            p_dedup: dedup,
          });
        }
      };

      await raiseOrResolve(
        CODE_DEDUP_KEY,
        'P1',
        codeDiverged,
        'the EXECUTABLE SQL of a committed migration file differs from what production actually ran. ' +
          'This is the dangerous class: SQL — or a detector registration — living only in git or only in ' +
          'production (the dark-detector shape). Reconcile the file against ' +
          'supabase_migrations.schema_migrations.statements, or apply the part production never got. ' +
          'Never baseline it.',
      );
      await raiseOrResolve(
        COMMENT_DEDUP_KEY,
        'P2',
        commentDiverged,
        'a committed migration file differs from what production ran in whole-line COMMENTS or blank ' +
          'lines only — the executable SQL is byte-identical, so production is not missing anything. ' +
          'Usually rationale written into the file after the migration was applied. Benign, but the repo ' +
          'is not a faithful mirror, which the documented "recover verbatim from statements" repair path ' +
          'assumes. Reconcile the file when convenient. Kept on its OWN dedup key so it can never ' +
          'suppress the P1 code-level class.',
      );
      // The read demonstrably worked — so the "could not check" P1 is over.
      await callRpc(`${URL_BASE}/rest/v1/rpc/mon_resolve_key`, SERVICE_ROLE_KEY, {
        p_kind: PARITY_UNAVAILABLE_KEY,
        p_dedup: PARITY_UNAVAILABLE_KEY,
      });
    } catch (e) {
      console.warn(`⚠ could not record heartbeat/alert (non-fatal, exit code is unaffected): ${e}`);
    }
  }

  if (diverged.length) {
    console.error(`✗ migration content parity: ${diverged.length} file(s) differ from what production executed`);
    console.error(`  (${baseline.size} pre-existing divergences are exempted by scripts/migration-content-parity-baseline.txt)`);
    console.error(`  ${codeDiverged.length} CODE-level (P1, dangerous), ${commentDiverged.length} comment-only (P2, benign)`);
    for (const d of diverged) {
      console.error(`    [${d.kind === 'code' ? 'CODE' : 'comments'}] ${d.file}`);
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
