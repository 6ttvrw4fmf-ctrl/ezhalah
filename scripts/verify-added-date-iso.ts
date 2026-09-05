// Automated test — the «أضيف» (listing date) chip must render the SOURCE-PUBLISHED date for every
// date format the platforms actually publish, including ISO-8601. 2026-08-23.
//
// THE DEFECT THIS GUARDS
// `cleanDate()` in src/components/ResultCard.tsx only knew DD/MM/YYYY (aqar's format). Three
// platforms — aqarcity, eaqartabuk, eastabha — publish `date_added` as an ISO-8601 timestamp
// ('2025-09-21T20:33:43+03:00'). That string has no slashes, so it missed the DD/MM/YYYY branch, and
// at 25 characters it also failed the `raw.length <= 12` tail — cleanDate returned '' and the card's
// `{listedClean ? <Stat … /> : null}` dropped the chip entirely. Result: 2,544 live listings that DO
// carry a source-published date showed the user no date at all (aqarcity 1,807 / eaqartabuk 553 /
// eastabha 184; live audit found 76 of 595 rendered cards silently dropping a non-null date_added,
// every one of them ISO, and zero DD/MM/YYYY values dropped).
//
// WHY THIS IS A SOURCE-TRUTH BUG, NOT COSMETICS
// The source published a date. The card is the only place the user sees it. Dropping it renders a
// KNOWN fact as if it were unknown — the mirror image of rendering an unknown as known, and the same
// rule forbids both.
//
// WHAT IS ASSERTED
//   1. The REAL cleanDate() is lifted out of ResultCard.tsx and executed (not re-implemented here),
//      so any edit to the shipped regexes is what these cases run against.
//   2. Real `date_added` values frozen from the live DB — ISO and DD/MM/YYYY alike — all produce a
//      non-empty date, and DD/MM/YYYY behaviour is byte-for-byte unchanged.
//   3. cleanDate never calls `new Date()`. The ISO stamps are +03:00 Saudi-local; parsing them and
//      re-reading the day in the viewer's timezone would shift the date the SOURCE published by a
//      day, which is exactly the "never derive a listing fact" rule.
//   4. The card still gates the chip on the cleanDate result, so a future refactor cannot route the
//      raw string around this function.
//
// Run: node --experimental-strip-types scripts/verify-added-date-iso.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failed++; if (detail) console.error(`  ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const CARD = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');

// ── 1. lift the SHIPPED cleanDate out of the .tsx and run it ───────────────────────────────────
// .tsx cannot be imported by the Node type-stripping runner (same constraint the other card
// verifiers work around), so the function source is sliced out and evaluated. This is deliberately
// NOT a re-implementation: if someone deletes the ISO branch, these cases run against the deletion.
const srcMatch = CARD.match(/const cleanDate = \(raw\?: string\): string => \{[\s\S]*?\n {2}\};/);
check('cleanDate() found in src/components/ResultCard.tsx', srcMatch != null,
      'the function signature changed — update this barrier deliberately, do not delete it');
if (!srcMatch) process.exit(1);

const AR_RECENTLY = I18N.match(/'recently':\s*'([^']+)'/)?.[1] ?? '';
eq("i18n renders «مؤخراً» for 'recently'", AR_RECENTLY, 'مؤخراً');

const body = srcMatch[0]
  .replace('const cleanDate = (raw?: string): string =>', '(raw) =>')
  .replace(/;$/, '');
const cleanDate = new Function('t', `return ${body};`)((k: string) => (k === 'recently' ? AR_RECENTLY : k)) as
  (raw?: string) => string;

