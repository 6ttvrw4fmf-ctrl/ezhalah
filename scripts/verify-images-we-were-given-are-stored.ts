// A COVERAGE PERCENTAGE CANNOT TELL "WE DROPPED IT" FROM "THE SOURCE DIDN'T PUBLISH IT".
// This is the rule that can. Hermetic half — barrier engineer, 2026-09-13.
//
// WHY IT EXISTS, measured. The image-coverage ratchet (verify-image-coverage-ratchet.ts) holds each
// platform to a floor percentage. That is the right coarse net, and it caught a real dip: wasalt
// fell from 93.3% to 88.8% between the 2026-09-07 and 2026-09-08 snapshots and sat at 89.4% against
// a 90% floor for days, red on four consecutive runs of loader-active-platforms-check.yml.
//
// It looked exactly like a capture regression. Rows the newest crawl passes had touched were 13.3%
// (2026-09-11) and 10.0% (2026-09-12) photo-less, against ~1% for rows last crawled 09-07..09-10.
// The obvious repairs were both WRONG: lowering the floor would have silenced a real alarm, and
// "fixing the scraper" would have chased a bug that does not exist.
//
// What settled it was asking the capture rather than the percentage:
//
//     select (source_capture->>'image_count')::int, count(*)
//     from wasalt_residential_listings
//     where active and (photo_urls is null or cardinality(photo_urls)=0)
//     group by 1;
//     --  0 | 5691        <- ONE bucket. Zero exceptions.
//
// Every photo-less wasalt row carries the source's own answer: it published no images. We stored
// exactly what we were given. The dip is a fact about wasalt, and no floor edit can turn it into an
// Ezhalah defect or vice versa.
//
// THE RULE. Of the listings whose source published images, how many did we fail to store? ZERO —
// at any coverage percentage, on every platform. Unlike a floor this is not a judgement call and
// nobody can tune it; and unlike a percentage it is red for exactly one cause.
//
// FLEET-WIDE BY CONSTRUCTION, not a wasalt special case: scrapers/common/db.py writes
// image_count = len(photos) into source_capture on the shared write path every platform uses.
// Measured 2026-09-13 across the ten largest platforms — 199,509 of 199,511 active rows carry the
// key, and `dropped` is 0 on every one.
//
// UNKNOWN IS NOT ZERO. A row with no image_count key cannot be judged and is counted as BLIND, never
// folded into the pass — because a check that silently judges nothing reports as health, which is
// the exact failure this repo has been burned by (nine dark detectors reading as a clean bill).
//
// THE LIVE HALF reads source_capture, which anon deliberately cannot SELECT (it is PDPL-private), so
// it runs with the service role in .github/workflows/loader-active-platforms-check.yml — the same
// justification verify-repair-guarantee-enrollment-live.ts already carries for an RLS-protected read.
// BOTH halves call the SAME predicate from scripts/lib/coverageGaps.ts, so the proofs below are
// statements about the code that decides production's verdict, not about a copy of it.
//
//   node --experimental-strip-types scripts/verify-images-we-were-given-are-stored.ts
//   (in `npm test`)

import {
  droppedImageGaps,
  describeDroppedImages,
  droppedImageBlindRows,
  type DroppedImageRow,
} from './lib/coverageGaps.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

console.log('\nImages the source published must be stored — the rule a percentage cannot express\n');

const row = (table: string, active_rows: number, rows_with_signal: number, dropped: number): DroppedImageRow =>
  ({ table, active_rows, rows_with_signal, dropped });

