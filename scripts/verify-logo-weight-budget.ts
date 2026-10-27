// ALWAYS FAST: PLATFORM LOGOS STAY LIGHT (owner 2026-10-27: «always keep it fast»).
//
// Measured that day on ezhalah.com: the home page downloaded 13.7 MB of images, mostly platform logos stored at up to
// 1,417 px (one 838 KB) while shown in ~96x48 css px frames. They were shrunk to 1.7 MB with no visible change. This
// keeps them there: every logo ≤ 60 KB and the whole pack ≤ 2.5 MB. A new or replaced logo that is too heavy fails
// here — shrink it (≤ 320 px longest side, palette PNG with alpha) before it ships.
//   node --experimental-strip-types scripts/verify-logo-weight-budget.ts   (discovered by `npm test`)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const DIRS = ['assets/images/platform-logos', 'assets/images/platform-clean'];
export const MAX_LOGO_KB = 60;
export const MAX_PACK_KB = 2_500;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

type Logo = { file: string; kb: number };
const problems = (logos: Logo[]): string[] => {
  const out = logos.filter((l) => l.kb > MAX_LOGO_KB).map((l) => `${l.file} is ${l.kb.toFixed(0)} KB (max ${MAX_LOGO_KB})`);
  const total = logos.reduce((a, l) => a + l.kb, 0);
  if (total > MAX_PACK_KB) out.push(`the logo pack is ${total.toFixed(0)} KB (max ${MAX_PACK_KB})`);
  return out;
};

const logos: Logo[] = DIRS.flatMap((d) => readdirSync(join(root, d)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .map((f) => ({ file: `${d}/${f}`, kb: statSync(join(root, d, f)).size / 1024 })));
check('the logo folders were read (not an empty pass)', logos.length > 100, String(logos.length));
const found = problems(logos);
check(`every logo ≤ ${MAX_LOGO_KB} KB and the pack ≤ ${MAX_PACK_KB} KB (now ${logos.reduce((a, l) => a + l.kb, 0).toFixed(0)} KB)`, found.length === 0, found.slice(0, 5).join('; '));
mustCatch('one heavy logo (the 838 KB kind)', problems([...logos, { file: 'x.png', kb: 838 }]).length > 0);
mustCatch('a pack that grows past the budget one small logo at a time', problems(Array.from({ length: 200 }, (_, i) => ({ file: `${i}.png`, kb: 15 }))).length > 0);

if (failed) { console.error(`\n❌ verify-logo-weight-budget: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-logo-weight-budget: the platform logos stay light.');
