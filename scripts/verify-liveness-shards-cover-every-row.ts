// A SHARDED LIVENESS SWEEP MUST COVER EVERY ACTIVE ROW — even when the shards disagree.
//
// WHAT THIS GUARDS, AND THE MEASUREMENT THAT BOUGHT IT (2026-09-24, routine #11).
// -----------------------------------------------------------------------------
// scrapers/aqar/liveness.py splits ~93,000 active rows across 16 parallel GitHub runners. It used
// to split by ROW OFFSET: shard k swept `[id_at(k*N/16), id_at((k+1)*N/16))`, with `N` and `id_at`
// read live. Those windows are contiguous, disjoint and jointly covering — for ONE caller reading
// ONE snapshot. The sixteen runners each start at their own minute and each read their own
// snapshot of a table the other fifteen are deactivating rows in, so shard k's `lo` and shard
// k-1's `hi` are two different answers to the same question. Whenever `lo_k > hi_(k-1)`, every
// active row in between is swept by NOBODY.
//
// Measured on aqar_residential_listings that day: 920 active rows, `missing_count = 0`, oldest
// `last_seen_at` 2026-08-04 — FIFTY-ONE DAYS with nothing having looked at them, while a user
// could find and click every one. Each frozen cohort sat exactly at the bottom of a shard's id
// window, which is the signature. Because `missing_count` never increments for an unprobed row,
// they could never reach the strike grace either, so `served_after_source_gone` and `prune_unseen`
// were structurally blind and every platform coverage percentage read healthy.
//
// WHY A NEW FILE AND NOT A REPAIR OF THE OLD TEST. The old hermetic test asserted the windows were
// "contiguous, disjoint, jointly covering every active row ... for ANY id distribution", and it was
// green for all fifty-one days, because it built all sixteen windows from ONE shared `id_at` and
// ONE shared row count. It modelled a world in which the shards agree. AGENTS.md's rule in its
// exact form: a barrier that tests a model instead of the mechanism passes for the entire time the
// defect is live.
//
// So the input here is DIVERGENT SNAPSHOTS, and the real Python is EXECUTED — never grepped, never
// re-implemented in TypeScript (scrapers/common/shard_partition.py is imported and run through
// scripts/lib/pythonMutant.ts, the same tool verify-sold-pin-evidence-law.ts uses).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';

const ROOT = join(import.meta.dirname, '..');
const MODULE = 'scrapers.common.shard_partition';
const SRC_PATH = join(ROOT, 'scrapers/common/shard_partition.py');
const SRC = readFileSync(SRC_PATH, 'utf8');
const SWEEP_PATH = join(ROOT, 'scrapers/aqar/liveness.py');
const SWEEP = readFileSync(SWEEP_PATH, 'utf8');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + what + (ok || !detail ? '' : ' — ' + detail));
  if (!ok) failed++;
};

console.log('verify-liveness-shards-cover-every-row: no active row may fall between two shards.\n');

// ── The input: sixteen shards, sixteen DIFFERENT snapshots ──────────────────────────────────────
// Modelled on the live aqar id distribution — dense at the low end (ids 4..150k), sparse above
// (1.4M..12M) — because that skew is what made the offset boundaries drift so far apart.
const SHARDS = 16;
function livelikeIds(): number[] {
  const ids: number[] = [];
  for (let i = 4; i < 150_000; i += 17) ids.push(i);          // dense legacy block
  for (let i = 1_400_000; i < 12_000_000; i += 2_311) ids.push(i); // sparse modern block
  return ids;
}
const ALL_IDS = livelikeIds();

// Shard k reads the table `k` kill-waves late, and the kills CLUSTER in the old legacy block —
// both facts are production's, not this file's invention. aqar's shards start up to 40 minutes
// apart while the others deactivate ~1,700 rows a day, and the dead rows sit disproportionately in
// the oldest ids. That combination is what moved two shards' shared boundary apart: with kills
// concentrated below every boundary, shard k's start lands ~60(1 - k/S) rows ABOVE the point shard
// k-1 stopped at, and everything in between is nobody's.
function divergentSnapshots(): number[][] {
  const snaps: number[][] = [];
  for (let k = 0; k < SHARDS; k++) {
    const gone = new Set(ALL_IDS.slice(0, k * 60)); // k kill-waves, all in the legacy block
    snaps.push(ALL_IDS.filter((i) => !gone.has(i)));
  }
  return snaps;
}
const SNAPS = divergentSnapshots();

type Coverage = { shards: number; swept: number; missed: number[]; duplicated: number[] };
const coverage = (mutated?: string): Coverage =>
  pyCall(ROOT, MODULE, 'partition_coverage', [[SNAPS, SHARDS]], mutated)[0] as Coverage;

// ── 1. The real thing, executed ─────────────────────────────────────────────────────────────────
const real = coverage();
check(real.missed.length === 0,
  'no row active throughout is swept by NOBODY (the 920-row defect)',
  `${real.missed.length} missed, e.g. ${real.missed.slice(0, 5).join(', ')}`);
check(real.duplicated.length === 0,
  'no row is swept by two shards (wasted probes, and a sign the split is not a partition)',
  `${real.duplicated.length} duplicated`);
check(real.swept > ALL_IDS.length * 0.9,
  'the fleet really swept the population, so the two assertions above are not vacuous',
  `swept ${real.swept} of ${ALL_IDS.length}`);

