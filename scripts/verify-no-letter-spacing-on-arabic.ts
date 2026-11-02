// Barrier — no letter-spacing (tracking) on any style that can render Arabic (owner 2026-10-24).
//
// The welcome headline showed «حياك الله يوسف…» with «الله» as plain separate letters: the Arabic hero style
// carried letterSpacing -0.6, and any non-zero letter-spacing makes the browser drop ligatures — the Allah
// ligature included — and pulls joined letters apart. Tracking is allowed only where the text is Latin:
//   • a style whose NAME ends in `En` or `Latin` (applied only in the English UI / to a Latin word);
//   • the Home screen's English-only layer `E` (index.tsx: `const x = locale === 'en' ? E : {}`);
//   • IntroVideo's `word`, which renders the literal Latin «EZHALAH».
// And nothing may switch ligatures off (font-variant-ligatures / font-feature-settings).
//   node --experimental-strip-types scripts/verify-no-letter-spacing-on-arabic.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
const walk = (d: string, out: Record<string, string> = {}) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out[p] = read(p);
  }
  return out;
};
const LATIN_ONLY = new Set(['src/components/IntroVideo.tsx:word']);

/** Every non-zero tracking that can land on Arabic, as "file:line style" strings. */
export function trackingProblems(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    const lines = src.split('\n');
    // The Home screen's English-only StyleSheet `E` (lines between `const E = StyleSheet.create({` and its `});`).
    let inE = false;
    lines.forEach((line, i) => {
      if (file.endsWith('src/app/index.tsx') && /^const E = StyleSheet\.create\(\{/.test(line)) inE = true;
      else if (inE && /^\}\);/.test(line)) inE = false;
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const m of line.matchAll(/(?:letterSpacing\s*:\s*|letter-spacing\s*:\s*)(-?[\d.]+)/g)) {
        if (Number(m[1]) === 0) continue;
        const key = /^\s*([A-Za-z0-9_]+)\s*:\s*\{/.exec(line)?.[1] ?? '?';
        const latin = /(En|Latin)$/.test(key) || LATIN_ONLY.has(`${file}:${key}`) || (inE && file.endsWith('src/app/index.tsx'));
        if (!latin) out.push(`${file}:${i + 1} ${key} has letterSpacing ${m[1]}`);
      }
      if (/font-variant-ligatures\s*:\s*none|fontVariantLigatures\s*:\s*['"]none|['"]liga['"]\s*0|['"]rlig['"]\s*0|liga\s*off/i.test(line)) out.push(`${file}:${i + 1} switches ligatures off`);
    });
  }
  return out;
}

const files = walk('src');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const p = trackingProblems(files);
check('no letter-spacing on any style that can render Arabic; no ligature switched off', p.length === 0, p.join('\n      '));
const HOME = 'src/app/index.tsx', CARD = 'src/components/ResultCard.tsx', SIDE = 'src/components/Sidebar.tsx', UI = 'src/components/ui.tsx';
const mut = (f: string, from: string, to: string) => {
  if (!files[f].includes(from)) throw new Error(`mutation anchor missing in ${f}: ${from}`);
  return { ...files, [f]: files[f].replace(from, to) };
};
mustCatch('the 2026-10-24 bug back: tracking on the Arabic hero headline',
  trackingProblems(mut(HOME, "heroTitle: { fontSize: 24, fontWeight: '700', color: colors.ink, textAlign: 'center', lineHeight: 28 },", "heroTitle: { fontSize: 24, fontWeight: '700', color: colors.ink, letterSpacing: -0.6, textAlign: 'center', lineHeight: 28 },")).length > 0);
mustCatch('tracking on Arabic listing titles', trackingProblems(mut(CARD, "title: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },", "title: { fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3, flexShrink: 1 },")).length > 0);
mustCatch('the sidebar\'s Arabic group titles tracked again', trackingProblems(mut(SIDE, "textTransform: 'uppercase' },", "textTransform: 'uppercase', letterSpacing: 0.5 },")).length > 0);
mustCatch('the Arabic field labels tracked again', trackingProblems(mut(UI, "color: colors.primary, marginBottom: 8,", "color: colors.primary, letterSpacing: 0.55, marginBottom: 8,")).length > 0);
mustCatch('a CSS string with letter-spacing', trackingProblems({ ...files, 'src/lib/x.ts': "const CSS = `[data-ezh-shine]{letter-spacing:.5px}`;" }).length > 0);
mustCatch('ligatures switched off', trackingProblems({ ...files, 'src/lib/x.ts': "const t = { fontVariantLigatures: 'none' };" }).length > 0);
mustCatch('tracking on a style with an ordinary (non-Latin) name', trackingProblems({ ...files, 'src/lib/x.ts': '  word: { letterSpacing: 2 },' }).length > 0);
check('Latin-only tracking stays allowed (wordLatin, *En, the English layer E, «EZHALAH»)',
  trackingProblems({ ...files, 'src/lib/x.ts': '  wordLatin: { letterSpacing: 2 },\n  boxTextEn: { letterSpacing: -0.2 },' }).length === 0);
// The rendering side of the rule: the Sidebar applies its Latin tracking only off-RTL.
check('the sidebar applies the group-title tracking only in the English UI', /\[s\.groupTitle, !isRTL && s\.groupTitleEn,/.test(files[SIDE]));
mustCatch('the Latin tracking applied in Arabic too', !/\[s\.groupTitle, !isRTL && s\.groupTitleEn,/.test(files[SIDE].replace('!isRTL && s.groupTitleEn', 's.groupTitleEn')));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nOK — Arabic is never tracked; ligatures stay on.');
process.exit(failures ? 1 : 0);
