// NO SCRAPER MAY SHIP A HARDCODED-EMPTY PHOTO LIST, AND NO PLATFORM MAY GO LIVE IMAGELESS.
// Auto-discovered barrier. Found 2026-09-05 by the OWNER, looking at the live site.
//
// THE DEFECT. alta and shmoualshmal both shipped with a literal `"photo_urls": []` in map_listing.
// Everything else about them was right — correct name, logo, host, city, district, price honesty —
// so the cards rendered perfectly except for «لا توجد صورة» where the photo belongs. Both sources
// publish images abundantly (alta 178 across 16 listings, shmoualshmal 61 across 6). Nothing in the
// pipeline noticed, because an empty array is a VALID value everywhere downstream: the row upserts,
// the union counts it, search returns it, the card renders. Only a human looking at the page saw it.
//
// WHY A LITERAL IS THE RIGHT THING TO BAN. An empty photo list is legitimate at RUNTIME — a source
// may genuinely publish no image for a listing, and that must stay an honest empty. What is never
// legitimate is a scraper that CANNOT produce images at all because the literal is compiled in.
// This barrier bans the literal, not the value.
//
// SECOND DEFECT PINNED HERE, from the same fix. shmoualshmal read its gallery through _meta1(),
// which unwraps a WP meta list to its FIRST element — correct for the single-value meta WP wraps in
// a 1-element list, catastrophic for fave_property_images, which is a genuine MULTI-value list.
// Result: exactly one photo per listing instead of ten. The card still looked right. That is the
// signature of this whole class — a plausible-looking partial result — so the runtime half of this
// check asserts a gallery FLOOR, not merely "non-empty".
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
const SCRAPERS = join(ROOT, 'scrapers');

console.log('\nEvery scraper can actually produce images (no compiled-in empty photo list)\n');

// ── 1. STATIC: no scraper may hardcode an empty photo_urls literal ──────────────────────────────
const dirs = readdirSync(SCRAPERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'common' && d.name !== '__pycache__')
  .map((d) => d.name);

// stripComments() is a TS/JS stripper — it leaves Python `#` comments intact (verified
// 2026-09-05). A commented-out literal must not read as live code, so strip line comments here.
// Quote-aware: a '#' inside a string (Arabic text, a URL fragment, a regex) is NOT a comment.
const stripPy = (src: string) =>
  src.split('\n').map((line) => {
    let q: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#') return line.slice(0, i);
    }
    return line;
  }).join('\n');

// A scraper is a DIRECTORY, not a single file. aqar builds its row in enrich_residential.py, not
// run.py — scanning only run.py reported the fleet's biggest platform (90,584 listings, all with
// photos) as having no image field at all. Read every .py in the package.
const pyFilesOf = (slug: string) => {
  const dir = join(SCRAPERS, slug);
  return readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.py') && f.name !== '__init__.py')
    .map((f) => join(dir, f.name));
};

