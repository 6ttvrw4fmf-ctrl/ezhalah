// A URL COLLISION HAS THREE HONEST ANSWERS, AND "TOO SMALL TO TELL" IS ONE OF THEM
// (routine-4-search-qa, 2026-09-27).
//
// THE DEFECT THIS PINS. mon_detect_card_link_identity() judges two user-reachable rows in ONE table
// that carry the same source listing_url. Its coarse-source branch is guarded by `rows >= 50`, for a
// reason it states itself: a brand-new table with a handful of rows must not be called coarse on no
// evidence. That caution is right. What was wrong is where the run LANDED when the guard declined —
// the per-listing branch, which then asserted as fact:
//
//     "on this platform a per-listing URL is the norm (100.0% of rows collide), so this is an
//      anomaly rather than the source's page granularity"
//
// With 100% of rows colliding, "a per-listing URL is the norm" is the opposite of what was measured.
// The detector handed the adjudicator a false premise, at P2, in the sentence they use to decide
// whether to drop a row — and §30 (duplicates) and §36 (never modify data to pass a test) both turn
// on exactly that judgement.
//
// MEASURED 2026-09-27 over every *_listings table carrying listing_url. Four tables were classified
// P2-duplicate purely because they sat under the 50-row bar, while eight structurally IDENTICAL
// platforms above it were correctly classified P3-granularity:
//
//   misclassified: alajlan 10 rows/1.0000 · rawaf 19/1.0000 · hasaad 12/0.9167 · azure 32/0.9063
//   correct today: rakez 3574/0.9922 · wahadat 968/0.9876 · razre 57/0.9825 · expattrusted 50/0.9600
//                  rightcompound 865/0.9572 · compoundin 186/0.9409 · nufouth_com 118/0.5085 ·
//                  alsaedan 313/0.4345
//   genuine P2s:   almuteb 11/0.1818 · nufouth_res 165/0.1636 · hajer 120/0.0167  (low share)
//
// Every one of the four carries rows_with_a_repeated_ad_number = 0: the source's own identity is
// DISTINCT on every colliding row, so no ad is served as two cards. Source truth for the worst case,
// established before anything was changed: rawaf's 19 rows carry 19 distinct ad_numbers, 14 distinct
// areas, 11 distinct prices and 2 bedroom counts on the single URL https://rawaf.ai/project/114 —
// nineteen different published units of one project.
//
// WHAT THIS CHECK IS. The classifier is reimplemented here as a pure function and EXECUTED over a
// truth table (§1), including the two cases that must STILL reach P2 — because the risk in a change
// like this is not that it mislabels a project page, it is that it silences a real duplicate. §2
// executes the PRE-FIX two-way classifier against the same table and requires it to disagree exactly
// where the defect was. §3 is a consistency read over the committed migration: it cannot execute
// PL/pgSQL, so it asserts the thresholds and the three dedup keys the SQL must carry, and says so
// plainly — a consistency assertion complementing the executed predicate above, never a substitute.
//
// Hermetic: reads one committed file and runs pure functions. No network, no database.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATION = '20260927085924_card_link_identity_small_table_granularity_is_unproven_not_per_listing.sql';

let failures = 0;
const fail = (m: string) => { console.log(`FAIL  ${m}`); failures++; };
const ok = (c: boolean, m: string) => (c ? console.log(`PASS  ${m}`) : fail(m));

// ── the classifier, as the SQL decides it ────────────────────────────────────────────────────────
export const COARSE_SHARE = 0.20;
export const MIN_ROWS = 50;

export type Collision = {
  hasAd: boolean;
  rows: number;
  /** rows sitting on a URL shared with another row, over all user-reachable rows */
  share: number;
  /** rows whose ad_number is REPEATED on a shared URL — the source's own identity */
  repeatAds: number;
  collidingUrls: number;
};

/** What the detector raises. `resolve` means every key is cleared. */
export type Verdict = 'resolve all' | 'P3 granularity' | 'P3 granularity + P2 dupe'
  | 'P3 granularity_unproven' | 'P2 dupe';

