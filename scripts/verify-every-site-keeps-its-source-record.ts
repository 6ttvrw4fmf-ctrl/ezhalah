// EVERY SITE KEEPS ITS SOURCE RECORD'S FACTS (owner 2026-10-13: «store every extra info possible for new listings»).
//
// scrapers/common/capture.py rebinds a site's mapper so the facts the source published beside the columns we map (a discount
// label, views, guest capacity, negotiable, facade …) ride along in source_capture.source_item instead of being dropped.
// A site that is not enrolled silently loses them again, so enrolment is a barrier, not a habit:
//   1. every scrapers/<site>/run.py that defines a mapping function calls capture_source_items(globals()) before its `if __name__`
//      guard (so a NEW site cannot forget);
//   2. the sites that cannot be enrolled by that one line yet are named below, with the reason — SHRINK-ONLY: enrolling one makes
//      this fail until it is deleted from the list;
//   3. capture.py keeps its PDPL promises: person / credential / media / text fields are never read, free-text lists are not read
//      generically (ibaax's «features» carried a person's name + ID), the PDPL scrubbers run, the snapshot is size-capped.
//
//   node --experimental-strip-types scripts/verify-every-site-keeps-its-source-record.ts   (wired into `npm test`)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nEvery site keeps its source record\n');

const MAP_FN = /^def (?:map_listing|map_listings|map_units|map_unit|map_item|map_marker|map_compound)\(/m;
const CALL = /^capture_source_items\(globals\(\)(?:, keep=\([^)]*\))?\)$/m;
const IMPORT = /^from scrapers\.common\.capture import capture_source_items/m;
const GUARD = /^if __name__ == ['"]__main__['"]:/m;
const enrolled = (src: string) => IMPORT.test(src) && CALL.test(src) && (!GUARD.test(src) || src.search(CALL) < src.search(GUARD));

// Sites whose mapping is not a function named map_* (or that have no mapper at all). Each needs a human to read its real
// payload and enrol it with the right function name / keep list. aqar, wasalt and rawasidark already build their own rich
// source_capture. SHRINK-ONLY.
const NOT_ENROLLED: Record<string, string> = {
  albukaeri: 'mapper not named map_*', arsh: 'mapper not named map_*', ashab: 'mapper not named map_*', daraa: 'mapper not named map_*',
  earthapp: 'mapper not named map_*', eightfloor: 'mapper not named map_*', maktab: 'mapper not named map_*', manzo: 'mapper not named map_*',
  ryadah: 'mapper not named map_*', shomou: 'mapper not named map_*', sirdab: 'mapper not named map_*', superoffice: 'mapper not named map_*',
  tawia: 'mapper not named map_*', vmksa: 'mapper not named map_*', wajaf: 'mapper not named map_*',
  aqar: 'builds its own rich source_capture (enrich_*)', wasalt: 'builds its own rich source_capture', rawasidark: 'builds its own rich source_capture',
  alhumaidan: '14-line stub, no mapper', gudai: '14-line stub, no mapper', safera: '14-line stub, no mapper',
};

const sites = readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'scrapers', d.name, 'run.py'))).map((d) => d.name).sort();
const src = (d: string) => readFileSync(join(ROOT, 'scrapers', d, 'run.py'), 'utf8');

const missing = sites.filter((d) => MAP_FN.test(src(d)) && !enrolled(src(d)));
check(`every site that defines a mapper keeps its source record (${sites.filter((d) => MAP_FN.test(src(d))).length} enrolled)`, missing.length === 0, missing.join(', '));
const sample = sites.find((d) => MAP_FN.test(src(d)))!;
mustCatch('a site that drops the capture line', !enrolled(src(sample).replace(CALL, '')));
mustCatch('a site that calls it AFTER the main guard (the guard runs main() first, so the rebinding never happens)', !enrolled(src(sample).replace(CALL, '') + '\ncapture_source_items(globals())\n'));

const stale = Object.keys(NOT_ENROLLED).filter((d) => !sites.includes(d) || enrolled(src(d)));
check('the not-enrolled list is exact (shrink-only: enrolled or deleted sites must leave it)', stale.length === 0, stale.join(', '));
const unaccounted = sites.filter((d) => !MAP_FN.test(src(d)) && !(d in NOT_ENROLLED));
check('every site is either enrolled or named in the not-enrolled list with a reason', unaccounted.length === 0, unaccounted.join(', '));

// ── the module keeps its PDPL promises ──────────────────────────────────────────────────────────────────────────────────────
const cap = readFileSync(join(ROOT, 'scrapers/common/capture.py'), 'utf8');
const never = windowBetween(cap, '_NEVER_WORDS = (', '_FACT_EXACT', 'capture.py');
const classes = ['user', 'broker', 'advertis', 'owner', 'agent', 'seller', 'phone', 'mobile', 'whatsapp', 'email', 'name', 'url', 'photo', 'token', 'signature', 'guarant', 'national', 'اسم', 'مسوق', 'جوال', 'هاتف'];
const lacks = classes.filter((c) => !never.includes(`"${c}"`));
check('person / contact / credential / media / text field names are never read', lacks.length === 0, lacks.join(', '));
mustCatch('«phone» leaving the never-read list', ['phone'].some((c) => !never.replace('"phone", ', '').includes(`"${c}"`)));
const pdpl = (s: string) => /strip_pii_fields\(_walk\(/.test(s) && /redact_capture\(snap\)/.test(s);
check('the shared PDPL scrubbers run on every snapshot (strip_pii_fields + redact_capture)', pdpl(cap));
mustCatch('the redactor being skipped', !pdpl(cap.replace('redact_capture(snap)', 'snap')));
const lists = (s: string) => /if explicit:\s+# a human reviewed this site's list/.test(s) && /numbers \/ flags only/.test(s);
check('free-text lists (features, amenities, tags) are read only for a site that opts in with keep=', lists(cap));
mustCatch('free-text lists being read for every site', !lists(cap.replace('if explicit:', 'if True:')));
check('the snapshot is size-capped and ids / URLs inside labels are never kept', /MAX_BYTES = \d+/.test(cap) && /_ID_LIKE/.test(cap) && /startswith\(\("http:\/\/", "https:\/\/", "\/\/"\)\)/.test(cap));
check('the capture can never cost the listing (a failure returns the mapper\'s own result)', /except Exception:\s+# capture is a bonus record/.test(cap));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ every site keeps its source record');