const offenders: string[] = [];
const noPhotoField: string[] = [];
for (const slug of dirs) {
  const files = pyFilesOf(slug);
  if (!files.length) continue;
  const src = files.map((f) => stripPy(readFileSync(f, 'utf8'))).join('\n');
  // Some packages are helper-only (liveness probes, cleanup) and never build a listing row.
  if (!/upsert_|["']ad_number["']\s*:/.test(src)) continue;
  if (!/["']photo_urls["']\s*:/.test(src) && !/\bphotos\b/.test(src)) { noPhotoField.push(slug); continue; }
  // the exact shape that shipped the defect: "photo_urls": []  (with any inner whitespace)
  if (/["']photo_urls["']\s*:\s*\[\s*\]/.test(src)) offenders.push(slug);
}

check('no scraper assigns a hardcoded-empty photo_urls literal',
  offenders.length === 0,
  offenders.length
    ? `${offenders.join(', ')} — an empty list is fine at RUNTIME when the source truly has no ` +
      `image, but a compiled-in [] means the scraper can never produce one. Resolve the images ` +
      `and pass them in (see alta.fetch_images / shmoualshmal.fetch_images).`
    : '');

check('every scraper sets a photo_urls field at all', noPhotoField.length === 0,
  noPhotoField.length ? `no photo_urls key found in: ${noPhotoField.join(', ')}` : '');

// ── 2. The two scrapers this defect shipped in keep their per-listing binding ───────────────────
// alta binds by ATTACHMENT PARENT, never by scraping the rendered page: that page also renders a
// "related properties" block, so page-scraped images would carry a NEIGHBOURING listing's photos.
const alta = stripPy(readFileSync(join(SCRAPERS, 'alta', 'run.py'), 'utf8'));
check('alta resolves images by attachment parent (cannot inherit a related listing\'s photos)',
  /media\?parent=\{pid\}/.test(alta),
  'alta must use /wp/v2/media?parent=<post_id>; the detail page mixes in related properties');
check('alta does NOT scrape images out of the rendered detail page',
  !/fetch_detail|listing_price|<img/.test(alta.slice(alta.indexOf('def fetch_images'), alta.indexOf('def fetch_listings'))),
  'page-scraped images on this source can belong to another listing');
check('alta hoists featured_media to the FRONT (it is the card thumbnail)',
  /urls\.insert\(0, m\["source_url"\]\)/.test(alta));

// shmoualshmal must read the gallery meta RAW — _meta1 would collapse it to one image.
const shm = stripPy(readFileSync(join(SCRAPERS, 'shmoualshmal', 'run.py'), 'utf8'));
const shmImages = shm.slice(shm.indexOf('def fetch_images'), shm.indexOf('def fetch_listings'));
check('shmoualshmal reads fave_property_images RAW, not through _meta1',
  /\.get\("fave_property_images"\)/.test(shmImages) && !/_meta1\([^)]*fave_property_images/.test(shmImages),
  '_meta1 unwraps a list to its FIRST element — it silently reduced a 10-image gallery to 1');
check('shmoualshmal re-sorts ids back into the source gallery order after the bulk fetch',
  /url_by_id\[i\] for i in ids/.test(shmImages),
  '/wp/v2/media?include= does NOT preserve requested order (verified: 18747,18739,18741 -> ' +
  '18747,18741,18739). The first url is the card thumbnail.');

// ── 3. MUTATION PROOF — the static predicate, against scrapers that should FAIL ─────────────────
console.log('\n  mutation proof — the same predicate, against broken sources\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const bansEmpty = (src: string) => /["']photo_urls["']\s*:\s*\[\s*\]/.test(stripPy(src));

mustCatch('the exact defect that shipped:  "photo_urls": [],',
  bansEmpty('row = {\n  "photo_urls": [],\n}'));
mustCatch('single-quoted variant',
  bansEmpty("row = {\n  'photo_urls': [],\n}"));
mustCatch('whitespace inside the brackets',
  bansEmpty('row = {\n  "photo_urls":  [  ],\n}'));
// ...and must NOT fire on a scraper that genuinely resolves images
mustCatch('a real resolver is NOT flagged',
  bansEmpty('row = {\n  "photo_urls": (images or {}).get(p.get("id"), []),\n}') === false);
mustCatch('awal\'s existing resolver is NOT flagged',
  bansEmpty('row = {\n  "photo_urls": _images(body),\n}') === false);
// a commented-out empty must not count — stripComments runs first
mustCatch('a COMMENTED empty literal is not a false positive',
  bansEmpty('row = {\n  # "photo_urls": [],\n  "photo_urls": _images(body),\n}') === false);

// M-7: the false positive this barrier itself shipped with — a scraper whose row is built in a
// SIBLING file. Scanning run.py alone reported aqar (90,584 photographed listings) as imageless.
mustCatch('a row built in a sibling file is NOT reported as imageless',
  /["']photo_urls["']\s*:/.test(stripPy('# run.py has no row\n')
    + '\n' + stripPy('row = {"ad_number": a, "photo_urls": photos}')) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ every scraper can produce images; alta/shmoualshmal keep their per-listing binding.\n'
    : `\n❌ ${failed} check(s) failed — a scraper cannot produce images, or binds them wrongly.\n`,
);
process.exit(failed === 0 ? 0 : 1);
