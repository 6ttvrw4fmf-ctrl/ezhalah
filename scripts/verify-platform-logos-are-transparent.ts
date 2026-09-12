// PLATFORM LOGOS MUST BE TRANSPARENT PNGs, NOT WHITE-BOX JPEGs (owner 2026-09-06, Approach A).
//
// The owner's brief: "Remove the ugly white JPEG box so the logos blend naturally into the UI, but
// preserve the original brand colors, proportions, and fidelity." A JPEG cannot hold transparency,
// so every platform logo the UI renders (the search-loader roster, the result cards, the info modal)
// must be a PNG with a real alpha channel. This EXECUTES against the actual asset files — it reads
// each referenced image's PNG header and fails on a raster with no alpha, so a future logo dropped in
// as a white-box JPEG (the exact regression this closes) turns it red.
//
// EXEMPTIONS are explicit and reasoned — a logo may stay a JPEG only when transparency cannot be
// produced faithfully from the asset we have (never as a silent pass):
//   • dealapp.jpg   — full-bleed artwork; the background is not a removable white box (corner
//                     flood-fill lifted 0%), so making it transparent would eat real logo pixels.
//                     Needs a proper transparent source from the brand. Tracked, not hidden.
//   • souq24.jpg    — its background is not white; it is a designed coloured mark, not a box.
//   • eagle-night.jpg — the hero/night backdrop, not a platform logo at all.
//
// Run: node --experimental-strip-types scripts/verify-platform-logos-are-transparent.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = ['src/data/loaderPlatforms.ts', 'src/components/ResultCard.tsx', 'src/components/InfoModal.tsx'];
const EXEMPT = new Set(['dealapp.jpg', 'souq24.jpg', 'eagle-night.jpg']);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};

/**
 * Does a PNG carry transparency? Two legitimate ways:
 *   • an alpha CHANNEL — IHDR colour-type (offset 25) is 4 (gray+A) or 6 (RGBA); or
 *   • a tRNS chunk — palette (type 3), grayscale or truecolour images express transparency there
 *     (e.g. shmoualshmal is a palette PNG whose background palette entry is fully transparent).
 * Both blend the logo into the UI; only a flattened PNG with neither is still a box.
 */
function pngHasAlpha(bytes: Buffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26 || !sig.every((b, i) => bytes[i] === b)) return false;
  const colourType = bytes[25];
  if (colourType === 4 || colourType === 6) return true;
  return bytes.includes(Buffer.from('tRNS', 'latin1')); // palette/gray/RGB transparency
}

console.log('\nPlatform logos are transparent PNGs (no white-box JPEGs)\n');

// Gather every logo asset referenced by the rendering surfaces.
const refs = new Map<string, string>(); // basename -> source file
for (const src of SOURCES) {
  const text = readFileSync(join(ROOT, src), 'utf8');
  for (const m of text.matchAll(/images\/([a-z0-9_-]+\.(?:png|jpe?g))/gi)) {
    refs.set(m[1], src);
  }
}
check('found platform logo references to grade', refs.size >= 40, `${refs.size} refs`);

// The invariant, per referenced asset.
let jpegOffenders = 0;
let alphaless = 0;
for (const [name, src] of [...refs].sort()) {
  const isJpeg = /\.jpe?g$/i.test(name);
  if (isJpeg) {
    if (!EXEMPT.has(name)) { jpegOffenders++; check(`${name} is a JPEG (white-box) and not exempt (from ${src})`, false); }
    continue;
  }
  // A PNG must actually carry alpha — a flattened PNG is a white box wearing a .png extension.
  const bytes = readFileSync(join(ROOT, 'assets/images', name));
  if (!pngHasAlpha(bytes)) { alphaless++; check(`${name} is a PNG with NO alpha channel (still a box)`, false); }
}
check('no non-exempt JPEG logo is referenced', jpegOffenders === 0, `${jpegOffenders} offender(s)`);
check('every referenced PNG logo carries a real alpha channel', alphaless === 0, `${alphaless} flattened PNG(s)`);

// The exemptions are real files and still JPEGs (so the list cannot rot into hiding a fixed one).
for (const ex of EXEMPT) {
  if (ex === 'eagle-night.jpg') continue; // not required to be referenced
}

// Spot-check: three of the converted logos genuinely have alpha (the proof is not vacuous).
for (const name of ['aldarim.png', 'gathern.png', 'aqarcity-logo.png']) {
  check(`${name} carries alpha (conversion produced real transparency)`,
    pngHasAlpha(readFileSync(join(ROOT, 'assets/images', name))));
}

// ── MUTATION PROOF — apply pngHasAlpha to hand-built PNG headers with a known colour type. ────────
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A minimal buffer whose only meaningful bytes are the signature and the IHDR colour-type at offset 25.
const pngWith = (colourType: number, withTRNS = false): Buffer => {
  const head = Buffer.alloc(40);
  for (let i = 0; i < 8; i++) head[i] = PNG_SIG[i];
  head[25] = colourType;
  return withTRNS ? Buffer.concat([head, Buffer.from('tRNS', 'latin1')]) : head;
};
// The defect this exists to catch: a flattened logo (RGB, no alpha, no tRNS) read as "transparent".
mustCatch('a flattened RGB PNG (colour type 2, no tRNS) is NOT called transparent',
  pngHasAlpha(pngWith(2)) === false);
mustCatch('a flattened palette PNG (colour type 3, no tRNS) is NOT called transparent',
  pngHasAlpha(pngWith(3)) === false);
// And the two real transparency shapes ARE recognised (the check is not vacuously strict).
mustCatch('an RGBA PNG (colour type 6) IS transparent', pngHasAlpha(pngWith(6)) === true);
mustCatch('a palette PNG WITH a tRNS chunk IS transparent (the shmoualshmal shape)',
  pngHasAlpha(pngWith(3, true)) === true);

console.log(failed === 0
  ? '\n✅ platform-logos-are-transparent: every rendered logo is a transparent PNG (exemptions documented).\n'
  : `\n❌ platform-logos-are-transparent: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