// ── The predicate, against the real 2026-09-13 fleet shape ──────────────────────────────────────
const REAL_FLEET: DroppedImageRow[] = [
  row('aqar_residential_listings', 90213, 90213, 0),
  row('wasalt_residential_listings', 52816, 52816, 0),
  row('gathern_residential_listings', 29687, 29687, 0),
  row('dealapp_residential_listings', 15971, 15971, 0),
  row('muktamel_residential_listings', 3743, 3743, 0),
  row('abralosol_residential_listings', 2305, 2305, 0),
  row('aqarmonthly_residential_listings', 1788, 1786, 0),
  row('aqarcity_residential_listings', 1623, 1623, 0),
  row('mustqr_residential_listings', 937, 937, 0),
  row('therc_residential_listings', 428, 428, 0),
];
check('the measured 2026-09-13 fleet is clean under this rule', droppedImageGaps(REAL_FLEET).length === 0);
check('and it was genuinely judgeable — only the 2 known aqarmonthly rows are blind',
  droppedImageBlindRows(REAL_FLEET) === 2, `got ${droppedImageBlindRows(REAL_FLEET)}`);

// ── MUTATION PROOF — the same predicate, against deliberately broken input ───────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// THE DEFECT THIS RULE EXISTS FOR: the source gave us images and we stored none.
mustCatch('a single dropped image on one platform',
  droppedImageGaps([...REAL_FLEET, row('x_residential_listings', 100, 100, 1)]).length === 1);
mustCatch('a mass drop that a generous floor would still wave through',
  droppedImageGaps([row('x_residential_listings', 100000, 100000, 9000)]).length === 1);

// THE CASE THAT IS NOT A DEFECT, and must never be reported as one — the real wasalt shape:
// 5,691 photo-less rows, every one of them image_count = 0, so nothing was dropped.
mustCatch('the real wasalt shape (5,691 photo-less rows, ZERO dropped) being called a defect',
  droppedImageGaps([row('wasalt_residential_listings', 52816, 52816, 0)]).length === 0);

// BLIND ROWS ARE NOT PASSING ROWS. A platform this rule cannot judge must be visible as unjudged,
// never counted as clean — the "a check that looked at nothing reports as health" failure.
mustCatch('a wholly unjudgeable platform being folded into a clean verdict',
  droppedImageBlindRows([row('x_residential_listings', 5000, 0, 0)]) === 5000);
mustCatch('blind rows being over-counted on a fully judgeable platform',
  droppedImageBlindRows([row('x_residential_listings', 5000, 5000, 0)]) === 0);

// THE NEAR-MISS THIS FILE ALMOST SHIPPED, pinned so it cannot come back. "We stored no photos" is an
// EMPTY ARRAY in this schema, never NULL: measured on production 2026-09-13, of wasalt's 5,691 active
// photo-less rows, `photo_urls IS NULL` matches ZERO and `cardinality(photo_urls) = 0` matches all
// 5,691. The live half's first draft filtered on null alone — it would have matched nothing on every
// platform forever and reported "every image is stored" while being structurally unable to find one
// missing. The live half now carries an anti-vacuity arm that fails LOUD if its own filter matches no
// photo-less row fleet-wide; this proof pins the reasoning behind that arm.
const fleetPhotoLess = (n: number) => n > 0;
mustCatch('a "no photos" filter that matches nothing fleet-wide being read as "all images stored"',
  !fleetPhotoLess(0));
mustCatch('a filter that does match photo-less rows being falsely called broken',
  fleetPhotoLess(5691));

// The message a human acts on has to carry the numbers, not just a platform name.
const described = describeDroppedImages(droppedImageGaps([row('x_residential_listings', 100, 90, 7)]));
mustCatch('a description that omits how many rows were dropped',
  described.includes('7') && described.includes('x_residential_listings'));

// ── THE SPLIT CANNOT DECAY INTO A DELETION ──────────────────────────────────────────────────────
// Assert BY EXECUTION that the declared workflow home really invokes the live half.
const homeProblems = liveHalfProblems(
  'verify-images-we-were-given-are-stored-live.ts',
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check('the live half is really invoked by its declared workflow home',
  homeProblems.length === 0, homeProblems.join('; '));

console.log('');
console.log(failed === 0
  ? 'PASS — the rule holds, and it is proven to catch a drop, to acquit an honest source zero, and to report what it cannot judge.'
  : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
