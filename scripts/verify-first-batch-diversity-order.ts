// FIRST-100 DIVERSITY ORDER (owner PERMANENT rule, 2026-09-14). The first «عرض المزيد» batch (up to
// 100 shown) must feel curated across FIVE dimensions, in this exact PRIORITY (outermost → innermost):
//   1. Platform         — a big platform can never crowd out a smaller one that also matched (2026-07-13).
//   2. Deal (buy/rent)  — only when the user asked for BOTH; alternates right after platform.
//   3. Property type    — apartment/villa/land alternate within each platform's slots (always-on).
//   4. District (+ city/region) — spread across districts of the chosen city; sits BETWEEN type and
//      photos ("between the third and the fourth", owner 2026-09-14). Was previously nested ABOVE type.
//   5. Photos           — a leaf preference, not a filter: photo'd listings come first, no-photo ones
//      still shown, just later. MATCH FIRST holds.
//
// This is a PERMUTATION stage in `verify-match-first-stages-are-order-only.ts`'s registry — it never
// adds a listing, only reorders. Asserted here too.
//
// docs/ARCHITECTURE.md §20 «First-100 diversity» is the canonical statement every engineer reads.
//
//   node --experimental-strip-types scripts/verify-first-batch-diversity-order.ts   (in `npm test`)

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
  id: number; platform: string; type: string; deal?: 'Buy' | 'Rent'; photos?: boolean; district?: string; city?: string; rank?: number;
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
  district: opts.district ?? 'حي النرجس',
  source_table: `${opts.platform}_res`,
  rank: opts.rank ?? opts.id,
});

const worstStreak = <T>(seq: T[]): number => {
  let worst = 1, cur = 1;
  for (let i = 1; i < seq.length; i++) { if (seq[i] === seq[i - 1]) cur++; else cur = 1; if (cur > worst) worst = cur; }
  return seq.length ? worst : 0;
};

console.log('\n── 1. platform stays the outermost diversity key (owner 2026-07-13) ──');
{
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 10; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment' }));
  for (let i = 0; i < 10; i++) rows.push(mkRow({ id: 100 + i, platform: 'wasalt', type: 'Apartment' }));
  const out = orderByScope(rows, 'city');
  check('platform round-robin: max same-platform streak on a two-platform even-split is 1',
    worstStreak(out.map((r) => r.platform)) === 1, `seq=${out.map((r) => r.platform).join('|')}`);
  check('same-multiset (permutation): every input row appears exactly once',
    out.length === rows.length && new Set(out.map((r) => r.rank)).size === rows.length);
}

console.log('\n── 2. property type always diversifies (owner 2026-09-14, was multiType-only) ──');
{
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 6; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment' }));
  for (let i = 0; i < 6; i++) rows.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Villa' }));
  const out = orderByScope(rows, 'city');
  check('type diversity is on by default (no multiType flag needed): worst same-type streak ≤ 1',
    worstStreak(out.map((r) => r.l.cleanType)) === 1, `seq=${out.map((r) => r.l.cleanType).join('|')}`);
}

console.log('\n── 3. deal diversifies when opts.mixDeals — buy/rent alternate (owner 2026-09-14) ──');
{
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', deal: 'Buy' }));
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', deal: 'Rent' }));
  const withMix = orderByScope(rows, 'city', false, false, { mixDeals: true });
  check('mixDeals=true: worst same-deal streak ≤ 1 for a 5+5 split',
    worstStreak(withMix.map((r) => r.l.deal)) === 1, `seq=${withMix.map((r) => r.l.deal).join('|')}`);
  const withoutSeq = orderByScope(rows, 'city').map((r) => r.l.deal);
  check('mixDeals=false (default): a single-deal-search shape is preserved, deals not artificially spread',
    withoutSeq.slice(0, 5).every((d) => d === withoutSeq[0]), `seq=${withoutSeq.join('|')}`);
}

console.log('\n── 4. DISTRICT diversifies for a city search — sits BETWEEN type and photos (owner 2026-09-14) ──');
{
  // Single platform, single type, single deal — so the ONLY live diversity key left is DISTRICT.
  // 5 listings in النرجس + 5 in العارض. They must alternate, not clump 5+5.
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', district: 'حي النرجس' }));
  for (let i = 0; i < 5; i++) rows.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', district: 'حي العارض' }));
  const out = orderByScope(rows, 'city');
  check('district round-robin: worst same-district streak ≤ 1 on a 5+5 city search',
    worstStreak(out.map((r) => r.district)) === 1, `seq=${out.map((r) => r.district).join('|')}`);

  // ORDER PROOF: type OUTRANKS district. Two types × two districts, and the two types must alternate
  // more tightly than the two districts (type is key #3, district is key #4). Build 2 types × 2
  // districts, 3 each = 12 rows. Because cleanType is the OUTER of the two, the type sequence must be
  // a perfect ABAB (streak 1); the district sequence is spread but nested one level deeper.
  const ord: RankedRow<L>[] = [];
  let id = 1;
  for (const t of ['Apartment', 'Villa']) for (const d of ['حي النرجس', 'حي العارض']) for (let k = 0; k < 3; k++)
    ord.push(mkRow({ id: id++, platform: 'aqar', type: t, district: d }));
  const outOrd = orderByScope(ord, 'city');
  check('property type outranks district: the type sequence alternates tighter (type is key #3, district #4)',
    worstStreak(outOrd.map((r) => r.l.cleanType)) <= worstStreak(outOrd.map((r) => r.district)),
    `typeStreak=${worstStreak(outOrd.map((r) => r.l.cleanType))} districtStreak=${worstStreak(outOrd.map((r) => r.district))}`);
}

