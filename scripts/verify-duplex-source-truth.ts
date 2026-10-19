// DUPLEX MUST SURVIVE INGESTION — a source-published دوبلكس may never be relabelled.
//
// Owner report 2026-08-19: "Duplex looks undercounted". Investigated end to end. Everything BELOW
// ingestion was already exact — raw active Duplex 67 == indexed 67, zero sync drift. The loss was
// entirely at the scraper layer: the 2026-07-16 owner-approved standardization made دوبلكس a
// first-class clean type in the SHARED normalizer (scrapers/common/normalize.py), but only four
// scrapers read that map. Eighteen others still carried stale LOCAL maps folding دوبلكس → Villa, so
// the source's own type was destroyed at write time and the listing could never be found as Duplex.
//
// Aqar, for the record, is NOT part of this: its slug vocabulary has no duplex category at all
// (apartment/villa/floor/house/room/building/rest_house/chalet/camp/land + commercial). Its ~2.4k
// "villa whose text mentions دوبلكس" rows are villas with a duplex LAYOUT. Relabelling them would
// invent a type the source never published — the exact thing SOURCE IS TRUTH forbids.
//
//   node --experimental-strip-types scripts/verify-duplex-source-truth.ts   (wired into `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nDuplex source-truth — a published دوبلكس must stay دوبلكس\n');

// ── 1. the shared normalizer is the standard ─────────────────────────────────────────────────────
const norm = readFileSync(join(root, 'scrapers/common/normalize.py'), 'utf8');
check('shared normalizer maps دوبلكس → Duplex', /"دوبلكس":\s*"Duplex"/.test(norm));
check('shared normalizer maps the دوبليكس spelling too', /"دوبليكس":\s*"Duplex"/.test(norm));

// ── 2. Duplex is a first-class clean type, not folded into a parent ──────────────────────────────
const types = readFileSync(join(root, 'src/data/propertyTypes.ts'), 'utf8');
check("RAW_TO_CLEAN keeps 'Duplex' → 'Duplex' (never Villa)", /'Duplex':\s*'Duplex'/.test(types));
check('Duplex is an offered type in the Villas & Houses group',
  /types:\s*\['Villa',\s*'Duplex'\]/.test(types));
check('Duplex carries its Arabic label دوبلكس', /'Duplex':\s*'دوبلكس'/.test(types));

// ── 3. NO scraper may fold a BARE duplex token into another type ─────────────────────────────────
// Compounds are exempt and audited: the source noun there is not "duplex" — «شقة دبلكسية» / "DUPLEX
// APARTMENT" are apartments with a duplex layout, so Apartment is the faithful reading.
const AUDITED_COMPOUNDS = [/شقة\s*دبلكسية/, /شقه\s*دبلكسية/, /DUPLEX APARTMENT/];
// TWO MAP SHAPES, MATCHED SEPARATELY — because a comma is not a mapping.
//
// The old single regex accepted `"<duplex>" (, | :) "<value>"`, so it also fired on a plain SET or
// list of type names: `{"apartment", "villa", "duplex", "studio"}` read as «duplex → studio», which
// is not a fold and not even a mapping. Worse, JavaScript's \w is ASCII-only, so a map whose VALUE
// is Arabic was skipped entirely and the regex paired the duplex key with the NEXT entry's value —
// «دوبلكس → penthouse» for a map that actually reads `"duplex": "دوبلكس", "penthouse": "شقة"`. That
// blind spot cut both ways: a scraper that really did fold duplex into another ARABIC type also
// went unread.
//
// So: a DICT entry is key : value, a TUPLE pair is ( key , value ), and nothing else is a mapping.
const DUPLEX_TOK = 'دوبلكس|دوبليكس|دبلكس|دبلوكس|دوبلكسات|دبلكسات|دبلوكسات|duplex|DUPLEX';
// The token must be the WHOLE quoted key, not a suffix of a longer phrase. sadiqeltajer's source
// category «فلل ودبلكسات» — "villas AND duplexes" — is a COMBINED bucket: the source itself does
// not say which one a given listing is, so neither Villa nor Duplex is a fold, and it belongs with
// the audited compounds above rather than in the offender list. An unanchored match read its tail
// as a bare «دبلكسات» key and reported a fold that is not one.
const DUPLEX_DICT = new RegExp(`"(${DUPLEX_TOK})"\\s*:\\s*"([^"]+)"`, 'g');
const DUPLEX_TUPLE = new RegExp(`\\(\\s*"(${DUPLEX_TOK})"\\s*,\\s*"([^"]+)"`, 'g');

