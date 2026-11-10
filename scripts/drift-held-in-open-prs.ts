// DRIFT THAT IS ALREADY SAFE IN AN OPEN PR DOES NOT BLOCK A DEPLOY (owner 2026-11-09: «Yes»).
//
// Why: engineers apply a migration to production and open its PR minutes later. Until that PR merges, the drift gate
// (scripts/schema-drift-gate.sh) refused EVERY frontend deploy — 11-08 21:43 → 11-09 09:00 UTC, five refusals in a row,
// while ~12 migrations each sat in an open PR waiting for CI and a rate-limited CodeRabbit. The gate exists so SQL
// production ran is never lost from git and never hides a duplicate overload (PGRST203, 2026-07-16). An open PR whose
// file is EXACTLY what production ran (ops_migration_sql, same normalisation as the database lane) already holds that
// SQL, so nothing can be lost; the duplicate-overload half of the gate is untouched and still refuses on its own.
//
// Passes ONLY when every missing version has an open PR whose supabase/migrations/<version>_*.sql equals what
// production ran. Anything unreadable, unmatched or different → exit 1 and the gate refuses exactly as before.
//
//   node --experimental-strip-types scripts/drift-held-in-open-prs.ts <preflight-response.json>
//   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + GH_TOKEN; hermetic proof: scripts/verify-drift-held-in-open-prs.ts)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizeMigrationSql } from './lib/migrationDrift.ts';

export type OpenPrFile = { pr: number; path: string; text: string | null };

/** Versions NOT held: no open PR carries a file for it that equals what production ran. Empty list = all held. */
export function unheld(missing: string[], files: OpenPrFile[], applied: Map<string, string | null>): string[] {
  return missing.filter((v) => {
    const prod = applied.get(v);
    if (typeof prod !== 'string' || !prod.trim()) return true;
    return !files.some((f) => f.path.startsWith(`supabase/migrations/${v}_`) && f.path.endsWith('.sql')
      && f.text != null && normalizeMigrationSql(f.text) === normalizeMigrationSql(prod));
  });
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/drift-held-in-open-prs.ts')) {
  const die = (why: string): never => { console.log(`   ✗ drift not held in open PRs: ${why}`); process.exit(1); };
  const URL_BASE = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_BASE || !KEY || !process.env.GH_TOKEN) die('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GH_TOKEN are required');
  const resp = JSON.parse(readFileSync(process.argv[2] ?? die('usage: drift-held-in-open-prs.ts <response.json>'), 'utf8'));
  const missing: string[] = resp.missing_in_git;
  if (!Array.isArray(missing) || !missing.length) die('no missing_in_git list in the response');
  const slug = process.env.GITHUB_REPOSITORY || '6ttvrw4fmf-ctrl/ezhalah';
  const gh = (...a: string[]) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  // CodeRabbit #11469: list EVERY open PR (a 1000 cap that is reached refuses), and page a PR's files past gh's 100-per-PR cap.
  const prs = JSON.parse(gh('pr', 'list', '-R', slug, '--state', 'open', '--limit', '1000', '--json', 'number,headRefOid,files')) as
    Array<{ number: number; headRefOid: string; files: Array<{ path: string }> }>;
  if (prs.length >= 1000) die('1000+ open PRs: the list may be cut short');
  const files: OpenPrFile[] = [];
  for (const p of prs) for (const path of p.files.length < 100 ? p.files.map((f) => f.path)
    : gh('api', '--paginate', `repos/${slug}/pulls/${p.number}/files?per_page=100`, '-q', '.[].filename').split('\n').filter(Boolean)) {
    if (!missing.some((v) => path.startsWith(`supabase/migrations/${v}_`))) continue;
    let text: string | null = null;
    try { text = gh('api', '-H', 'Accept: application/vnd.github.raw', `repos/${slug}/contents/${path}?ref=${p.headRefOid}`); } catch { /* unreadable = not held */ }
    files.push({ pr: p.number, path, text });
  }
  const applied = new Map<string, string | null>();
  for (const v of missing) {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/ops_migration_sql`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_version: v }), signal: AbortSignal.timeout(60_000),
    }).catch((e) => die(`ops_migration_sql(${v}): ${e.message}`));
    if (!r.ok) die(`ops_migration_sql(${v}) http ${r.status}`);
    applied.set(v, await r.json());
  }
  const bad = unheld(missing, files, applied);
  for (const v of missing) {
    const by = files.filter((f) => f.path.startsWith(`supabase/migrations/${v}_`)).map((f) => `#${f.pr}`).join(' ');
    console.log(`   ${bad.includes(v) ? '✗' : '✓'} ${v}${by ? ` (open PR ${by})` : ' (no open PR)'}`);
  }
  if (bad.length) die(`${bad.length} of ${missing.length} have no open PR holding exactly what production ran`);
  console.log(`   ✓ all ${missing.length} missing migration(s) are held byte-exact in open PRs — nothing can be lost`);
}
