// No-bypass static guard (owner P0 2026-07-21): make it impossible for a future deploy script,
// workflow, or automation to push the frontend live WITHOUT routing through scripts/safe-deploy.sh
// (which carries the target-lock + alias-propagation guards + the deploy lock).
//
// It scans every TRACKED file for a raw production-deploy Vercel command
// (`vercel --prod|deploy|promote|alias|rollback`, or a `deploy_to_vercel` MCP call) and FAILS if
// one appears anywhere outside the small, explicitly-sanctioned set of deploy scripts. A new
// GitHub workflow that ran `vercel --prod`, a helper script that shelled out to it, or a stray
// automation would all trip this and go red in CI before they could ever run in production.
//
// Sanctioned (allowed to invoke/reference the raw command): the deploy pipeline itself and docs.
import { spawnSync } from 'node:child_process';

const PATTERN = String.raw`(vercel[[:space:]]+(--prod|deploy|promote|alias|rollback))|deploy_to_vercel`;

const SANCTIONED = new Set([
  'scripts/safe-deploy.sh',        // the one sanctioned deploy entrypoint
  'scripts/emergency-rollback.sh', // the one sanctioned rollback entrypoint
  'scripts/deploy-lock.sh',        // lock helper the above call
  'scripts/deploy-target-guard.sh',// shared guard library (documents the commands in comments)
  'scripts/preflight-verify.sh',   // references the command in comments only
  'scripts/verify-no-vercel-bypass.ts', // this file (contains the pattern itself)
]);

// git grep -I (skip binary) -n (line numbers) -E (extended regex). Exit 0 = matches, 1 = none.
const r = spawnSync('git', ['grep', '-nIE', PATTERN], { encoding: 'utf8' });
if (r.status !== 0 && r.status !== 1) {
  console.error(`❌ no-vercel-bypass: git grep failed (status ${r.status}). ${r.stderr || ''}`);
  process.exit(1);
}

const offenders = (r.stdout || '')
  .split('\n')
  .filter(Boolean)
  .filter((line) => {
    const file = line.slice(0, line.indexOf(':'));
    if (SANCTIONED.has(file)) return false;   // deploy pipeline may reference the command
    if (file.endsWith('.md')) return false;     // docs may mention it
    if (file.startsWith('docs/')) return false; // docs may mention it
    if (file.startsWith('supabase/migrations/')) return false; // migration comments reference it
    return true;
  });

console.log('no-vercel-bypass: raw production-deploy commands must route through safe-deploy.sh');
if (offenders.length > 0) {
  console.error('\n❌ no-vercel-bypass: a raw Vercel production-deploy command was found OUTSIDE the sanctioned deploy scripts.');
  console.error('   These bypass scripts/safe-deploy.sh (target lock + alias assertion + deploy lock) and are forbidden:');
  for (const o of offenders) console.error(`     ${o}`);
  console.error('\n   Route the deploy through scripts/safe-deploy.sh instead. If this is a genuinely new sanctioned');
  console.error('   deploy entrypoint, it MUST carry the same guards AND be added to SANCTIONED in this file (a');
  console.error('   deliberate, reviewed change) — never just to silence the check.');
  process.exit(1);
}

console.log('  ✓ no unsanctioned raw Vercel production-deploy command anywhere in the tree');
console.log('  ✓ no GitHub workflow / script can deploy the frontend without routing through safe-deploy.sh');
console.log('\n✓ no-vercel-bypass: passed.');
