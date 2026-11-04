// HARAJ'S DIRECT ALIVE VERDICT COUNTS AS "REFRESHED" — AND NOBODY ELSE'S DOES (owner decision 7, 2026-11-04).
//
// refresh_coverage:haraj (P1) sat open from 2026-10-30 reading «only 6.5% of 16,175 active rows were
// re-seen inside the 72h window», while scrapers/haraj/run.py:_verify_gone was re-reading every one of
// those rows' own pages and stamping last_verified_alive_at (16,195 of 16,197 inside the window,
// measured 2026-11-04). haraj is a STREAM of new posts; no crawl can re-see an old post, so
// last_seen_at alone can never cover it. The owner ruled: for haraj (feed-only) a direct own-page
// liveness verdict counts as refreshed, for refresh_coverage and for the stale gate.
//
// What this file pins, by EXECUTING scripts/lib/refreshCoverage.ts and reading the migration back:
//   1. the feed_only array the production SQL declares is exactly FEED_ONLY_PLATFORMS (['haraj']);
//   2. the SQL chooses greatest(last_seen_at, last_verified_alive_at) ONLY when rec.p = any(feed_only)
//      and keeps last_seen_at for everybody else — a fleet-wide greatest() would let a liveness oracle
//      hide a dead crawl on every catalogue platform;
//   3. no LATER migration redefines mon_detect_refresh_coverage without carrying feed_only;
//   4. the stale sweep (mark_stale_listings_inactive mirror) reads greatest(...) too — the second half
//      of the owner's sentence.
// Mutation proofs below show each limb fails on the defect it exists for.
//
//   node --experimental-strip-types scripts/verify-feed-only-refresh-counts-direct-verdict.ts  (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FEED_ONLY_PLATFORMS, coveragePct, feedOnlyFromSql, rowRefreshed } from './lib/refreshCoverage.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase/migrations');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED');

console.log('\nFeed-only platforms count a direct ALIVE verdict as refreshed (owner decision 7)\n');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const fo = files.filter((f) => /_feed_only_refresh_counts_direct_verdict\.sql$/.test(f));
check('exactly one committed migration carries the feed-only refresh edit', fo.length === 1, `found ${fo.length}`);
const foFile = fo[0] ?? '';
const sql = foFile ? readFileSync(join(MIG, foFile), 'utf8') : '';

// 1. the array
const arr = feedOnlyFromSql(sql);
check(`the SQL's feed_only array is ${JSON.stringify(FEED_ONLY_PLATFORMS)}`,
  JSON.stringify(arr) === JSON.stringify(FEED_ONLY_PLATFORMS), `SQL says ${JSON.stringify(arr)}`);

// 2. the choice is conditional on feed_only, and the crawl-only column stays the default
const choice = /case\s+when\s+rec\.p\s*=\s*any\(feed_only\)\s+then\s+'greatest\(last_seen_at,\s*last_verified_alive_at\)'\s+else\s+'last_seen_at'\s+end/i;
check('the SQL counts greatest(...) only for feed_only and last_seen_at for every other platform',
  choice.test(sql));
check('the SQL is md5-anchored on the function it edits (fails closed if production moved)',
  /md5\(src\)\s*<>\s*'[0-9a-f]{32}'/.test(sql));

// 3. no later redefinition drops it
const later = files.filter((f) => f > foFile && foFile !== '');
const redefs = later.filter((f) => {
  const s = readFileSync(join(MIG, f), 'utf8');
  return /mon_detect_refresh_coverage/.test(s) && /create\s+or\s+replace\s+function\s+public\.mon_detect_refresh_coverage/i.test(s);
});
const dropped = redefs.filter((f) => !/feed_only/.test(readFileSync(join(MIG, f), 'utf8')));
check('no later migration redefines mon_detect_refresh_coverage without feed_only', dropped.length === 0,
  dropped.join(', '));

// 4. the stale gate half
const stale = readFileSync(join(ROOT, 'sql/mirrors/mark_stale_listings_inactive.sql'), 'utf8');
check('the stale sweep mirror counts greatest(last_seen_at, last_verified_alive_at) in its coverage gate',
  /greatest\(last_seen_at, last_verified_alive_at\) > now\(\) - make_interval/.test(stale));

// ── the predicate, executed ─────────────────────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
const H = 3600_000;
const verifiedOnly = { lastSeenAt: NOW - 400 * H, lastVerifiedAliveAt: NOW - 5 * H };
const seenOnly = { lastSeenAt: NOW - 5 * H, lastVerifiedAliveAt: null };
const neither = { lastSeenAt: NOW - 400 * H, lastVerifiedAliveAt: NOW - 300 * H };

check('a haraj row proven ALIVE by its own page inside the window counts as refreshed',
  rowRefreshed('haraj', verifiedOnly, NOW, 72));
check('a haraj row re-seen by the crawl still counts (greatest ignores NULL)',
  rowRefreshed('haraj', seenOnly, NOW, 72));
check('a haraj row with neither stamp inside the window is NOT refreshed (a stale row still alarms)',
  !rowRefreshed('haraj', neither, NOW, 72));
check('a catalogue platform (aqar) row proven only by its oracle is NOT refreshed — the crawl is measured',
  !rowRefreshed('aqar', verifiedOnly, NOW, 24));

// The measured 2026-11-04 haraj population, shape-for-shape: 1,052 crawl-seen, 15,143 oracle-only, 2 neither.
const pop = [
  ...Array(1052).fill(seenOnly), ...Array(15143).fill(verifiedOnly), ...Array(2).fill(neither),
];
const pct = coveragePct('haraj', pop, NOW, 72);
check(`the measured haraj population reads ${pct}% (>= 50, so refresh_coverage:haraj clears)`, pct >= 50);

mustCatch('the pre-fix detector (crawl only) — it reads haraj below the 20% critical bar',
  coveragePct('haraj', pop, NOW, 72, []) < 20);
mustCatch('a fleet-wide greatest() — it would let aqar\'s oracle hide a dead aqar crawl',
  rowRefreshed('aqar', verifiedOnly, NOW, 24, ['haraj', 'aqar']) === true);
mustCatch('a feed_only array that drifts from the TS constant',
  JSON.stringify(feedOnlyFromSql("feed_only constant text[] := array['haraj','aqar'];")) !== JSON.stringify(FEED_ONLY_PLATFORMS));
mustCatch('an unconditional greatest() in the SQL',
  !choice.test("execute format('... where greatest(last_seen_at, last_verified_alive_at) > ...')"));
mustCatch('a SQL with no feed_only array at all', feedOnlyFromSql('select 1') === null);

console.log('');
console.log(failed === 0 ? 'PASS — feed-only refresh counts the direct verdict; catalogues still measure the crawl.'
  : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