export function classifyUrlCollision(c: Collision): Verdict {
  if (c.collidingUrls === 0) return 'resolve all';
  if (c.hasAd && c.rows >= MIN_ROWS && c.share > COARSE_SHARE) {
    return c.repeatAds > 0 ? 'P3 granularity + P2 dupe' : 'P3 granularity';
  }
  // TOO SMALL TO PROVE EITHER NORM — but the source's own identity is distinct, so §30 has nothing
  // to act on. Raised, visible, adjudicable; it claims NEITHER norm.
  if (c.hasAd && c.share > COARSE_SHARE && c.repeatAds === 0) return 'P3 granularity_unproven';
  return 'P2 dupe';
}

/** The classifier as it stood before 2026-09-27: two answers, so a small coarse table got the wrong one. */
function classifyPreFix(c: Collision): Verdict {
  if (c.collidingUrls === 0) return 'resolve all';
  if (c.hasAd && c.rows >= MIN_ROWS && c.share > COARSE_SHARE) {
    return c.repeatAds > 0 ? 'P3 granularity + P2 dupe' : 'P3 granularity';
  }
  return 'P2 dupe';
}

type Case = { label: string; c: Collision; want: Verdict };
const CASES: Case[] = [
  // the four measured misclassifications
  { label: 'alajlan 10 rows, 100% share, distinct ads', want: 'P3 granularity_unproven',
    c: { hasAd: true, rows: 10, share: 1.0, repeatAds: 0, collidingUrls: 1 } },
  { label: 'rawaf 19 rows, 100% share, distinct ads', want: 'P3 granularity_unproven',
    c: { hasAd: true, rows: 19, share: 1.0, repeatAds: 0, collidingUrls: 1 } },
  { label: 'hasaad 12 rows, 91.7% share, distinct ads', want: 'P3 granularity_unproven',
    c: { hasAd: true, rows: 12, share: 0.9167, repeatAds: 0, collidingUrls: 5 } },
  { label: 'azure 32 rows, 90.6% share, distinct ads', want: 'P3 granularity_unproven',
    c: { hasAd: true, rows: 32, share: 0.9063, repeatAds: 0, collidingUrls: 8 } },
  // structurally identical, above the bar — unchanged
  { label: 'rakez 3,574 rows, 99.2% share', want: 'P3 granularity',
    c: { hasAd: true, rows: 3574, share: 0.9922, repeatAds: 0, collidingUrls: 178 } },
  { label: 'expattrusted at EXACTLY the 50-row bar, 96%', want: 'P3 granularity',
    c: { hasAd: true, rows: 50, share: 0.96, repeatAds: 0, collidingUrls: 11 } },
  { label: 'one row under the bar (49), 96% — unproven, not per-listing', want: 'P3 granularity_unproven',
    c: { hasAd: true, rows: 49, share: 0.96, repeatAds: 0, collidingUrls: 11 } },
  // genuine per-listing anomalies — must stay P2
  { label: 'hajer 120 rows, 1.7% share — a per-listing platform colliding by mistake', want: 'P2 dupe',
    c: { hasAd: true, rows: 120, share: 0.0167, repeatAds: 0, collidingUrls: 1 } },
  { label: 'almuteb 11 rows, 18.2% share — under the coarse threshold', want: 'P2 dupe',
    c: { hasAd: true, rows: 11, share: 0.1818, repeatAds: 0, collidingUrls: 1 } },
  { label: 'exactly AT the coarse threshold (0.20) is not above it', want: 'P2 dupe',
    c: { hasAd: true, rows: 10, share: 0.20, repeatAds: 0, collidingUrls: 1 } },
  // THE ONES THAT MATTER: a real duplicate must still be found, at any table size
  { label: 'MUST STAY P2: small, coarse-looking, but a REPEATED ad_number', want: 'P2 dupe',
    c: { hasAd: true, rows: 19, share: 1.0, repeatAds: 4, collidingUrls: 1 } },
  { label: 'MUST STAY P2+P3: large, coarse, with a REPEATED ad_number', want: 'P3 granularity + P2 dupe',
    c: { hasAd: true, rows: 3574, share: 0.9922, repeatAds: 7, collidingUrls: 178 } },
  { label: 'MUST STAY P2: no ad_number, so identity cannot be reasoned about', want: 'P2 dupe',
    c: { hasAd: false, rows: 19, share: 1.0, repeatAds: 0, collidingUrls: 1 } },
  { label: 'no collisions at all clears every key', want: 'resolve all',
    c: { hasAd: true, rows: 100, share: 0, repeatAds: 0, collidingUrls: 0 } },
];