// Both of these value shapes are faithful:
//   Arabic → clean   ("دوبلكس": "Duplex")   — the value must be exactly Duplex.
//   English → Arabic ("duplex": "دوبلكس")   — the value must be a duplex-family Arabic noun, which
//                                             normalize.map_type_exact then resolves to Duplex
//                                             (asserted in section 2 above).
// Anything else — duplex landing on شقة, فيلا, studio, penthouse — is the fold this barrier stops.
const DUPLEX_AR = new Set(['دوبلكس', 'دوبليكس', 'دبلكس', 'دبلوكس', 'دوبلكسات', 'دبلكسات', 'دبلوكسات']);

const offenders: string[] = [];
const scrapersDir = join(root, 'scrapers');
for (const plat of readdirSync(scrapersDir)) {
  const f = join(scrapersDir, plat, 'run.py');
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  for (const line of src.split('\n')) {
    if (AUDITED_COMPOUNDS.some((re) => re.test(line))) continue;
    for (const re of [DUPLEX_DICT, DUPLEX_TUPLE]) {
      for (const m of line.matchAll(re)) {
        if (m[2] !== 'Duplex' && !DUPLEX_AR.has(m[2])) offenders.push(`${plat}: ${m[1]} → ${m[2]}`);
      }
    }
  }
}
check('no scraper folds a bare duplex token into another type', offenders.length === 0,
  offenders.join('; ') + '  — a source-published Duplex must reach the index as Duplex');

// MUTATION PROOF for the widened group-2 capture: the ARABIC-valued shape this check was blind to
// must now be caught when it folds, and must NOT be caught when it is faithful. Without this, the
// widening above could silently be a hole rather than a fix.
const probe = (line: string) => {
  const found: string[] = [];
  for (const re of [DUPLEX_DICT, DUPLEX_TUPLE]) {
    for (const m of line.matchAll(re)) {
      if (m[2] !== 'Duplex' && !DUPLEX_AR.has(m[2])) found.push(`${m[1]} → ${m[2]}`);
    }
  }
  return found;
};
check('(mutation) an English→Arabic map that folds duplex into شقة is CAUGHT',
  probe('    "duplex": "شقة", "studio": "استوديو",').length === 1,
  JSON.stringify(probe('    "duplex": "شقة", "studio": "استوديو",')));
check('(mutation) a faithful English→Arabic duplex map is NOT reported',
  probe('    "duplex": "دوبلكس", "studio": "استوديو",').length === 0,
  JSON.stringify(probe('    "duplex": "دوبلكس", "studio": "استوديو",')));
check('(mutation) the original Arabic→clean fold is still caught',
  probe('    "دوبلكس": "Villa",').length === 1,
  JSON.stringify(probe('    "دوبلكس": "Villa",')));
check('(mutation) a TUPLE-shaped fold is still caught',
  probe('    ("duplex", "Villa"),').length === 1,
  JSON.stringify(probe('    ("duplex", "Villa"),')));
check('(mutation) a plain SET of type names is NOT a mapping and is not reported',
  probe('_DWELLING = {"apartment", "villa", "duplex", "studio", "floor"}').length === 0,
  JSON.stringify(probe('_DWELLING = {"apartment", "villa", "duplex", "studio", "floor"}')));
check('(mutation) an Arabic SET of type nouns is not reported either',
  probe('_AR = {"شقة", "دوبلكس", "استوديو"}').length === 0,
  JSON.stringify(probe('_AR = {"شقة", "دوبلكس", "استوديو"}')));
check('(mutation) a COMBINED source category «فلل ودبلكسات» is not a bare-token fold',
  probe('    "فلل ودبلكسات": "فيلا",').length === 0,
  JSON.stringify(probe('    "فلل ودبلكسات": "فيلا",')));
check('(mutation) …but a BARE duplex key folded to فيلا still is',
  probe('    "دبلكسات": "فيلا",').length === 1,
  JSON.stringify(probe('    "دبلكسات": "فيلا",')));

console.log(failures === 0
  ? '\n✓ Duplex survives ingestion: shared map standard, first-class clean type, zero folds\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
