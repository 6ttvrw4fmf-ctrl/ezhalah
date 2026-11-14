// A LOCATION POOL THAT GIVES UP IS REPORTED, NOT SILENT (CodeRabbit Majors on #11172, owner followup 3286, 2026-11-08).
// src/data/locations.ts never leaves the city/district box stuck: after the last attempt the pool reads 'error' and the
// caller gets []. That path, and the bounded loc_city_cluster read, used to swallow the failure — a customer saw a box
// that stopped trying and nothing reached Sentry. This check pins that all three report through reportError (warning,
// no user data), with mutation proofs.
//   node --experimental-strip-types scripts/verify-location-pool-failures-are-reported.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'src/data/locations.ts'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

// Each give-up callback is the arrow passed as retryStuck's 2nd argument; its body must call reportError.
const giveUpBodies = (s: string): string[] =>
  [...s.matchAll(/retryStuck\(attempt,\s*\(\)\s*=>\s*\{([\s\S]*?)\n  \}\);/g)].map((m) => m[1]);
const reportsGiveUps = (s: string) => { const b = giveUpBodies(s); return b.length === 2 && b.every((x) => /reportError\(/.test(x)); };
const clusterCatch = (s: string) => {
  const i = s.indexOf('export async function ensureClusterMap'); const j = s.indexOf('export function applyClusterUnion', i);
  const body = i >= 0 && j > i ? s.slice(i, j) : '';
  return /catch \(e\) \{[\s\S]{0,400}reportError\(e,/.test(body) && !/catch \{ read = false; \}/.test(body);
};
const imported = (s: string) => /import \{ reportError \} from '@\/lib\/observability';/.test(s);

check('both pool give-ups (city, district) call reportError', reportsGiveUps(src));
check('the bounded loc_city_cluster read reports its failure', clusterCatch(src));
check('reportError is imported from the one observability module', imported(src));

const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };
mustCatch('the city give-up going silent again', !reportsGiveUps(src.replace(/reportError\(new Error\('city pool load gave up[^\n]*\n/, '\n')));
mustCatch('the district give-up going silent again', !reportsGiveUps(src.replace(/reportError\(new Error\('district pool load gave up[^\n]*\n/, '\n')));
mustCatch('the cluster read swallowing its error again', !clusterCatch(src.replace(/catch \(e\) \{[\s\S]*?\n      \}\n/, 'catch { read = false; }\n')));

if (failed) { console.error(`\n❌ verify-location-pool-failures-are-reported: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-location-pool-failures-are-reported: a pool that gives up reaches Sentry');
