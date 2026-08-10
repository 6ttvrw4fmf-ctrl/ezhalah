// THE PRODUCTION DEPLOY LOCK MUST HAVE EXACTLY ONE IDENTITY. (2026-08-10)
//
// THE DEFECT THIS LOCKS OUT. `acquire_deploy_lock()` upserts with `on conflict (lock_name)`, so the
// lock's identity IS the string it is called with. AGENTS.md mandates 'production'. On 2026-08-10 a
// concurrent daily-health-check session used 'prod': it held 'prod' from 11:08:39Z while the senior
// audit session held 'production' from 11:12:58Z and applied a migration at 11:13:26Z. BOTH believed
// they held the deploy lock; NO mutual exclusion occurred. Harmless only because the two sessions
// touched disjoint objects — luck, not design, and exactly the 2026-07-15 three-session outage class.
//
// The database now normalises every alias to one canonical row (migration
// 20260810*_deploy_lock_single_canonical_identity: an IMMUTABLE deploy_lock_canonical(), a BEFORE
// trigger, and a CHECK constraint that fails closed if the trigger is ever dropped). The live
// behavioural proof is ops_selftest_deploy_lock_exclusive(), which the migration runs before it is
// allowed to ship, and mon_detect_deploy_lock_misuse() reports alias use in production.
//
// THIS file is the hermetic half: no DB, no network, runs in `npm test`. It exists because the DB
// guard can only defend the DB — a *new caller* invented in the repo with a fresh alias, or someone
// deleting the alias set, must fail CI before it ever reaches production.
//
//   node --experimental-strip-types scripts/verify-deploy-lock-canonical.ts

import { readFileSync, readdirSync } from 'node:fs';

let failed = 0;
const ok = (s: string) => console.log(`  ok    ${s}`);
const bad = (s: string, d: string) => { failed++; console.log(`  FAIL  ${s}\n        ${d}`); };

const root = new URL('../', import.meta.url);
const migDir = new URL('supabase/migrations/', root);

// ---------------------------------------------------------------------------
// 1. The canonicalisation migration must exist and be committed.
// ---------------------------------------------------------------------------
console.log('\n1) the canonical-identity migration is committed');
const migFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const canonMigs = migFiles.filter((f) =>
  readFileSync(new URL(f, migDir), 'utf8').includes('create or replace function public.deploy_lock_canonical'));

if (canonMigs.length === 0) {
  bad('deploy_lock_canonical() is defined in a committed migration',
      'no migration defines it — production and git would diverge on the safety gate itself');
} else {
  ok(`deploy_lock_canonical() defined in ${canonMigs.join(', ')}`);
}

const canonSql = canonMigs.map((f) => readFileSync(new URL(f, migDir), 'utf8')).join('\n');

// ---------------------------------------------------------------------------
// 2. The alias set must cover the aliases we have actually been bitten by, and the enforcement
//    mechanisms must all be present. Losing any one of them silently re-opens the hole.
// ---------------------------------------------------------------------------
console.log('\n2) alias coverage + defence in depth');
// The SQL must use the PREFIX rule, not an enumerated list — 'prod-change' proved enumeration loses.
if (/\^prod/.test(canonSql)) ok("SQL uses the '^prod' prefix rule (catches unforeseen prod* names)");
else bad("SQL uses the '^prod' prefix rule", "no '^prod' pattern found — an enumerated allowlist misses names like 'prod-change'");
for (const alias of ['prd', 'live', 'deploy']) {
  if (new RegExp(`'${alias}'`).test(canonSql)) ok(`non-prod* alias '${alias}' is mapped`);
  else bad(`non-prod* alias '${alias}' is mapped`, `not found — '${alias}' would fork the lock`);
}
for (const [needle, why] of [
  ['before insert or update on public.ops_deploy_lock', 'the BEFORE trigger that normalises direct writes'],
  ['ops_deploy_lock_name_is_canonical', 'the CHECK constraint that fails closed if the trigger is dropped'],
  ['ops_selftest_deploy_lock_exclusive', 'the live exclusivity self-test'],
  ['mon_detect_deploy_lock_misuse', 'the production monitor for alias use / rejected writers'],
] as const) {
  if (canonSql.includes(needle)) ok(`present: ${why}`);
  else bad(`present: ${why}`, `"${needle}" missing from the migration`);
}

