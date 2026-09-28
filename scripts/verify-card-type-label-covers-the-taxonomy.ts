// EVERY TAXONOMY TYPE RENDERS IN ARABIC ON THE CARD (night audit 2026-09-28).
//
// ResultCard shows the raw type when it is Arabic, else t(cleanType) through the i18n dictionary.
// The dictionary had no entry for 12 taxonomy labels, so a source storing the English type (SuperOffice
// «Meeting Room», Sirdab «Self Storage», October «ATM Site»…) showed «نوع غير محدد» live — on the very
// types the owner had just asked to be labelled with the source's word. i18n.tsx now backfills any
// missing type from EN_TO_AR. This guard reads the source (i18n.tsx imports react-native, so it cannot
// be executed under node) and proves: (1) the backfill is present and imports EN_TO_AR, and (2) every
// taxonomy label is covered — by an explicit entry or by the backfill — with an Arabic value.
//   node --experimental-strip-types scripts/verify-card-type-label-covers-the-taxonomy.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const labels: Record<string, string> = JSON.parse(readFileSync(join(root, 'src/data/taxonomy.source.json'), 'utf8')).labels;
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};

const backfill = /for \(const \[en, ar\] of Object\.entries\(EN_TO_AR\)\) if \(!\(en in AR\)\) AR\[en\] = ar;/;
const arabic = /[ء-ي]/;
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// THE predicate: the taxonomy labels a given i18n.tsx source would render as «نوع غير محدد».
const gaps = (src: string): string[] => {
  const filled = /import \{ EN_TO_AR \} from '@\/data\/propertyTypes';/.test(src) && backfill.test(src);
  return Object.entries(labels).filter(([en, ar]) => {
    const explicit = src.match(new RegExp(`['"]${esc(en)}['"]\\s*:\\s*['"]([^'"]*)['"]`));
    return !arabic.test(explicit ? explicit[1] : (filled ? ar : ''));
  }).map(([en]) => en);
};

check('every taxonomy label renders in Arabic on the card', gaps(i18n).length === 0, gaps(i18n).join(', '));

const mustCatch = (what: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${caught ? 'catches' : 'did NOT catch'} ${what}`);
  if (!caught) failures++;
};
mustCatch('the 2026-09-28 defect: the backfill line removed', gaps(i18n.replace(backfill, '')).length > 0);
mustCatch('the backfill present but EN_TO_AR never imported', gaps(i18n.replace(/import \{ EN_TO_AR \} from '@\/data\/propertyTypes';\n/, '')).length > 0);

console.log(failures ? `\n✗ ${failures} check(s) FAILED` : '\n✓ every taxonomy type has an Arabic card label');
process.exit(failures ? 1 : 0);