// Ownership must depend on the row and nothing else.
const owns = pyCall(ROOT, MODULE, 'shard_owns', [
  [1_552_008, 16, 8], [1_552_008, 16, 9], [4, 16, 4], [4, 16, 0],
]) as boolean[];
check(owns[0] === true && owns[1] === false && owns[2] === true && owns[3] === false,
  'shard_owns() reads the id alone — no count, no offset, no snapshot, no neighbours');

// ── 2. The sweep is actually WIRED to it, and the old primitive is gone ─────────────────────────
// Structural, and labelled as such: the behavioural half is everything above. What this adds is
// that the aqar sweep cannot quietly go back to negotiating boundaries.
check(/from scrapers\.common\.shard_partition import shard_worklist/.test(SWEEP)
  && /shard_worklist\(/.test(SWEEP),
  'scrapers/aqar/liveness.py builds its worklist from the shared partition');
check(!/shard_id_window|shard_row_window|def _id_at/.test(SWEEP),
  'the offset-window helpers that produced the gap are not reachable from the sweep again');

// ── 3. Mutations — each re-introduces a real way to strand a row, EXECUTED ──────────────────────
console.log('\nMutation proofs (each runs the real partition_coverage over a broken partition)\n');

const mutate = (find: string, repl: string): string => {
  if (!SRC.includes(find)) throw new Error(`mutation anchor missing in shard_partition.py: ${find}`);
  return SRC.replace(find, repl);
};

const mustCatch = (label: string, caught: boolean, detail = '') => {
  console.log('  ' + (caught ? 'PASS' : 'FAIL') + '  catches: ' + label
    + (caught || !detail ? '' : ' — ' + detail));
  if (!caught) failed++;
};

const OWNS_BODY = `    s = max(1, int(shards))
    return int(listing_id) % s == int(shard) % s`;
const WORKLIST_BODY =
  `    return sorted({int(i) for i in ids if shard_owns(int(i), shards, shard)})`;

// M1 — THE SHIPPED DEFECT: ownership decided by a row's OFFSET inside the shard's own snapshot.
const m1 = coverage(mutate(WORKLIST_BODY, `    rows = sorted({int(i) for i in ids})
    s = max(1, int(shards))
    k = int(shard) % s
    return rows[(k * len(rows)) // s:((k + 1) * len(rows)) // s]`));
mustCatch('the 2026-09-24 offset-window split — shards negotiate a shared boundary from '
  + 'different snapshots and the rows in between are swept by nobody',
  m1.missed.length > 0, `missed ${m1.missed.length}`);

// M2 — a second, different wrong way, and the repo's OWN earlier one: the geometric id-range split
// anchored at min_id (the 2026-07-16 scheme). Anchoring on a value each shard reads for itself is
// the same mistake in a different coordinate system.
const m2 = coverage(mutate(WORKLIST_BODY, `    rows = sorted({int(i) for i in ids})
    if not rows:
        return []
    s = max(1, int(shards))
    lo = rows[0]
    width = ((rows[-1] - lo) // s) + 1
    return [i for i in rows if (i - lo) // width == int(shard) % s]`));
mustCatch('the geometric id-range split anchored at each shard\'s own min_id (the 2026-07-16 '
  + 'scheme — the same mistake in a different coordinate system)',
  m2.missed.length > 0, `missed ${m2.missed.length}`);

// M3 — over-coverage must be caught too, or "missed == 0" could be bought by sweeping everything.
const m3 = coverage(mutate(OWNS_BODY, `    return True`));
mustCatch('every shard sweeping every row — over-coverage is reported, not rewarded',
  m3.duplicated.length > 0, `duplicated ${m3.duplicated.length}`);

// M4 — the degenerate-argument guard removed: an out-of-range shard index owns nothing, and 1/S
// of the table silently stops being anybody's.
const m4 = coverage(mutate(OWNS_BODY, `    s = max(1, int(shards))
    return int(listing_id) % s == int(shard)`));
mustCatch('shard index not normalised — an out-of-range shard owns nothing and 1/S of the table '
  + 'stops being swept',
  pyCall(ROOT, MODULE, 'shard_owns', [[5, 4, 5]],
    mutate(OWNS_BODY, `    s = max(1, int(shards))
    return int(listing_id) % s == int(shard)`))[0] === false && m4.missed.length === 0);

// M5 — THE GUARD ON THE GUARD. If the instrument stops reporting misses, M1 would go quiet and
// this whole file would pass over the shipped defect. Re-run M1 with the reporter also broken and
// require that this barrier's own verdict flips.
const blindReporter = mutate(
  `        "missed": sorted(i for i in truth_set if i not in owners),`,
  `        "missed": [],`);
const m5 = coverage(blindReporter.replace(WORKLIST_BODY, `    rows = sorted({int(i) for i in ids})
    s = max(1, int(shards))
    k = int(shard) % s
    return rows[(k * len(rows)) // s:((k + 1) * len(rows)) // s]`));
mustCatch('a partition_coverage that has stopped reporting misses — the measurement going dark '
  + 'must break this barrier, not satisfy it',
  m5.missed.length === 0 && m1.missed.length > 0);

// M6 — the negative control: the SHIPPED partition is NOT flagged, so an over-broad "always red"
// repair cannot satisfy M1-M5.
mustCatch('...while the shipped partition is NOT flagged (the judgement is not vacuously red)',
  real.missed.length === 0 && real.duplicated.length === 0);

console.log('');
if (failed) {
  console.error(`✗ verify-liveness-shards-cover-every-row: ${failed} failure(s)`);
  process.exit(1);
}
console.log('✓ every active row belongs to exactly one shard, whatever the shards disagree about');
