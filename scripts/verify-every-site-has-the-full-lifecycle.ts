// EVERY WEBSITE GETS THE FULL LIFECYCLE, AND A NEW ONE CANNOT SILENTLY SKIP IT (owner, 2026-09-28:
// «every website we have, and every NEW one the moment it's added, must have the full lifecycle —
// daily direct check, hide at 3 strikes, delete after 30 days»).
//
// "Full lifecycle" is two registrations, both in code:
//   1. scrapers/common/liveness_policies.py declares the site DIRECT_REVISIT — each listing's own
//      page is re-read on a schedule and three direct "gone" answers hide it (grace 3);
//   2. scrapers/common/cleanup.py PLATFORMS registers its "is this URL really gone?" check — without
//      it the 30-day deletion is default-DENY for that site, however its policy row is set.
//
// The universe is liveness_policies.POLICIES: every production-searchable site must have an entry
// there (verify-liveness-contract.ts fails a scraper directory without one), so a NEW site lands in
// this check the moment it is onboarded. The database's platform_registry is not readable from the
// hermetic suite (AGENTS.md: the required suite is hermetic); POLICIES is its committed mirror.
//
// A site without both is allowed only while it is declared in scrapers/lifecycle-gaps.txt with a date
// and the reason it cannot have them yet. That ledger is SHRINK-ONLY: RATCHET may fall, never rise
// without a reviewed edit, and a site that gains the full lifecycle must leave it (a stale line fails),
// so the ledger cannot rot into wallpaper (the verify-prune-without-oracle-is-declared.ts pattern).
//
// Offline, hermetic, deterministic. Run: node --experimental-strip-types scripts/verify-every-site-has-the-full-lifecycle.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LEDGER = join(ROOT, 'scrapers', 'lifecycle-gaps.txt');
const RATCHET_LIMIT = 139; // the committed ledger's size; may only fall (a new gap is a reviewed raise)

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-every-site-has-the-full-lifecycle: daily direct check + 30-day deletion, or a dated reason.');

// Both registries are READ BY EXECUTION. liveness_policies is pure; cleanup.py reaches the Supabase
// client at import, so its PLATFORMS literal is exec'd out of the real file (the slice
// verify-cleanup-drain-requires-soft-close-marker.ts already uses), with the aqar limb stubbed.
const READ = String.raw`
import json, re, sys
sys.path.insert(0, ".")
from scrapers.common.liveness_policies import POLICIES
src = open("scrapers/common/cleanup.py", encoding="utf-8").read()
ns = {"re": re, "AQAR_DEAD_MARKERS": (), "_aqar_looks_closed": lambda b: False}
exec(compile(src[src.index("def _wasalt_markers("):src.index("DEFAULT_POLICY = {")], "cleanup_slice", "exec"), ns)
print(json.dumps({"policies": {k: r["strategy"] for k, r in POLICIES.items()},
                  "cleanup": sorted(ns["PLATFORMS"])}))
`;
const reg = JSON.parse(
  execFileSync('python3', ['-c', READ], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop() as string,
) as { policies: Record<string, string>; cleanup: string[] };

type Entry = { platform: string; date: string; reason: string };
const parseLedger = (text: string): Entry[] => text.split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [platform, date, ...rest] = l.split('|').map((s) => s.trim()); return { platform, date: date ?? '', reason: rest.join('|').trim() }; });

check(existsSync(LEDGER), 'the gaps ledger is committed', LEDGER);
const ledger = existsSync(LEDGER) ? parseLedger(readFileSync(LEDGER, 'utf8')) : [];

type Verdict = { undeclared: string[]; stale: string[]; ghosts: string[]; malformed: string[]; dupes: string[]; over: boolean };
function judge(policies: Record<string, string>, cleanup: string[], entries: Entry[], ratchet: number): Verdict {
  const full = (p: string) => policies[p] === 'DIRECT_REVISIT' && cleanup.includes(p);
  const listed = entries.map((e) => e.platform);
  return {
    undeclared: Object.keys(policies).filter((p) => !full(p) && !listed.includes(p)).sort(),
    stale: listed.filter((p) => p in policies && full(p)),
    ghosts: listed.filter((p) => !(p in policies)),
    malformed: entries.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.reason.length < 20).map((e) => e.platform),
    dupes: listed.filter((p, i) => listed.indexOf(p) !== i),
    over: entries.length > ratchet,
  };
}

