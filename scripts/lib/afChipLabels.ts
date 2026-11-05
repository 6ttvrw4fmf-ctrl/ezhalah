// The Arabic label a customer reads on an Advanced Filter chip, derived from the SAME two sources the app renders it
// from: CHIP_DEFS (src/lib/afChips.ts: token → EN i18n key) and the Arabic dictionary in src/i18n.tsx (🔬 2026-11-05).
//
// Why: scripts/verify-af-option-card-truth-live.ts kept a hand-written EXPECTED_LABEL map. When the word-reader chips
// (majlis, roof, … 150 tokens) were certified, that map did not follow, and the card-truth live check aborted with
// «FATAL: certified amenity token(s) with no EXPECTED_LABEL entry» on every run (af-live-truth-check 41957465387,
// alert 11763, backlog 1321) — so nothing it guards was being checked. A label is a translation the app already
// holds; reading it from there cannot drift.
//
// src/i18n.tsx is TSX (JSX), so it is read as text, not imported. Keys and values may carry escaped quotes
// ('Kids\' pool'), which the parser unescapes.
import fs from 'node:fs';
import path from 'node:path';
import { CHIP_DEFS } from '../../src/lib/afChips.ts';

const PAIR = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\\n])*)\3/g;
const ARABIC = /[؀-ۿ]/;
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** EN key → Arabic, for every entry of the i18n source text whose value is Arabic. */
export function arabicDictionary(i18nSource: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of i18nSource.matchAll(PAIR)) {
    const key = unescape(m[2]);
    const val = unescape(m[4]);
    if (ARABIC.test(val) && !out.has(key)) out.set(key, val);
  }
  return out;
}

let cached: Map<string, string> | null = null;
function dictionary(root = process.cwd()): Map<string, string> {
  if (!cached) cached = arabicDictionary(fs.readFileSync(path.join(root, 'src/i18n.tsx'), 'utf8'));
  return cached;
}

/** The Arabic chip label for a token, or null when the app has no chip definition or no Arabic for it. */
export function chipArabicLabel(token: string, dict: Map<string, string> = dictionary(),
  defs: Record<string, { labelKey: string }> = CHIP_DEFS): string | null {
  const key = defs[token]?.labelKey;
  return (key && dict.get(key)) || null;
}

/** Every CHIP_DEFS token whose Arabic label cannot be found — must be empty. */
export function unlabelledChips(dict: Map<string, string> = dictionary(),
  defs: Record<string, { labelKey: string }> = CHIP_DEFS): string[] {
  return Object.keys(defs).filter((t) => !chipArabicLabel(t, dict, defs));
}
