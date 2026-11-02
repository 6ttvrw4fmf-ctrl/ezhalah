// THE 👍 👎 SHARE 🔊 ROW KEEPS ONE ORDER IN EVERY LANGUAGE (owner 2026-10-23, iPhone screenshot: an Arabic
// reply showed the row mirrored — 🔊 share 👎 👍 — while the English one read 👍 👎 share 🔊; «keep it
// standard, copied like how the English is, just fix the order»). Only the row's EDGE follows the reply's
// language (right-aligned for Arabic); the order of the icons, and the thumbs' own slots, never mirror.
//
//   node --experimental-strip-types scripts/verify-feedback-icon-order-never-mirrors.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/components/FeedbackRow.tsx', import.meta.url), 'utf8');

function problems(a: string): string[] {
  const bad: string[] = [];
  if (!/<View style=\{\[fb\.row, \{ flexDirection: 'row' \}\]\}>/.test(a)) bad.push("the icon row is not pinned to flexDirection: 'row' in every language");
  if (/row-reverse/.test(a)) bad.push('a row-reverse is back in FeedbackRow (the Arabic icons would mirror)');
  if (!/rtl=\{false\} reducedMotion=\{reducedMotion\}/.test(a)) bad.push("the thumbs' slots are mirrored by language (rtl is not pinned false)");
  if (!/alignItems: isRTL \? 'flex-end' : 'flex-start'/.test(a)) bad.push("the row's edge no longer follows the language (an Arabic reply must stay right-aligned)");
  return bad;
}
let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };
check('the feedback icons read 👍 👎 share 🔊 in every language, right-aligned only for Arabic', problems(src));
mustCatch('the 2026-10-23 mirrored Arabic row', problems(src.replace("flexDirection: 'row' }]}>", "flexDirection: isRTL ? 'row-reverse' : 'row' }]}>")));
mustCatch('mirrored thumb slots', problems(src.replace('rtl={false} reducedMotion', 'rtl={isRTL} reducedMotion')));
mustCatch('an Arabic reply losing its right edge', problems(src.replace("alignItems: isRTL ? 'flex-end' : 'flex-start'", "alignItems: 'flex-start'")));
console.log(failed ? `\n${failed} FAILED` : '\nAll feedback-icon-order assertions passed');
process.exit(failed ? 1 : 0);
