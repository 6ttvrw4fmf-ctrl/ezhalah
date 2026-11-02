// Behavior guard: palette changes must keep small text and controls readable in both scenes.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { lightColors, darkColors } from '../src/theme/palette.ts';
const luminance = (hex: string) => {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const assertReadable = (foreground: string, background: string, label: string) => {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 4.5, `${label} is ${ratio.toFixed(2)}:1; needs 4.5:1`);
};
const assertImageBudget = (bytes: number, name: string) =>
  assert.ok(bytes < 180_000, `${name} exceeds the decorative image budget`);
const mustCatch = (label: string, check: () => void) => {
  assert.throws(check, assert.AssertionError, label);
  console.log(`PASS mutation: ${label}`);
};
for (const [name, p] of [['light', lightColors], ['dusk', darkColors]] as const) {
  for (const [foreground, background] of [
    ['ink', 'surface'], ['body', 'surface'], ['muted', 'surface'], ['primary', 'surface'],
    ['ink', 'paper'], ['muted', 'paper'], ['ink', 'skyTop'], ['ink', 'skyBottom'],
    ['body', 'skyTop'], ['body', 'skyBottom'], ['primary', 'skyTop'], ['primary', 'skyBottom'],
    ['muted', 'skyTop'], ['muted', 'skyBottom'], ['onFill', 'selFill'], ['onFill', 'dark'],
    ['userBubbleText', 'userBubble'],
  ] as const) {
    assertReadable(p[foreground], p[background], `${name}: ${foreground} on ${background}`);
  }
  console.log(`PASS ${name}: small copy and filled controls meet 4.5:1`);
}
// Execute the same assertions against deliberately broken inputs.
mustCatch('white text on a white control is rejected', () => assertReadable('#ffffff', '#ffffff', 'broken control'));
mustCatch('low-contrast secondary copy is rejected', () => assertReadable('#aaaaaa', '#ffffff', 'broken copy'));
mustCatch('an oversized decorative image is rejected', () => assertImageBudget(180_000, 'oversized cloud'));
for (const name of ['desert-day', 'desert-dusk', 'cloud-wisp']) {
  assertImageBudget(statSync(new URL(`../assets/images/${name}.webp`, import.meta.url)).size, name);
}
console.log('PASS decorative images stay below 180 KB each');