console.log('\n§1 the classifier, executed over every measured and boundary case');
for (const k of CASES) {
  const got = classifyUrlCollision(k.c);
  ok(got === k.want, `${k.label} -> ${got}${got === k.want ? '' : ` (wanted ${k.want})`}`);
}

console.log('\n§2 mutation proof — the pre-fix classifier must disagree exactly where the defect was');
{
  const misclassified = CASES.filter((k) => k.want === 'P3 granularity_unproven');
  ok(misclassified.length >= 4, `${misclassified.length} cases describe the defect shape`);
  for (const k of misclassified) {
    ok(classifyPreFix(k.c) === 'P2 dupe' && classifyUrlCollision(k.c) === 'P3 granularity_unproven',
      `M: pre-fix calls «${k.label}» a P2 duplicate; the fix calls it unproven granularity`);
  }
  // …and must agree everywhere else, so the change is surgical rather than broad.
  for (const k of CASES.filter((x) => x.want !== 'P3 granularity_unproven')) {
    ok(classifyPreFix(k.c) === classifyUrlCollision(k.c),
      `M: unchanged for «${k.label}» (both -> ${k.want})`);
  }
  // The duplicate half is the thing that must never be silenced: prove it survives at every size.
  for (const rows of [2, 10, 19, 49, 50, 3574]) {
    const v = classifyUrlCollision({ hasAd: true, rows, share: 1.0, repeatAds: 1, collidingUrls: 1 });
    ok(v.includes('P2 dupe'), `M: a repeated ad_number still raises P2 at ${rows} rows (-> ${v})`);
  }
}

console.log('\n§3 the committed migration carries the same thresholds and keys (consistency read — see header)');
{
  const dir = join(ROOT, 'supabase', 'migrations');
  const present = readdirSync(dir).includes(MIGRATION);
  ok(present, `${MIGRATION} is committed`);
  if (present) {
    const sql = readFileSync(join(dir, MIGRATION), 'utf8');
    ok(/c_coarse_share\s+constant\s+numeric\s*:=\s*0\.20\b/.test(sql),
      `SQL coarse-share threshold is ${COARSE_SHARE}, matching this file`);
    ok(/c_min_rows\s+constant\s+int\s*:=\s*50\b/.test(sql),
      `SQL min-rows threshold is ${MIN_ROWS}, matching this file`);
    for (const key of ['card_link_identity:dupe:', 'card_link_identity:granularity:',
      'card_link_identity:granularity_unproven:']) {
      ok(sql.includes(key), `SQL carries the dedup key ${key}<table>`);
    }
    // The new branch must clear the two keys it supersedes, or a table would hold a stale P2 for ever.
    const branch = sql.slice(sql.indexOf('TOO SMALL TO PROVE EITHER NORM'));
    ok(/mon_resolve_key\('card_link_identity', 'card_link_identity:dupe:'/.test(branch),
      'the unproven branch RESOLVES the stale P2 dupe key it replaces');
    ok(/mon_resolve_key\('card_link_identity', 'card_link_identity:granularity:'/.test(branch),
      'the unproven branch resolves the granularity key too');
    // It must never be reachable with a repeated ad_number.
    ok(/elsif v_has_ad and v_share > c_coarse_share and coalesce\(v_repeat_ads, 0\) = 0 then/.test(sql),
      'the unproven branch is guarded on repeat_ads = 0, so a real duplicate cannot enter it');
    ok(!/on this platform a per-listing URL is the norm \(' \|\|\s*\n?\s*round/.test(sql)
       || /when v_share > c_coarse_share then/.test(sql),
      'the per-listing sentence is now conditional on the share actually measured');
  }
}

console.log(`\n${failures === 0 ? '✓ card-link-identity classification holds' : `✗ ${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
