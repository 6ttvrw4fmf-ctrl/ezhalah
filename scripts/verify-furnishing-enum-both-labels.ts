// Regression test for the furnishing/furniture English leak (owner audit finding M1, 2026-07-17).
//
// WHAT BROKE: ResultCard.tsx's AR_ENUM is keyed on label.toLowerCase(). The same attribute arrives under
// TWO source label spellings — satel sends 'Furnishing', wasalt + aldarim send the legacy 'Furniture'.
// A 2026-07-16 fix RENAMED the dict key 'furniture' -> 'furnishing' to make satel's rows translate, which
// silently stranded the OTHER shape: 2,757 live wasalt/aldarim rows (Un-Furnished 2,617 / Furnished 83 /
// Semi-Furnished 57) then matched no key and rendered «الأثاث: Un-Furnished» — an Arabic label with an
// English value, on the highest-volume platform. Renaming a key is not a safe fix when two shapes exist.
//
// This test pins BOTH label spellings AND every live value, so the next rename fails here instead of in
// production. Static/offline (no DB, no react-native import) — it parses the deployed source, matching the
// repo's existing tripwire style.
//
//   node --experimental-strip-types scripts/verify-furnishing-enum-both-labels.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ResultCard.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── The two label spellings must BOTH be AR_ENUM keys ───────────────────────────────────────────
// Both must resolve to the SAME shared map, so they cannot drift apart again.
check("AR_ENUM has a 'furnishing' key (satel's label)", /\bfurnishing:\s*FURNISH_VALUES_AR\b/.test(SRC));
check("AR_ENUM has a 'furniture' key (wasalt/aldarim's legacy label)", /\bfurniture:\s*FURNISH_VALUES_AR\b/.test(SRC));
check(
  'both keys point at ONE shared value map (cannot drift)',
  /\bfurnishing:\s*FURNISH_VALUES_AR\b/.test(SRC) && /\bfurniture:\s*FURNISH_VALUES_AR\b/.test(SRC),
);
check('the shared map FURNISH_VALUES_AR is declared', /const\s+FURNISH_VALUES_AR\s*:/.test(SRC));

// ── Every value spelling that is LIVE in production must be mapped ──────────────────────────────
// Counts verified against the live DB 2026-07-17 (active rows, additional_info legacy array shape).
const LIVE_VALUES: { value: string; ar: string; live: string }[] = [
  { value: 'un-furnished', ar: 'غير مفروش', live: 'wasalt 2,461 + aldarim 156' },
  { value: 'furnished', ar: 'مفروش', live: 'wasalt 83' },
  { value: 'semi-furnished', ar: 'نصف مفروش', live: 'wasalt 57' },
  { value: 'fully furnished', ar: 'مفروش بالكامل', live: 'satel' },
  { value: 'unfurnished', ar: 'غير مفروش', live: 'satel' },
  { value: 'partially furnished', ar: 'مفروش جزئياً', live: 'satel' },
];
const mapBody = /const\s+FURNISH_VALUES_AR\s*:[^=]*=\s*\{([\s\S]*?)\n\};/.exec(SRC)?.[1] ?? '';
check('FURNISH_VALUES_AR body was parsed', mapBody.length > 0);
for (const { value, ar, live } of LIVE_VALUES) {
  // key may be quoted ('un-furnished') or bare (furnished)
  const keyRe = new RegExp(`(['"]${value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"]|\\b${value}\\b)\\s*:\\s*['"]${ar}['"]`);
  check(`'${value}' -> '${ar}'  [live: ${live}]`, keyRe.test(mapBody));
}

// ── The leak guard must cover BOTH labels ───────────────────────────────────────────────────────
// So a FUTURE unmapped value degrades to the Arabic placeholder instead of rendering raw English.
const guard = /const\s+FREE_TEXT_PROSE_LABELS\s*=\s*new Set\(\[([\s\S]*?)\]\);/.exec(SRC)?.[1] ?? '';
check('FREE_TEXT_PROSE_LABELS was parsed', guard.length > 0);
check("leak guard covers 'furnishing'", /'furnishing'/.test(guard));
check("leak guard covers 'furniture'", /'furniture'/.test(guard));

// ── The AR_ENUM lookup must still run BEFORE the free-text guard ────────────────────────────────
// If the guard ran first it would blank these values instead of translating them.
const enumIdx = SRC.indexOf('const map = AR_ENUM[ll];');
const guardIdx = SRC.indexOf('FREE_TEXT_PROSE_LABELS.has(ll)');
check('AR_ENUM lookup precedes the free-text guard in arAttrValue()', enumIdx > 0 && guardIdx > 0 && enumIdx < guardIdx);

// ── Regression sentinel: no raw English furnishing value may sit outside the map ─────────────────
check(
  "no bare 'Un-Furnished' string literal is returned anywhere in the card",
  !/return\s+['"]Un-Furnished['"]/i.test(SRC),
);

console.log(
  failed === 0
    ? '\n✓ furnishing/furniture enum covers BOTH label spellings and every live value'
    : `\n✗ ${failed} assertion(s) FAILED — a furnishing label/value would render raw English`,
);
process.exit(failed === 0 ? 0 : 1);
