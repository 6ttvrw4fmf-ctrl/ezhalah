// THE PHONE'S TOP BAR IS SKY, NOT WHITE (owner 2026-11-05: «why on top is white? we need blue»). iPhone Safari tints its
// top bar from the page's base layer; ours was transparent, so it painted white above the sky header. +html.tsx must
// give <html> the header's sky through the palette variable (so the dark theme follows) and declare theme-color from
// the palette for both schemes — never a hard-coded hex. Hermetic: reads the source.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const src = readFileSync(new URL('../src/app/+html.tsx', import.meta.url), 'utf8');
export const skyTop = (s: string) =>
  /html\{background-color:var\(--ez-skyTop\)\}/.test(s)
  && /<meta name="theme-color" media="\(prefers-color-scheme: light\)" content=\{lightColors\.skyTop\} \/>/.test(s)
  && /<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content=\{darkColors\.skyTop\} \/>/.test(s);

check('<html> carries the sky colour and theme-color comes from the palette (light and dark)', skyTop(src));
mustCatch('base layer back to transparent', !skyTop(src.replace('html{background-color:var(--ez-skyTop)}', 'html{}')));
mustCatch('a hard-coded white theme-color', !skyTop(src.replace('content={lightColors.skyTop}', 'content="#ffffff"')));
mustCatch('dark scheme dropped', !skyTop(src.replace(/<meta name="theme-color" media="\(prefers-color-scheme: dark\)"[^\n]*\n/, '')));

if (failed) { console.error(`\n❌ verify-top-bar-is-sky: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-top-bar-is-sky: the phone top bar shows the sky, in both themes.');
