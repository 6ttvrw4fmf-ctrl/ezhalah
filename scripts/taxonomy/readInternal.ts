// ─────────────────────────────────────────────────────────────────────────────────────────
// Ground-truth reader for the TWO non-exported maps in src/data/propertyTypes.ts
// (RAW_TO_CLEAN, EN_TO_AR). It slices their object literals out of the source text and eval-s them
// with the one computed key (STUDIO_AR_SHADDA_FIRST) in scope. This is how the offline drift gate
// gets the DEPLOYED values of those two maps to diff against the generated ones — it NEVER mutates
// the file, and imports nothing at runtime. Exported maps (CLEAN_MACRO, CLEAN_TO_QUERY, …) are
// imported normally by callers; only these two are unexported and must be read this way.
// ─────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROPERTY_TYPES_PATH = resolve(HERE, '../../src/data/propertyTypes.ts');

function sliceObjectLiteral(src: string, declRegex: RegExp): string {
  const m = declRegex.exec(src);
  if (!m) throw new Error(`could not find declaration for ${declRegex}`);
  const start = src.indexOf('{', m.index);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces for ${declRegex}`);
}

export function readInternalMaps(): { RAW_TO_CLEAN: Record<string, string>; EN_TO_AR: Record<string, string> } {
  const src = readFileSync(PROPERTY_TYPES_PATH, 'utf8');
  // The one computed key used inside RAW_TO_CLEAN / CLEAN_TO_QUERY (non-NFC studio byte variant).
  const shaddaM = /const STUDIO_AR_SHADDA_FIRST = '([^']*)'/.exec(src);
  if (!shaddaM) throw new Error('STUDIO_AR_SHADDA_FIRST not found in propertyTypes.ts');
  // eslint-disable-next-line no-eval
  const STUDIO_AR_SHADDA_FIRST: string = eval(`'${shaddaM[1]}'`);
  const rawLit = sliceObjectLiteral(src, /const RAW_TO_CLEAN:\s*Record<string, string>\s*=/);
  const enLit = sliceObjectLiteral(src, /const EN_TO_AR:\s*Record<string, string>\s*=/);
  const make = (lit: string): Record<string, string> =>
    // eslint-disable-next-line no-new-func
    new Function('STUDIO_AR_SHADDA_FIRST', `return (${lit});`)(STUDIO_AR_SHADDA_FIRST);
  return { RAW_TO_CLEAN: make(rawLit), EN_TO_AR: make(enLit) };
}
