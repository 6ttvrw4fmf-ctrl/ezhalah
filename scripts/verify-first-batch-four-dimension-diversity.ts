// FIRST-100 DIVERSITY (owner PERMANENT rule, 2026-09-14). The first «عرض المزيد» batch (up to 100
// shown) must feel curated across four dimensions, in this priority order:
//   1. Platform  — a big platform can never crowd out a smaller one that also matched (2026-07-13).
//   2. Deal (buy vs rent) — only when the user asked for BOTH; alternate right after platform so a
//      single-deal search is unchanged.
//   3. Property type (cleanType) — apartment/villa/land alternate WITHIN each platform's slots. Was
//      multiType-only before today; now always-on.
//   4. Photos    — a leaf preference, not a filter. Within an otherwise-identical group, photo'd
//      listings come first; no-photo listings are still shown, just later. MATCH FIRST holds.
//
// This is a PERMUTATION stage in `verify-match-first-stages-are-order-only.ts`'s registry — it never
// adds a listing, only reorders. That fact is asserted here too.
//
// docs/ARCHITECTURE.md §20 «First-100 diversity» is the canonical statement every engineer reads.
//
//   node --experimental-strip-types scripts/verify-first-batch-four-dimension-diversity.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { interleaveRanked, orderByScope, type RankedRow } from '../src/lib/platformDiversity.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// A synthetic listing shape rich enough for every diversity key the rule spans.
type L = { cleanType?: string | null; rentPeriod?: string | null; deal?: string; photos?: string[] };
const mkRow = (opts: {
  id: number; platform: string; type: string; deal?: 'Buy' | 'Rent'; photos?: boolean; city?: string; rank?: number;
}): RankedRow<L> => ({
  l: {
    cleanType: opts.type,
    rentPeriod: null,
    deal: opts.deal ?? 'Buy',
    photos: opts.photos ? [`p${opts.id}.jpg`] : [],
  },
  platform: opts.platform,
  city: opts.city ?? 'الرياض',
  region: 'منطقة الرياض',
  district: 'حي النرجس',
  source_table: `${opts.platform}_res`,
  rank: opts.rank ?? opts.id,
});

const ids = (rows: RankedRow<L>[]) => rows.map((r) => (r.l as any).__id ?? r.rank).join(',');

console.log('\n── 1. platform stays the outermost diversity key (owner 2026-07-13) ──');
{
  // 10 aqar + 10 wasalt, all same type. Result must alternate them, never AAAA…BBBB.
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 10; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment' }));
  for (let i = 0; i < 10; i++) rows.push(mkRow({ id: 100 + i, platform: 'wasalt', type: 'Apartment' }));
  const out = orderByScope(rows, 'city');
  const platSeq = out.map((r) => r.platform);
  let maxStreak = 1, cur = 1;
  for (let i = 1; i < platSeq.length; i++) { if (platSeq[i] === platSeq[i - 1]) cur++; else cur = 1; if (cur > maxStreak) maxStreak = cur; }
  check('platform round-robin: max same-platform streak on a two-platform even-split is 1', maxStreak === 1, `got ${maxStreak}, seq=${platSeq.join('|')}`);
  check('same-multiset (permutation): every input row appears exactly once', out.length === rows.length && new Set(out.map((r) => r.rank)).size === rows.length);
}

console.log('\n── 2. property type always diversifies (owner 2026-09-14, was multiType-only) ──');
{
  // Single platform, 6 apartments + 6 villas. Under the OLD rule (multiType=false) they came out
  // grouped 6A6V (no cleanType spread). Under the new rule they must alternate: A V A V …
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 6; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment' }));
  for (let i = 0; i < 6; i++) rows.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Villa' }));
  const out = orderByScope(rows, 'city');
  const typeSeq = out.map((r) => r.l.cleanType);
  let sameTypeInARow = 1, worst = 1;
  for (let i = 1; i < typeSeq.length; i++) { if (typeSeq[i] === typeSeq[i - 1]) sameTypeInARow++; else sameTypeInARow = 1; if (sameTypeInARow > worst) worst = sameTypeInARow; }
  check('type diversity is on by default (no multiType flag needed): worst same-type streak ≤ 1', worst === 1, `got streak ${worst}, seq=${typeSeq.join('|')}`);
}

console.log('\n── 3. deal diversifies when opts.mixDeals — buy/rent alternate (owner 2026-09-14) ──');
{
  // Same platform, same type, half Buy half Rent. mixDeals must interleave them; without mixDeals it
  // must NOT (a single-deal search should never accidentally spread by deal).
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', deal: 'Buy' }));
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', deal: 'Rent' }));
  const withMix = orderByScope(rows, 'city', false, false, { mixDeals: true });
  const dealSeq = withMix.map((r) => r.l.deal);
  let worst = 1, cur = 1;
  for (let i = 1; i < dealSeq.length; i++) { if (dealSeq[i] === dealSeq[i - 1]) cur++; else cur = 1; if (cur > worst) worst = cur; }
  check('mixDeals=true: worst same-deal streak ≤ 1 for a 5+5 split', worst === 1, `seq=${dealSeq.join('|')}`);

  const withoutMix = orderByScope(rows, 'city');
  // Without mixDeals, the ONLY remaining diversity key is platform+cleanType, both singletons here,
  // so we should get pure rank order (Buy 1..5 then Rent 100..104). Deal is NOT spread.
  const withoutSeq = withoutMix.map((r) => r.l.deal);
  const separated = withoutSeq.slice(0, 5).every((d) => d === withoutSeq[0]);
  check('mixDeals=false (default): a single-deal-search shape is preserved, deals not artificially spread',
    separated, `seq=${withoutSeq.join('|')}`);
}