const LIMIT = RATCHET_LIMIT;
const v = judge(reg.policies, reg.cleanup, ledger, LIMIT);

check(Object.keys(reg.policies).length > 100 && reg.cleanup.length >= 4,
  'both registries were read', `${Object.keys(reg.policies).length} policies, ${reg.cleanup.length} cleanup checks`);
check(v.undeclared.length === 0, 'every site has the full lifecycle or a dated reason in scrapers/lifecycle-gaps.txt',
  `MISSING: [${v.undeclared.join(', ')}]. Register the site DIRECT_REVISIT in liveness_policies.py (a daily ` +
  'direct check that hides at 3 strikes) AND its dead-check in cleanup.PLATFORMS (30-day deletion), or ' +
  'add `site | YYYY-MM-DD | why it cannot have them yet` to the ledger and raise RATCHET_LIMIT in review.');
check(v.stale.length === 0, 'no ledger line names a site that already has the full lifecycle',
  `NOW COVERED: [${v.stale.join(', ')}] — delete their lines and lower RATCHET_LIMIT.`);
check(v.ghosts.length === 0, 'every ledger line names a registered site', `UNKNOWN: [${v.ghosts.join(', ')}]`);
check(v.malformed.length === 0, 'every ledger line has a date and a real reason', `[${v.malformed.join(', ')}]`);
check(v.dupes.length === 0, 'no site is listed twice', `[${v.dupes.join(', ')}]`);
check(!v.over, `the ledger has not grown past its ratchet (${ledger.length}/${LIMIT})`,
  'a site joined without the full lifecycle. Raising the ratchet is a reviewed decision, not a formality.');
if (ledger.length < LIMIT) console.log(`  ⓘ ledger is ${LIMIT - ledger.length} shorter than the ratchet — lower RATCHET_LIMIT to ${ledger.length}.`);
const covered = Object.keys(reg.policies).filter((p) => reg.policies[p] === 'DIRECT_REVISIT' && reg.cleanup.includes(p));
console.log(`  ⓘ full lifecycle: ${covered.length} of ${Object.keys(reg.policies).length} sites [${covered.join(', ')}]`);

// ── Fixtures: the rule, executed against the defects it exists for ──────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(fixture) catches ${what}`, 'MUTANT SURVIVED — the rule is blind to the defect it exists for');
const P = { aqar: 'DIRECT_REVISIT', fixturesite: 'CANDIDATE_PLUS_DIRECT' };
mustCatch('a NEW site with neither a daily direct check nor a deletion check, and no ledger line',
  judge(P, ['aqar'], [], 9).undeclared.includes('fixturesite'));
mustCatch('a site with a daily direct check but no deletion check',
  judge({ ...P, fixturesite: 'DIRECT_REVISIT' }, ['aqar'], [], 9).undeclared.includes('fixturesite'));
mustCatch('a site with a deletion check but only crawl presence',
  judge({ ...P, fixturesite: 'CRAWL_PRESENCE_ONLY' }, ['aqar', 'fixturesite'], [], 9).undeclared.includes('fixturesite'));
mustCatch('a ledger line for a site that is now fully covered',
  judge({ ...P, fixturesite: 'DIRECT_REVISIT' }, ['aqar', 'fixturesite'],
    [{ platform: 'fixturesite', date: '2026-09-28', reason: 'a reason long enough to count' }], 9).stale.includes('fixturesite'));
mustCatch('a line with no date or an empty reason',
  judge(P, ['aqar'], [{ platform: 'fixturesite', date: '', reason: 'x' }], 9).malformed.includes('fixturesite'));
mustCatch('a line for a site that does not exist',
  judge(P, ['aqar'], [{ platform: 'ghost', date: '2026-09-28', reason: 'a reason long enough to count' }], 9).ghosts.includes('ghost'));
mustCatch('the ledger growing past its ratchet',
  judge(P, ['aqar'], [{ platform: 'fixturesite', date: '2026-09-28', reason: 'a reason long enough to count' }], 0).over);
mustCatch('the committed ledger missing the fixture site (the real file, one more site)',
  judge({ ...reg.policies, fixturesite: 'CANDIDATE_PLUS_DIRECT' }, reg.cleanup, ledger, LIMIT).undeclared.includes('fixturesite'));

console.log(failed ? `\n❌ verify-every-site-has-the-full-lifecycle: ${failed} check(s) failed.`
  : '\n✅ verify-every-site-has-the-full-lifecycle: all checks passed.');
process.exit(failed ? 1 : 0);