// ---------------------------------------------------------------------------
// 3. Model the SQL rule and assert the behaviour, so the intent is pinned in executable form.
//    Kept deliberately in sync with the SQL by the token assertions in (2) above.
// ---------------------------------------------------------------------------
console.log('\n3) canonicalisation behaviour');
// A PREFIX rule, not an allowlist. An enumerated set is not enough: within minutes of finding
// 'prod' a third session appeared holding 'prod-change' (holder audit-fix-2026-08-10, 12:22:29Z) —
// a name no allowlist would have predicted. Anything named prod* is production-scoped, and
// serialising it against deploys is the safe default; a genuinely separate resource is named for
// the resource ('gathern_liveness_apply'), never prod*.
const EXTRA_ALIASES = new Set(['prd', 'live', 'livedb', 'liveprod', 'deploy', 'deployment', 'deploylock']);
const canonical = (n: string) => {
  const skeleton = (n ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (skeleton.startsWith('prod') || EXTRA_ALIASES.has(skeleton))
    ? 'production'
    : (n ?? '').trim().toLowerCase();
};

for (const alias of ['production', 'prod', 'PROD', 'Prod', 'prd', 'prod-db', 'PROD_DB', 'proddb',
                     'prod-change', 'PROD-CHANGE', 'prod_change', 'production-deploy',
                     'live', 'deploy', 'deployment', ' production ']) {
  const got = canonical(alias);
  if (got === 'production') ok(`'${alias}' → production`);
  else bad(`'${alias}' → production`, `got '${got}' — this alias would create a SECOND lock`);
}

// Unrelated named locks must keep their own identity, or unrelated jobs get serialised/starved.
for (const other of ['gathern_liveness_apply', 'aqar_backfill']) {
  const got = canonical(other);
  if (got === other) ok(`'${other}' keeps its own identity`);
  else bad(`'${other}' keeps its own identity`, `got '${got}' — unrelated locks must not be collapsed`);
}
// …but casing alone must never fork one either.
if (canonical('Gathern_Liveness_Apply') === canonical('gathern_liveness_apply')) {
  ok('casing alone cannot fork a non-production lock');
} else {
  bad('casing alone cannot fork a non-production lock', 'case variants resolve to different identities');
}

// ---------------------------------------------------------------------------
// 4. Every repo caller must use the canonical name (or a deliberately distinct resource).
//    A new caller inventing a fresh alias fails here, before it can reach production.
// ---------------------------------------------------------------------------
console.log('\n4) repo callers use a canonical identity');
const REGISTERED_DISTINCT = new Set(['gathern_liveness_apply']);
const scan: string[] = [];
for (const dir of ['scripts', 'scrapers']) {
  const walk = (u: URL, rel: string) => {
    for (const e of readdirSync(u, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__pycache__') continue;
      if (e.isDirectory()) walk(new URL(`${e.name}/`, u), `${rel}${e.name}/`);
      else if (/\.(ts|py|sh)$/.test(e.name)) scan.push(`${rel}${e.name}`);
    }
  };
  walk(new URL(`${dir}/`, root), `${dir}/`);
}

let callers = 0;
const SELF = 'scripts/verify-deploy-lock-canonical.ts';
for (const rel of scan) {
  if (rel === SELF) continue; // this guard quotes alias names as test data; it is not a caller
  const src = readFileSync(new URL(rel, root), 'utf8');
  if (!/acquire_deploy_lock|release_deploy_lock/.test(src)) continue;
  // Lock names appear as an assigned constant (LOCK_NAME="…") in every current caller.
  for (const m of src.matchAll(/LOCK_NAME\s*=\s*["']([^"']+)["']/g)) {
    callers++;
    const name = m[1];
    if (canonical(name) === 'production' && name !== 'production') {
      bad(`${rel}: LOCK_NAME='${name}'`,
          `it is a production alias — use the canonical 'production' literal so the intent is readable`);
    } else if (canonical(name) !== 'production' && !REGISTERED_DISTINCT.has(name)) {
      bad(`${rel}: LOCK_NAME='${name}'`,
          `unregistered lock identity. If it is genuinely a separate resource, add it to ` +
          `REGISTERED_DISTINCT here and to mon_detect_deploy_lock_misuse's known list.`);
    } else {
      ok(`${rel}: LOCK_NAME='${name}'`);
    }
  }
}
if (callers === 0) bad('repo callers discovered', 'found none — the LOCK_NAME scan has drifted');

// ---------------------------------------------------------------------------
// 5. LAYER 1, repo-wide: no file may ASK for the lock under an alias — not code, not a workflow,
//    not an instruction in a doc. The DB barrier (layer 2) normalises aliases, but an instruction
//    that tells the next agent to say 'prod' is still a bug: it teaches the wrong habit and it is
//    exactly how 'prod' and 'prod-change' got into production routines in the first place.
// ---------------------------------------------------------------------------
console.log('\n5) no alias literal in any acquire/release call, anywhere in the repo');
const SCAN_EXT = /\.(ts|tsx|js|py|sh|ya?ml|md|sql|json)$/;
// The canonicalisation migration deliberately CALLS every alias to prove they are refused, and this
// guard quotes them as test data. Both are allowlisted by exact path.
const ALIAS_CALL_EXEMPT = new Set<string>([SELF]);
const allFiles: string[] = [];
const walkAll = (u: URL, rel: string) => {
  for (const e of readdirSync(u, { withFileTypes: true })) {
    if (['node_modules', '.git', '__pycache__', 'dist', 'build', '.expo'].includes(e.name)) continue;
    if (e.isDirectory()) walkAll(new URL(`${e.name}/`, u), `${rel}${e.name}/`);
    else if (SCAN_EXT.test(e.name)) allFiles.push(`${rel}${e.name}`);
  }
};
walkAll(root, '');

const CALL_LITERAL = /(?:acquire|release)_deploy_lock\s*\(\s*['"]([^'"]+)['"]/g;
let aliasCalls = 0, scanned = 0;
for (const rel of allFiles) {
  if (ALIAS_CALL_EXEMPT.has(rel)) continue;
  // The self-test migration proves aliases are REFUSED, so it must be allowed to name them.
  const isSelftestMigration = rel.startsWith('supabase/migrations/') &&
    readFileSync(new URL(rel, root), 'utf8').includes('ops_selftest_deploy_lock_exclusive');
  if (isSelftestMigration) continue;
  scanned++;
  const src = readFileSync(new URL(rel, root), 'utf8');
  for (const m of src.matchAll(CALL_LITERAL)) {
    const name = m[1];
    if (name.startsWith('<')) continue; // documentation placeholder like '<holder>'
    if (canonical(name) === 'production' && name !== 'production') {
      aliasCalls++;
      bad(`${rel}: ${m[0].slice(0, 60)}…`,
          `asks for the production lock as '${name}'. Use the canonical 'production'. The DB now ` +
          `normalises it, but layer 1 is asking correctly — an alias here teaches the next agent wrong.`);
    } else if (canonical(name) !== 'production' && !REGISTERED_DISTINCT.has(name)) {
      aliasCalls++;
      bad(`${rel}: ${m[0].slice(0, 60)}…`, `unregistered lock identity '${name}'.`);
    }
  }
}
if (aliasCalls === 0) ok(`no alias literals across ${scanned} scanned files`);

console.log(failed === 0
  ? '\n✓ the production deploy lock has exactly one identity.\n'
  : `\n✗ ${failed} check(s) failed — an alias could fork the production lock.\n`);
process.exit(failed === 0 ? 0 : 1);