console.log('\n── 5. photo preference: within an otherwise-identical group, photo\'d come first ──');
{
  const rows: RankedRow<L>[] = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment', photos: false, rank: 1 }),
    mkRow({ id: 2, platform: 'aqar', type: 'Apartment', photos: true, rank: 2 }),
    mkRow({ id: 3, platform: 'aqar', type: 'Apartment', photos: false, rank: 3 }),
    mkRow({ id: 4, platform: 'aqar', type: 'Apartment', photos: true, rank: 4 }),
  ];
  const withPhoto = orderByScope(rows, 'city', false, false, { preferPhotos: true });
  check('preferPhotos=true: the first two rows carry photos (no-photo pushed down)',
    (withPhoto[0].l.photos?.length ?? 0) > 0 && (withPhoto[1].l.photos?.length ?? 0) > 0,
    `photos=${withPhoto.map((r) => (r.l.photos?.length ?? 0) > 0 ? 'Y' : 'N').join('|')}`);
  check('preferPhotos=true: no-photo rows still present (never removed, MATCH FIRST)', withPhoto.length === 4);
}

console.log('\n── 6. PERMUTATION only — never adds or drops a row (MATCH FIRST) ──');
{
  const rows: RankedRow<L>[] = [];
  for (let i = 0; i < 30; i++) rows.push(mkRow({
    id: i + 1,
    platform: i % 3 === 0 ? 'aqar' : i % 3 === 1 ? 'wasalt' : 'gathern',
    type: i % 2 === 0 ? 'Apartment' : 'Villa',
    deal: i % 4 === 0 ? 'Rent' : 'Buy',
    district: i % 3 === 0 ? 'حي النرجس' : 'حي العارض',
    photos: i % 5 !== 0,
    rank: i,
  }));
  const out = orderByScope(rows, 'city', false, false, { mixDeals: true, preferPhotos: true });
  const inIds = new Set(rows.map((r) => r.rank));
  const outIds = new Set(out.map((r) => r.rank));
  check('output has the SAME multiset of ids as input (permutation only, MATCH FIRST holds)',
    inIds.size === outIds.size && [...inIds].every((idv) => outIds.has(idv)));
  check('output length equals input length (no dedup, no truncation)', out.length === rows.length);
}

console.log('\n── 7. remote.ts calls orderByScope with the new options — wired, not decorative ──');
{
  const src = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
  check('mixDeals is derived from q.bothDeals || q.dealCombined (the two combined-deal flags)',
    /const mixDeals = !!\(q\.bothDeals \|\| q\.dealCombined\);/.test(src));
  check('orderByScope is called with { mixDeals, preferPhotos: true }',
    /orderByScope\([\s\S]{0,400}?\{\s*mixDeals,\s*preferPhotos:\s*true\s*\}/.test(src));
}

console.log('\n── mutation proof: this check fails on each regression it exists to catch ──');
{
  // Mutation A: property-type diversity dropped (interleaveRanked without cleanType → all types clump).
  const rowsSameType: RankedRow<L>[] = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment' }), mkRow({ id: 2, platform: 'aqar', type: 'Apartment' }),
    mkRow({ id: 3, platform: 'aqar', type: 'Apartment' }), mkRow({ id: 4, platform: 'aqar', type: 'Villa' }),
    mkRow({ id: 5, platform: 'aqar', type: 'Villa' }), mkRow({ id: 6, platform: 'aqar', type: 'Villa' }),
  ];
  mustCatch('the type-diversity regression (single-platform 3A3V clumps to a run of 3 when cleanType is dropped)',
    worstStreak(interleaveRanked(rowsSameType, []).map((r) => r.l.cleanType)) >= 3);

  // Mutation B: photo preference dropped → a no-photo rank-1 row leads.
  const rowsPhotoMix: RankedRow<L>[] = [
    mkRow({ id: 1, platform: 'aqar', type: 'Apartment', photos: false, rank: 1 }),
    mkRow({ id: 2, platform: 'aqar', type: 'Apartment', photos: true, rank: 2 }),
  ];
  mustCatch('the photo-preference regression (without preferPhotos, a no-photo rank-1 row leads)',
    (interleaveRanked(rowsPhotoMix, [])[0].l.photos?.length ?? 0) === 0);

  // Mutation C: district diversity dropped (interleaveRanked without the geo key → districts clump).
  const rowsDist: RankedRow<L>[] = [];
  for (let i = 0; i < 3; i++) rowsDist.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', district: 'حي النرجس' }));
  for (let i = 0; i < 3; i++) rowsDist.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', district: 'حي العارض' }));
  mustCatch('the district-diversity regression (without the district key, a city search clumps 3+3 by district)',
    worstStreak(interleaveRanked(rowsDist, []).map((r) => r.district)) >= 3);

  // Mutation D: mixDeals off → buy/rent do not alternate.
  const rowsDealMix: RankedRow<L>[] = [];
  for (let i = 0; i < 3; i++) rowsDealMix.push(mkRow({ id: i + 1, platform: 'aqar', type: 'Apartment', deal: 'Buy' }));
  for (let i = 0; i < 3; i++) rowsDealMix.push(mkRow({ id: 100 + i, platform: 'aqar', type: 'Apartment', deal: 'Rent' }));
  mustCatch('the deal-diversity regression (without mixDeals, buy/rent cluster instead of alternating)',
    orderByScope(rowsDealMix, 'city').map((r) => r.l.deal).slice(0, 3).every((d, _i, a) => d === a[0]));
}

console.log(failed ? `\n${failed} FAILED` : '\nAll first-batch diversity-order checks passed');
process.exit(failed ? 1 : 0);
