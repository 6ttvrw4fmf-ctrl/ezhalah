// THE POST-DELETE AUDIT SAMPLES EVERY SITE THE DELETER DELETES ON — hermetic barrier (2026-11-03).
//
// .github/workflows/verify-deletions.yml re-probes a sample of permanently deleted listings per
// platform (the independent second opinion behind mon_detect_deleted_but_source_live). Its matrix
// was a hand-typed list, [aqar, wasalt, gathern, aqarcity], "kept in sync" with
// scrapers/common/cleanup.py's PLATFORMS by a comment. The engine grew to nine sites on 2026-09-28
// and the list did not: by 2026-11-03 raghdan had 279 permanent deletions, aqarmonthly 90, mizlaj 3,
// nowaisiry 2 — none ever sampled — and mon_detect_lifecycle_deletion_audit_unconfirmed read
// NEVER_AUDITED on all four for up to five weeks.
//
// The repair removes the list: a `plan` job imports cleanup.PLATFORMS and the matrix is
// fromJSON(needs.plan.outputs.platforms). This file proves, against the real workflow text, that
//   1. the verify job's matrix comes from the plan output (no literal list),
//   2. the plan job reads PLATFORMS from scrapers.common.cleanup and writes `platforms=` to GITHUB_OUTPUT,
//   3. every platform registered in cleanup.PLATFORMS today would be covered (parsed from the dict),
// and it mutation-tests itself on the old workflow shape, which must FAIL.
//
// Run: node --experimental-strip-types scripts/verify-deletion-audit-covers-every-deleter.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = readFileSync(join(ROOT, '.github/workflows/verify-deletions.yml'), 'utf8');
const CLEANUP = readFileSync(join(ROOT, 'scrapers/common/cleanup.py'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

/** Platforms the deleter registers: the top-level keys of `PLATFORMS: dict[str, dict] = { ... }`. */
export function deleterPlatforms(py: string): string[] {
  const start = py.search(/^PLATFORMS\s*:\s*dict\[str,\s*dict\]\s*=\s*\{/m);
  if (start < 0) return [];
  const body = py.slice(start);
  const end = body.search(/^\}/m);
  const block = end < 0 ? body : body.slice(0, end);
  return [...block.matchAll(/^ {4}"([a-z0-9_]+)"\s*:/gm)].map((m) => m[1]).sort();
}

/** Problems with how a verify-deletions workflow chooses its platforms; [] = derived from PLATFORMS. */
export function auditCoverageProblems(wf: string, platforms: readonly string[]): string[] {
  const out: string[] = [];
  const literal = wf.match(/^\s*platform:\s*\[([^\]]*)\]/m);
  if (literal) {
    const listed = literal[1].split(',').map((x) => x.trim()).filter(Boolean);
    const missing = platforms.filter((p) => !listed.includes(p));
    out.push(`the matrix is a typed list [${listed.join(', ')}]` +
      (missing.length ? ` — it misses ${missing.join(', ')}` : ' — a typed list drifts; derive it'));
  }
  if (!/^\s*platform:\s*\$\{\{\s*fromJSON\(\s*needs\.plan\.outputs\.platforms\s*\)\s*\}\}/m.test(wf)) {
    out.push('the verify matrix is not fromJSON(needs.plan.outputs.platforms)');
  }
  if (!/^\s*needs:\s*plan\s*$/m.test(wf)) out.push('the verify job does not need: plan');
  if (!/from scrapers\.common\.cleanup import PLATFORMS/.test(wf) || !/'platforms='/.test(wf) ||
      !/GITHUB_OUTPUT/.test(wf)) {
    out.push('the plan job does not write platforms= from scrapers.common.cleanup.PLATFORMS');
  }
  return out;
}

const platforms = deleterPlatforms(CLEANUP);
check('cleanup.PLATFORMS parses to the nine-or-more registered sites',
  platforms.length >= 9 && ['raghdan', 'aqarmonthly', 'mizlaj', 'nowaisiry'].every((p) => platforms.includes(p)),
  `parsed: [${platforms.join(', ')}]`);

const now = auditCoverageProblems(WF, platforms);
check('verify-deletions.yml samples every platform the deleter registers', now.length === 0, now.join('\n      '));

// MUTATION: the exact shape that left four deleters unaudited must be RED.
const OLD = WF
  .replace(/platform:\s*\$\{\{\s*fromJSON\(needs\.plan\.outputs\.platforms\)\s*\}\}/, 'platform: [aqar, wasalt, gathern, aqarcity]');
const old = auditCoverageProblems(OLD, platforms);
check('mutant killed: the old typed four-site matrix is caught, naming what it misses',
  old.some((p) => p.includes('misses') && p.includes('raghdan')), old.join(' | '));
// MUTATION 2: a full typed list is still refused — it is a list someone must remember.
const FULL = WF.replace(/platform:\s*\$\{\{\s*fromJSON\(needs\.plan\.outputs\.platforms\)\s*\}\}/,
  `platform: [${platforms.join(', ')}]`);
check('mutant killed: even a complete typed list is refused (it drifts)', auditCoverageProblems(FULL, platforms).length > 0);
// MUTATION 3: a plan job that reads something else.
const WRONG = WF.replace('from scrapers.common.cleanup import PLATFORMS', 'from scrapers.common.liveness_policies import FLEET_DAILY_DIRECT as PLATFORMS');
check('mutant killed: a plan job reading a different registry is caught', auditCoverageProblems(WRONG, platforms).length > 0);

console.log(failed === 0 ? '\nOK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
