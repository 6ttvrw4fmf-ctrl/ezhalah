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
const BARE_DUPLEX = /(?:"|\()\s*"?(دوبلكس|دوبليكس|دبلكس|دبلوكس|دوبلكسات|دبلكسات|دبلوكسات|duplex|DUPLEX)"?\s*(?:,|:)\s*"(\w[\w ]*)"/g;

const offenders: string[] = [];
const scrapersDir = join(root, 'scrapers');
for (const plat of readdirSync(scrapersDir)) {
  const f = join(scrapersDir, plat, 'run.py');
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  for (const line of src.split('\n')) {
    if (AUDITED_COMPOUNDS.some((re) => re.test(line))) continue;
    for (const m of line.matchAll(BARE_DUPLEX)) {
      if (m[2] !== 'Duplex') offenders.push(`${plat}: ${m[1]} → ${m[2]}`);
    }
  }
}
check('no scraper folds a bare duplex token into another type', offenders.length === 0,
  offenders.join('; ') + '  — a source-published Duplex must reach the index as Duplex');

console.log(failures === 0
  ? '\n✓ Duplex survives ingestion: shared map standard, first-class clean type, zero folds\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
