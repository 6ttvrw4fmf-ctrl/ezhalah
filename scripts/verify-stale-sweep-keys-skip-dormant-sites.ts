// BOTH ALERT KEYS OF THE DAILY STALE SWEEP SKIP DORMANT AND RETIRED SITES (♻️ 2026-11-05, backlog 1329).
//
// mark_stale_listings_inactive() raises two keys per listing table: stale_listings_detected (a report)
// and stale_coverage_gate (the gate withholding stale rows). A site whose platform_registry.status is
// 'dormant' or 'retired' is down at its OWN end: its ads are already out of search and no crawl can
// re-see its rows until it returns, so either key raised for it is true forever and closes never.
// 20261104112551 taught the report key to skip those sites; the gate key was missed, and sadin, senan
// and snam (all dormant) held stale_coverage_gate open from 2026-11-04 05:15 with no event that could
// close it. 20261105111620 added the same skip to the gate.
//
// The function is edited by needle migrations, so its full body lives in the mirror
// sql/mirrors/mark_stale_listings_inactive.sql (kept byte-equal to production by
// verify-sql-mirrors-not-stale). This reads that body: every mon_raise of either key must sit under an
// `if` whose condition carries the dormant/retired skip. Mutation-proven below.
//
//   node --experimental-strip-types scripts/verify-stale-sweep-keys-skip-dormant-sites.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIRROR = join(import.meta.dirname, '..', 'sql', 'mirrors', 'mark_stale_listings_inactive.sql');
const KEYS = ['stale_listings_detected', 'stale_coverage_gate'];
const SKIP = /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.platform_registry\s+pr\s+where\s+pr\.platform\s*=\s*plat\s+and\s+pr\.status\s+in\s*\(\s*'dormant'\s*,\s*'retired'\s*\)\s*\)/i;

export function problems(sql: string): string[] {
  const body = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  const out: string[] = [];
  for (const key of KEYS) {
    const raise = new RegExp(String.raw`mon_raise\(\s*'P\d'\s*,\s*'${key}'`, 'g');
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = raise.exec(body))) {
      n++;
      // The condition that guards this raise: the text between the nearest preceding `if` and `then`.
      const before = body.slice(0, m.index);
      const ifAt = before.search(/\bif\b(?![\s\S]*\bif\b)/i);
      const cond = ifAt >= 0 ? before.slice(ifAt) : '';
      if (!SKIP.test(cond)) out.push(`${key}: raised without the dormant/retired skip in its if-condition`);
    }
    if (n === 0) out.push(`${key}: no mon_raise found — the key moved; re-point this barrier`);
  }
  return out;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const real = readFileSync(MIRROR, 'utf8');
const p = problems(real);
check('both stale-sweep keys skip dormant and retired sites', p.length === 0, p.join('; '));

// Mutation proofs: the barrier must go red on each half losing its skip.
for (const key of KEYS) {
  const at = real.indexOf(`'P2', '${key}'`);
  const ifAt = real.lastIndexOf('    if ', at);
  const thenAt = real.indexOf(' then', ifAt);
  const cond = real.slice(ifAt, thenAt);
  const mutated = real.slice(0, ifAt) + cond.replace(SKIP, 'true') + real.slice(thenAt);
  mustCatch(`${key} losing its skip`, mutated !== real && problems(mutated).length > 0);
}

if (failed) { console.log(`\n❌ verify-stale-sweep-keys-skip-dormant-sites: ${failed} failure(s)`); process.exit(1); }
console.log('\n✅ verify-stale-sweep-keys-skip-dormant-sites');
