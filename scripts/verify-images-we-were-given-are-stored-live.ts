// IMAGES THE SOURCE PUBLISHED MUST BE STORED — LIVE HALF.
//
// The production-reading half of verify-images-we-were-given-are-stored.ts (see that file for the
// rule, the wasalt case that earned it, and why a coverage percentage cannot express it). The
// predicate and its mutation proofs stay in the required `npm test`; this file, which can only be
// answered by asking production, runs in .github/workflows/loader-active-platforms-check.yml beside
// the other per-platform coverage reads.
//
// WHY THE SERVICE ROLE, and why that is not the banned shape. source_capture is deliberately
// PDPL-private — anon has no SELECT on it (scrapers/common/db.py's capture barrier) — so unlike the
// sibling listing_extra_attrs probe this question cannot be answered from anon-readable data. Same
// justification verify-repair-guarantee-enrollment-live.ts already carries for an RLS-protected
// read. The endpoint still resolves through resolvePublicSupabase(); only the KEY is elevated.
//
// NO NEW RPC AND NO MIGRATION, on purpose. A dedicated ops_ function would be the tidier shape, but
// it would mean applying a migration, which closes the repo-wide drift gate until its mirror is
// merged by a human — a cost AGENTS.md and ops_incident #223 both record being paid repeatedly.
// Two counts per table over PostgREST answer the same question with no schema change at all.
//
// FAILS CLOSED. Any unreadable count exits non-zero rather than returning a number, so "could not
// measure" can never be mistaken for "measured zero" — the standing A FAILED FETCH IS NOT AN EMPTY
// ANSWER rule, which is the entire reason this rule is trustworthy in the first place.
//
//   SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types \
//     scripts/verify-images-we-were-given-are-stored-live.ts
import { join } from 'node:path';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  droppedImageGaps,
  describeDroppedImages,
  droppedImageBlindRows,
  type DroppedImageRow,
} from './lib/coverageGaps.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const die = (why: string): never => {
  console.log(`\n✗ CANNOT-MEASURE: ${why}`);
  process.exit(1);
};

console.log('\nImages the source published must be stored (LIVE)\n');

const { url: BASE } = resolvePublicSupabase(process.env);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!KEY) {
  die('source_capture is PDPL-private and anon cannot SELECT it, so this read needs '
    + 'SUPABASE_SERVICE_ROLE_KEY. Refusing to report a verdict it could not measure.');
}
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** Exact count for one filter over one table, off the Content-Range header. Fails CLOSED. */
async function count(table: string, filter: string): Promise<number> {
  const r = await fetch(`${REST}/${table}?${filter}&select=id&limit=1`, {
    headers: { ...H, Prefer: 'count=exact' },
  }).catch(() => null);
  if (!r || !r.ok) return die(`could not count ${table} (${filter}) — ${r ? r.status : 'network error'}`);
  const n = Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  if (!Number.isFinite(n) || n < 0) return die(`unreadable count for ${table} (${filter})`);
  return n;
}

const lifted = await liftSearchScope(ROOT)
  .catch((e) => die(`could not lift SEARCHABLE_TABLES — ${(e as Error).message}`));
const TABLES = (lifted.SEARCHABLE_TABLES as string[]);
check('SEARCHABLE_TABLES lifted and is plausibly the fleet', TABLES.length >= 50, `got ${TABLES.length}`);

// "WE STORED NO PHOTOS" IS AN EMPTY ARRAY, NOT NULL — and getting that wrong makes this file a
// barrier that CANNOT FAIL. Measured on production 2026-09-13 while writing it: of wasalt's 5,691
// active photo-less rows, `photo_urls IS NULL` matches ZERO and `cardinality(photo_urls) = 0`
// matches all 5,691. A first draft of this file filtered on `photo_urls=is.null` alone; it would
// have matched nothing on every platform forever and reported "every image is stored" while being
// structurally incapable of finding one missing. Both arms are required.
const NO_PHOTOS = 'or=(photo_urls.is.null,photo_urls.eq.{})';
const HAS_SOURCE_IMAGES = 'source_capture->>image_count=not.is.null&source_capture->>image_count=neq.0';

const rows: DroppedImageRow[] = [];
let photoLess = 0;
for (const table of TABLES) {
  const [active_rows, rows_with_signal, dropped, noPhotos] = await Promise.all([
    count(table, 'active=is.true'),
    count(table, 'active=is.true&source_capture->>image_count=not.is.null'),
    count(table, `active=is.true&${HAS_SOURCE_IMAGES}&${NO_PHOTOS}`),
    count(table, `active=is.true&${NO_PHOTOS}`),
  ]);
  rows.push({ table, active_rows, rows_with_signal, dropped });
  photoLess += noPhotos;
}

check('the probe is evaluating the real fleet (sanity: it still sees active rows somewhere)',
  rows.some((r) => r.active_rows > 0), 'zero tables carried any active rows at all');

// THE ANTI-VACUITY ARM, and the reason a wrong filter here fails LOUD instead of passing silently.
// The fleet is KNOWN to contain photo-less listings — wasalt alone held 5,691 on 2026-09-13, and the
// image-coverage ratchet independently reports platforms well under 100%. So if this file's
// "no photos" predicate matches NOTHING fleet-wide, the predicate is broken, not the data: the
// `dropped` counts above would all be a guaranteed zero and this barrier would be decoration.
check('the "no photos stored" filter can actually match rows (else every count above is vacuous)',
  photoLess > 0,
  'ZERO photo-less rows found across the whole fleet — impossible against a fleet the coverage '
  + 'ratchet reports below 100%. The PostgREST filter is wrong, so `dropped` is a meaningless zero.');

const blind = droppedImageBlindRows(rows);
const total = rows.reduce((n, r) => n + r.active_rows, 0);
console.log(`      judgeable: ${total - blind} of ${total} active rows carry source_capture->>image_count`);

const gaps = droppedImageGaps(rows);
check('no platform holds a listing whose source published images while we stored none',
  gaps.length === 0, gaps.length ? describeDroppedImages(gaps) : '');

// ── MUTATION PROOF for the one decision this file makes on its own ──────────────────────────────
// Everything else here is counting rows and handing them to the shared predicate, which the hermetic
// half proves. But the anti-vacuity arm IS this file's own logic, and it is the arm standing between
// "every image is stored" and "my filter matched nothing, forever" — the near-miss this file's first
// draft actually contained. So it is proven here, where it lives, against both directions.
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the vacuity arm cannot detect the defect it exists for');
const filterCanMatch = (fleetPhotoLess: number) => fleetPhotoLess > 0;
mustCatch('a "no photos" filter matching nothing fleet-wide (the null-only draft of this file)',
  !filterCanMatch(0));
mustCatch('a working filter being falsely condemned as vacuous',
  filterCanMatch(5691));

console.log(failed === 0
  ? '\n✅ every image the source published is stored — a coverage dip anywhere is a source fact, not a capture bug.\n'
  : `\n❌ ${failed} check(s) failed — we are dropping images we were given.\n`);
process.exit(failed === 0 ? 0 : 1);