// ── 2. real rows frozen from the live DB (PostgREST, anon key, 2026-08-23) ──────────────────────
type Row = { table: string; id: string; raw: string; expect: string; why: string };
const ROWS: Row[] = [
  // ISO-8601 with a +03:00 offset — the dropped population. 595011 is the row from the live repro.
  { table: 'aqarcity_commercial_listings',   id: '595011',  raw: '2025-09-21T20:33:43+03:00', expect: '21/09/2025', why: 'repro card #4' },
  { table: 'aqarcity_commercial_listings',   id: '594964',  raw: '2025-09-30T20:56:11+03:00', expect: '30/09/2025', why: 'ISO' },
  { table: 'aqarcity_commercial_listings',   id: '9022955', raw: '2026-08-22T14:18:35+03:00', expect: '22/08/2026', why: 'ISO' },
  { table: 'aqarcity_commercial_listings',   id: '593565',  raw: '2026-04-27T17:40:28+03:00', expect: '27/04/2026', why: 'ISO' },
  { table: 'aqarcity_commercial_listings',   id: '595167',  raw: '2025-08-19T18:36:17+03:00', expect: '19/08/2025', why: 'ISO' },
  { table: 'aqarcity_commercial_listings',   id: '594167',  raw: '2026-01-27T17:03:06+03:00', expect: '27/01/2026', why: 'ISO' },
  // DD/MM/YYYY — must be byte-for-byte what it always was.
  { table: 'aqar_commercial_listings',       id: '4899386', raw: '15/07/2026',                expect: '15/07/2026', why: 'aqar' },
  { table: 'aqar_commercial_listings',       id: '369310',  raw: '04/03/2026',                expect: '04/03/2026', why: 'aqar' },
  { table: 'aqar_commercial_listings',       id: '4322000', raw: '21/07/2026',                expect: '21/07/2026', why: 'aqar' },
];
for (const r of ROWS) eq(`${r.table}:${r.id} «${r.raw}» → «${r.expect}» (${r.why})`, cleanDate(r.raw), r.expect);

// Shape coverage: the ISO variants a scraper can plausibly hand us, and the legacy behaviours.
eq('bare ISO date «2026-08-22» → «22/08/2026»',            cleanDate('2026-08-22'), '22/08/2026');
eq('space-separated stamp «2026-08-22 14:18:35» → date',   cleanDate('2026-08-22 14:18:35'), '22/08/2026');
eq('UTC «Z» stamp «2026-08-22T11:18:35Z» → «22/08/2026»',  cleanDate('2026-08-22T11:18:35Z'), '22/08/2026');
eq('DD/MM/YYYY inside scraper junk still wins',
   cleanDate('28/04/2026 آخر تحديث منذ 22 ساعة ... المشاهدات 353 ...'), '28/04/2026');
eq("the 'recently' sentinel still localises", cleanDate('recently'), AR_RECENTLY);
eq('missing date still renders nothing', cleanDate(undefined), '');
eq('empty string still renders nothing', cleanDate(''), '');
eq('unparseable long junk still renders nothing', cleanDate('x'.repeat(40)), '');

// The regression itself, stated as its own check: no non-null source date may vanish.
const dropped = ROWS.filter((r) => cleanDate(r.raw) === '');
check(`no source-published date is dropped (${ROWS.length} real rows)`, dropped.length === 0,
      `dropped: ${dropped.map((r) => `${r.table}:${r.id} «${r.raw}»`).join(', ')}`);

// ── 3. the date must be read textually, never through a timezone ────────────────────────────────
// '2025-09-21T20:33:43+03:00' is 21 Sep in Riyadh but 21 Sep 17:33 UTC — and a stamp near midnight
// (e.g. '2026-08-22T00:30:00+03:00' = 21:30 UTC on the 21st) flips the DAY for any viewer west of
// Saudi. Parsing with `new Date()` would therefore show a date the source never published.
const codeOnly = srcMatch[0].replace(/^\s*\/\/.*$/gm, ''); // the doc comment names `new Date()` on purpose
check('cleanDate() does not construct a Date (no timezone drift)',
      !/new Date\s*\(|Date\.parse|toLocaleDateString/.test(codeOnly),
      'cleanDate now parses the stamp — the rendered day would follow the VIEWER timezone, not the source');

// ── 4. the chip is still gated on cleanDate's output ────────────────────────────────────────────
check('the «أضيف» chip still renders from listedClean = cleanDate(listing.listed)',
      /const listedClean = cleanDate\(listing\.listed\);/.test(CARD)
      && /\{listedClean \? <Stat icon="calendar-outline" big=\{t\('Added'\)\} small=\{listedClean\} \/> : null\}/.test(CARD));
check("i18n renders «أضيف» for 'Added'", /'Added':\s*'أضيف'/.test(I18N));

// ── mutation proofs (added 2026-09-04 by routine #10, leaving the grandfather list) ─────────────
//
// This barrier already EXECUTES the shipped cleanDate rather than grepping for it — the §0.1 audit
// entry calling it a source-text tripwire is stale, and the read above confirms it. What it lacked
// was the other half: nobody had ever watched it go red. So the defect is re-introduced into the
// REAL ResultCard source, the mutant is re-lifted and re-executed, and the same production rows are
// re-run through it. `build()` is the same lift the healthy path uses, so a proof cannot diverge
// from what is actually being tested.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const build = (fnSource: string): ((raw?: string) => string) => {
  const b = fnSource
    .replace('const cleanDate = (raw?: string): string =>', '(raw) =>')
    .replace(/;$/, '');
  return new Function('t', `return ${b};`)((k: string) => (k === 'recently' ? AR_RECENTLY : k)) as
    (raw?: string) => string;
};

