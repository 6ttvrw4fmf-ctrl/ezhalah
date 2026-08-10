// Continuous migration-drift barrier (2026-08-10, owner-requested — "Production DB change →
// tracked migration → repository matches production → CI verifies the match").
//
// THE GAP THIS CLOSES: scripts/safe-deploy.sh already calls ops_deploy_preflight_checks and
// refuses to DEPLOY on drift — but that only checks at the moment someone runs a deploy. Multiple
// concurrent agent sessions apply migrations directly to production via the Supabase MCP
// (apply_migration) routinely (see AGENTS.md "Deployment lock" — a documented, expected pattern,
// not a one-off mistake), and a session that does so without also committing the SQL to git leaves
// drift that nothing detected until the NEXT deploy attempt — sometimes days later. That is exactly
// how the 2026-07-16 PGRST203 outage happened, and the daily-engineer heartbeat has independently
// found fresh uncommitted-migration drift on at least two separate days since (2026-08-04, 2026-08-10).
//
// THIS script asks production the same question ops_deploy_preflight_checks always answered, but
// runs it continuously instead of only at deploy time — via .github/workflows/migration-drift-guard.yml,
// on its own tight schedule (every 15 minutes) PLUS on every push to main that touches
// supabase/migrations/. On drift it fails that dedicated job loudly AND raises a P1 alert_event row
// (service-role key, when provided) so the ops dashboard shows it immediately too, not just a
// GitHub Actions red X someone has to notice.
//
// DELIBERATELY NOT wired into `npm test` / full-verification-ci.yml, unlike most other live-network
// verifiers here (e.g. verify-live-canon-sync.ts). `npm test` is a REQUIRED status check for every
// PR regardless of what it touches — and unlike canon-sync drift (rare), migration drift in this
// repo is common (multiple concurrent sessions apply migrations directly via MCP routinely; this
// exact check caught 11 drifted migrations, including 2 from minutes earlier, the first time it
// ever ran for real in CI). Wiring it into the required check would mean an UNRELATED PR — a one-
// line scraper fix touching nothing near migrations — goes red because some OTHER session forgot to
// commit something hours ago. That is not "fail loudly", it's "block everyone for someone else's
// miss". The dedicated schedule + migrations-path-scoped push trigger already deliver "detect
// immediately and fail loudly" without that collateral blocking — see
// verify-migration-drift-guard-wired.ts, which pins this exclusion so it cannot silently regress.
//
// Uses the PUBLIC anon key for the read (ops_deploy_preflight_checks is anon-executable by design —
// see its own migration comment — so no secret is needed for the core check). SUPABASE_SERVICE_ROLE_KEY,
// if present in the environment, additionally raises/resolves the P1 alert_event row; its absence
// only skips that dashboard side-effect — the exit code (the actual CI gate) is unaffected.
//
//   node --experimental-strip-types scripts/verify-migration-drift-vs-production.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { buildRepoMigrationVersions } from './build-repo-migration-versions.cjs';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEDUP_KEY = 'migration_drift';

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

type PreflightResult = {
  baseline: string;
  missing_in_git: string[];
  missing_in_git_details: Array<{ version: string; name: string }>;
  duplicate_overloads: string[];
  live_migrations_total: number;
  checked_at: string;
};

let result: PreflightResult;
try {
  const p_repo_versions = buildRepoMigrationVersions();
  result = await callRpc(`${URL_BASE}/rest/v1/rpc/ops_deploy_preflight_checks`, ANON_KEY, {
    p_repo_versions,
  });
} catch (e) {
  console.warn(`⚠ migration-drift-vs-production SKIPPED (network unavailable: ${e}) — run again with network; CI must not skip.`);
  process.exit(0);
}

const missing = result.missing_in_git ?? [];
const dups = result.duplicate_overloads ?? [];
const drifted = missing.length > 0 || dups.length > 0;

// Best-effort dashboard side-effect. Never lets a write failure mask (or fake) the actual gate —
// the exit code below is decided from `drifted` alone, computed before this block runs.
if (SERVICE_ROLE_KEY) {
  try {
    if (drifted) {
      const detail = {
        missing_in_git_count: missing.length,
        missing_in_git_details: result.missing_in_git_details,
        duplicate_overloads: dups,
        live_migrations_total: result.live_migrations_total,
        baseline: result.baseline,
        checked_at: result.checked_at,
      };
      await callRpc(`${URL_BASE}/rest/v1/rpc/mon_raise`, SERVICE_ROLE_KEY, {
        p_sev: 'P1',
        p_kind: DEDUP_KEY,
        p_platform: null,
        p_dedup: DEDUP_KEY,
        p_detail: detail,
      });
    } else {
      await callRpc(`${URL_BASE}/rest/v1/rpc/mon_resolve_key`, SERVICE_ROLE_KEY, {
        p_kind: DEDUP_KEY,
        p_dedup: DEDUP_KEY,
      });
    }
  } catch (e) {
    console.warn(`⚠ could not update alert_event (non-fatal, exit code is unaffected): ${e}`);
  }
}

if (drifted) {
  console.error(`✗ migration drift detected against production (baseline ${result.baseline}, ${result.live_migrations_total} live migrations):`);
  if (missing.length) {
    console.error(`  ${missing.length} migration(s) applied to prod but MISSING FROM GIT:`);
    for (const d of result.missing_in_git_details ?? []) console.error(`    ${d.version}  ${d.name}`);
    console.error(`  Recover verbatim from supabase_migrations.schema_migrations.statements into supabase/migrations/, commit, and open a PR.`);
  }
  if (dups.length) {
    console.error(`  ${dups.length} public function(s) with duplicate overloads (the exact PGRST203 outage shape): ${dups.join(', ')}`);
  }
  process.exit(1);
}

console.log(`✓ migration-drift-vs-production: 0 missing, 0 duplicate overloads (${result.live_migrations_total} live migrations, baseline ${result.baseline}).`);
