// A DISTRICT «TYPO» MUST BE A TYPO OF THE SAME WORD — never a different district that happens to share «ال»
// (owner 2026-10-05: «حي الملك» in the AI chat → «ما لقينا نتائج» … «is this true?»).
//
// liveDistrictLookup() (src/data/locations.ts) recovers typo'd district words. It compared the probe and
// every district token WITH their article, and nearly every district word is «ال» + 3–4 letters, so
// «الملك» sat within 2 edits of الملقا, الملز, السلي, الأمل, المها, المجد, العمل… — ~40 unrelated
// districts Kingdom-wide (الملقا, الملز, حي المنح المعدل بعنيزة, حي الجبيل البلد …) were searched as if the
// user had typed them (measured on production: the request's p_districts). That breaks the locked rule
// «never substitute a different place» (project_exact-location-only-rule) and made the search heavy enough
// to time out. districtWordIsTypo() now compares STEMS (article stripped), only for a stem of 4+ letters.
//
// EXECUTED: the real districtWordIsTypo + editDistance are lifted from src/data/locations.ts and run on
// real district names from production. Mutation proof: the pre-fix comparison (article kept) is written
// into a copy of the source and must turn this red.
//
//   node --experimental-strip-types scripts/verify-district-typo-never-floods.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const SRC_PATH = join(ROOT, 'src/data/locations.ts');
const SRC = readFileSync(SRC_PATH, 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type Typo = (probeF: string, tf: string) => boolean;
const lift = async (file: string): Promise<Typo> => (await liftSymbols(
  file,
  [{ header: 'function editDistance(' }, { header: 'const districtStem', endsWith: /;$/ }, { header: 'export function districtWordIsTypo(' }],
  ['districtWordIsTypo'],
)).districtWordIsTypo as Typo;

// Real production district words that sat within 2 edits of «الملك» WITH the article (already folded:
// alef variants → ا, as fuzzyFold does).
const NOT_KING = ['الملقا', 'الملز', 'السلي', 'الامل', 'المها', 'المجد', 'العمل', 'المنسك', 'الفلق'];
// Genuine typos the recovery exists for (stem 4+ letters, one or two slips).
const REAL_TYPOS: Array<[string, string]> = [['الياسمن', 'الياسمين'], ['النرجيس', 'النرجس'], ['العزيزيه', 'العزيزيه'], ['الحمرا', 'الحمراء'.replace('ء', '')]];

const problems = (typo: Typo): string[] => {
  const out: string[] = [];
  for (const w of NOT_KING) if (typo('الملك', w)) out.push(`«الملك» treated as a typo of «${w}» — a different district`);
  for (const [p, d] of REAL_TYPOS) if (!typo(p, d)) out.push(`«${p}» no longer recovers «${d}» — real typo recovery lost`);
  return out;
};

const real = problems(await lift(SRC_PATH));
check('«الملك» is never a typo of الملقا/الملز/السلي/الأمل/المها/… and real typos still recover', real.length === 0, real.join('\n      '));
check('liveDistrictLookup routes its word-level typo check through districtWordIsTypo',
  /const fuzzyTokenHit = \(district: string\): string \| null => \{[\s\S]{0,400}districtWordIsTypo\(probeF, tf\)/.test(SRC));

// ── mutation proof ─────────────────────────────────────────────────────────────────────────────────
const mustCatch = async (what: string, from: string, to: string) => {
  const mutated = SRC.replace(from, to);
  if (mutated === SRC) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const dir = mkdtempSync(join(tmpdir(), 'district-typo-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, mutated);
  const caught = problems(await lift(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatch('comparing WITH the article again (the «حي الملك» flood)',
  'const ps = districtStem(probeF), ts = districtStem(tf);', 'const ps = probeF, ts = tf;');
await mustCatch('dropping the 4-letter stem floor', 'if (ps.length < 4 || ts.length < 4) return false;', 'if (ps.length < 2 || ts.length < 2) return false;');

console.log(failed === 0
  ? '\n✅ a district typo is always a typo of the same word — never a different district.\n'
  : `\n❌ ${failed} check(s) failed — a typed district can be searched as a different one.\n`);
process.exit(failed === 0 ? 0 : 1);