/** The regression, stated as a predicate over a mutated cleanDate: does any real row lose its date? */
const dropsASourceDate = (fn: (raw?: string) => string) => ROWS.some((r) => fn(r.raw) === '');

const ISO_ROWS = ROWS.filter((r) => r.raw.includes('-'));

// M1 — the original defect verbatim: delete the ISO branch and every aqarcity/eaqartabuk/eastabha
// date disappears from the card again.
const noIso = srcMatch[0].replace(/const iso = raw\.match[\s\S]*?if \(iso\) return[^;]*;/, '');
mustCatch('the ISO-8601 branch being deleted — the 2,544-listing defect, verbatim',
  noIso !== srcMatch[0] && dropsASourceDate(build(noIso)));

// M2 — the subtler shape, and the one a "nothing was dropped" check cannot see: drop the ISO branch
// AND widen the length tail, so an ISO stamp comes back as the RAW 25-character timestamp. Nothing
// is empty, so the dropped-date predicate alone stays green — the card would simply render
// «2025-09-21T20:33:43+03:00» at the user. Only the per-row EXPECTED-VALUE assertions catch it,
// which is why this barrier pins values and not just non-emptiness.
const rawTail = noIso.replace('return raw.length <= 12 ? raw : \'\';', 'return raw;');
const rawTailFn = build(rawTail);
mustCatch('an ISO stamp leaking to the card RAW instead of being reordered to DD/MM/YYYY',
  rawTail !== noIso &&
  ISO_ROWS.length > 0 &&
  ISO_ROWS.every((r) => rawTailFn(r.raw) === r.raw && r.raw !== r.expect) &&
  !dropsASourceDate(rawTailFn));

// M3 — the timezone rule: parsing the stamp instead of reading it textually shifts the day the
// SOURCE published for any viewer west of Saudi. Proven against the check's own predicate.
const TZ = /new Date\s*\(|Date\.parse|toLocaleDateString/;
mustCatch('cleanDate starting to parse the stamp through a Date (viewer-timezone drift)',
  TZ.test('const d = new Date(raw); return d.toLocaleDateString();'));
mustCatch('…while the shipped textual implementation is NOT flagged (not vacuously red)',
  !TZ.test(codeOnly));

// M4 — the anchor itself. If the signature is reformatted, the lift finds nothing and this barrier
// must fail loudly rather than silently testing an empty function.
mustCatch('the cleanDate signature drifting out from under the lift',
  CARD.replace('const cleanDate = (raw?: string): string => {', 'const cleanDate = (raw) => {')
      .match(/const cleanDate = \(raw\?: string\): string => \{[\s\S]*?\n {2}\};/) === null);

// CONTROL — the shipped function still returns every real production date.
mustCatch('the shipped cleanDate passing all 9 frozen production rows (the proof is not vacuous)',
  !dropsASourceDate(cleanDate) && ROWS.every((r) => cleanDate(r.raw) === r.expect));

if (mutFail) {
  console.error(`\n${mutFail} guard(s) are BLIND to their own defect`);
  process.exit(1);
}
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