console.log('\n── 4. photo preference: within an otherwise-identical group, photo\'d come first ──');
{
  // 4 rows same platform, same type, same rank pool. Half with photos, half without.
  // preferPhotos=true → the 2 photo'd rows come before the 2 without.
  const rows: RankedRow<L>[] = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment', photos: false, rank: 1 }),
    mkRow({ id: 2, platform: 'aqar', type: 'Apartment', photos: true, rank: 2 }),
    mkRow({ id: 3, platform: 'aqar', type: 'Apartment', photos: false, rank: 3 }),
    mkRow({ id: 4, platform: 'aqar', type: 'Apartment', photos: true, rank: 4 }),
  ];
  const withPhoto = orderByScope(rows, 'city', false, false, { preferPhotos: true });
  const firstTwoHavePhotos = (withPhoto[0].l.photos?.length ?? 0) > 0 && (withPhoto[1].l.photos?.length ?? 0) > 0;
  check('preferPhotos=true: the first two rows carry photos (no-photo pushed down)', firstTwoHavePhotos,
    `photos=${withPhoto.map((r) => (r.l.photos?.length ?? 0) > 0 ? 'Y' : 'N').join('|')}`);
  // MATCH FIRST: no-photo rows are still present, just later — never removed.
  check('preferPhotos=true: no-photo rows still present (never removed, MATCH FIRST)', withPhoto.length === 4);
}

console.log('\n── 5. registered as a PERMUTATION stage in match-first (never adds or drops a row) ──');
{
  // Direct assertion using orderByScope over a synthetic pool.
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 30; i++) {
    rows.push(mkRow({
      id: i + 1,
      platform: i % 3 === 0 ? 'aqar' : i % 3 === 1 ? 'wasalt' : 'gathern',
      type: i % 2 === 0 ? 'Apartment' : 'Villa',
      deal: i % 4 === 0 ? 'Rent' : 'Buy',
      photos: i % 5 !== 0,
      rank: i,
    }));
  }
  const out = orderByScope(rows, 'city', false, false, { mixDeals: true, preferPhotos: true });
  const inIds = new Set(rows.map((r) => r.rank));
  const outIds = new Set(out.map((r) => r.rank));
  check('output has the SAME multiset of ids as input (permutation only, MATCH FIRST holds)',
    inIds.size === outIds.size && [...inIds].every((id) => outIds.has(id)));
  check('output length equals input length (no dedup, no truncation)', out.length === rows.length);
}

console.log('\n── 6. remote.ts calls orderByScope with the new options — this rule is wired, not decorative ──');
{
  const src = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
  check('mixDeals is derived from q.bothDeals || q.dealCombined (the two combined-deal flags)',
    /const mixDeals = !!\(q\.bothDeals \|\| q\.dealCombined\);/.test(src));
  check('orderByScope is called with { mixDeals, preferPhotos: true }',
    /orderByScope\([\s\S]{0,400}?\{\s*mixDeals,\s*preferPhotos:\s*true\s*\}/.test(src));
}

console.log('\n── mutation proof: this check fails on each regression it exists to catch ──');
{
  // Mutation A: type diversity turned back off (revert to multiType-only). Rebuild the platformDiversity
  // module's public entry with a stub orderByScope that omits cleanType from the keys — the test
  // above would then see 6A6V clumping.
  const rowsSameType = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment' }),
    mkRow({ id: 2, platform: 'aqar', type: 'Apartment' }),
    mkRow({ id: 3, platform: 'aqar', type: 'Apartment' }),
    mkRow({ id: 4, platform: 'aqar', type: 'Villa' }),
    mkRow({ id: 5, platform: 'aqar', type: 'Villa' }),
    mkRow({ id: 6, platform: 'aqar', type: 'Villa' }),
  ];
  // Simulate the regression: interleaveRanked without cleanType key just returns by rank (all types clump).
  const clumped = interleaveRanked(rowsSameType, []);
  const clumpedTypes = clumped.map((r) => r.l.cleanType);
  let worstClump = 1, cur = 1;
  for (let i = 1; i < clumpedTypes.length; i++) { if (clumpedTypes[i] === clumpedTypes[i - 1]) cur++; else cur = 1; if (cur > worstClump) worstClump = cur; }
  mustCatch('the type-diversity regression (single-platform 3A3V clumps to a run of 3 when cleanType is dropped)',
    worstClump >= 3);

  // Mutation B: photo preference dropped. interleaveRanked without opts.preferPhotos does pure rank
  // order, so the first row would NOT necessarily carry a photo when rank=1 has none.
  const rowsPhotoMix = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment', photos: false, rank: 1 }),
    mkRow({ id: 2, platform: 'aqar', type: 'Apartment', photos: true, rank: 2 }),
  ];
  const noPref = interleaveRanked(rowsPhotoMix, []);
  mustCatch('the photo-preference regression (without preferPhotos, a no-photo rank-1 row leads)',
    (noPref[0].l.photos?.length ?? 0) === 0);

  // Mutation C: mixDeals turned off. Without deal in the keys, buy/rent do not alternate.
  const rowsDealMix: RankedRow<L>[] = [];
  for (let i = 0; i < 3; i++) rowsDealMix.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', deal: 'Buy' }));
  for (let i = 0; i < 3; i++) rowsDealMix.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', deal: 'Rent' }));
  const noDealMix = orderByScope(rowsDealMix, 'city');
  const dealSeq = noDealMix.map((r) => r.l.deal);
  const firstThreeSameDeal = dealSeq.slice(0, 3).every((d) => d === dealSeq[0]);
  mustCatch('the deal-diversity regression (without mixDeals, buy/rent do NOT alternate — they cluster)',
    firstThreeSameDeal);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll first-batch four-dimension-diversity checks passed');
process.exit(failed ? 1 : 0);
