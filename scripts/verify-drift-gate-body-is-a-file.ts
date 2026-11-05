// THE DRIFT GATE SENDS ITS VERSION LIST FROM A FILE, NEVER AS ONE ARGUMENT (2026-11-05).
// scripts/schema-drift-gate.sh POSTs every committed migration version to ops_deploy_preflight_checks. It used
// `curl -d "$BODY"`, one argv string — and Linux caps a single argument at 128 KiB (MAX_ARG_STRLEN). The list crossed
// it on 2026-11-05 (~129 KB, growing a few KB a day): every production deploy died with «/usr/bin/curl: Argument
// list too long», printed as «drift gate could not run (HTTP curl_failed)», and nothing shipped for ~16 hours.
// RULE: in every deploy-path shell script, a curl request body that is a shell variable goes through a file
// (--data-binary @file / -d @file). And the drift body itself is measured here so the margin is visible.
// Run: node --experimental-strip-types scripts/verify-drift-gate-body-is-a-file.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, c: boolean, d = '') => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}${d ? `\n      ${d}` : ''}`); failed++; } };
const mustCatch = (m: string, caught: boolean) => check(`(mutation) catches ${m}`, caught);

/** Line numbers where curl gets a request body as an inline shell variable (an argv string of unbounded size). */
export function argvBodies(sh: string): number[] {
  return sh.split('\n').flatMap((l, i) =>
    /(^|\s)(-d|--data|--data-binary|--data-raw)\s+"\$[A-Za-z_]/.test(l) ? [i + 1] : []);
}

const gate = readFileSync(join(ROOT, 'scripts/schema-drift-gate.sh'), 'utf8');
check('schema-drift-gate.sh passes no request body as an argv string', argvBodies(gate).length === 0, `lines ${argvBodies(gate).join(', ')}`);
check('schema-drift-gate.sh sends the version list with --data-binary @file', /--data-binary @"\$BODY_FILE"/.test(gate));

const require = createRequire(import.meta.url);
const bytes = JSON.stringify({ p_repo_versions: require(join(ROOT, 'scripts/build-repo-migration-versions.cjs')).buildRepoMigrationVersions() }).length;
console.log(`  · drift body today: ${bytes.toLocaleString()} bytes (the argv cap it outgrew: 131,072)`);
check('the drift body is non-trivial (the builder still finds the migrations)', bytes > 10_000, `${bytes} bytes`);

mustCatch('the 2026-11-05 shape: -d "$BODY"', argvBodies('  -d "$BODY" || echo "curl_failed")"').length === 1);
check('a body read from a file is fine', argvBodies('  --data-binary @"$BODY_FILE" || echo x').length === 0);
mustCatch('--data-binary "$BODY" is still argv', argvBodies('curl --data-binary "$BIG" https://x').length === 1);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the drift gate cannot outgrow the argument-length cap');
