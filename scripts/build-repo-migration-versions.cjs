#!/usr/bin/env node
// Single source of truth for "what migration identifiers does this repo claim to have applied."
//
// Extracted 2026-08-10 from scripts/safe-deploy.sh's inline node snippet, which was duplicated
// nowhere else UNTIL today — when a second caller (scripts/verify-migration-drift-vs-production.ts,
// the continuous drift barrier) needed the exact same logic. Two copies of "how do we parse a
// migration filename into the identifiers ops_deploy_preflight_checks accepts" is exactly the kind
// of drift this repo keeps getting bitten by (see scripts/deploy-target-guard.sh's own header for
// the same reasoning re: the deploy-target predicates) — so this file exists so there is only ever
// ONE parser, imported by both.
//
// For each supabase/migrations/*.sql file: if the stem matches ^([0-9]+)_(.+)$, both the leading
// digit run (the version, for files applied via a real timestamped migration) AND the remainder
// (the name, for files applied via MCP apply_migration which mints its own server-side version
// timestamp that never matches a date-only filename prefix) are recorded. A file that doesn't match
// that shape contributes its bare stem. See supabase/migrations/20260716_batch4_deploy_preflight_rpc.sql
// for why BOTH forms must be accepted.
//
// Usage:
//   node scripts/build-repo-migration-versions.cjs                    # prints {"p_repo_versions":[...]}
//   require('./build-repo-migration-versions.cjs').buildRepoMigrationVersions(dir?)   // as a module
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function buildRepoMigrationVersions(migrationsDir) {
  const dir = migrationsDir || path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const ids = new Set();
  for (const f of files) {
    const base = f.replace(/\.sql$/, '');
    const m = base.match(/^([0-9]+)_(.+)$/);
    if (m) {
      ids.add(m[1]);
      ids.add(m[2]);
    } else {
      ids.add(base);
    }
  }
  return [...ids].sort();
}

module.exports = { buildRepoMigrationVersions };

if (require.main === module) {
  process.stdout.write(JSON.stringify({ p_repo_versions: buildRepoMigrationVersions() }));
}
