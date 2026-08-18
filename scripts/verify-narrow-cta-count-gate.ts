// ≤25 ADVANCED-FILTER CTA GATE (owner brief §4, 2026-08-19) — a result set of 25 or fewer must show
// ONLY the normal lightweight actions (Load more if genuinely more exists, 👍/Share) — never a
// "narrow further" prompt. The auto-opening AF intro overlay already gated correctly on this exact
// threshold (agent.tsx's `gateTotal > INTERVIEW_STOP_AT`, PR #608-era fix). The SEPARATE manual
// «خلّنا نحدد الطلب أكثر» button under the results closing message did NOT — it rendered
// unconditionally, and its click path fell through to the plain refine-chip flow for any ≤25 scope
// (proved by tracing rankQuestions' own MIN_TOTAL_TO_SHOW floor) rather than doing nothing.
//
// THE COUNT THIS MUST USE: matchTotal FIRST (the RPC's true count(*) over()), never
// `fetched`/`listings.length` alone — that is a page-buffer size that saturates at the 1,500-row
// fetch cap and can under-report a real total in the thousands, exactly the "matchTotal, never the
// page-capped total" trap from PR #608 (docs cite it as an already-fixed, must-never-return bug).
//
//   node --experimental-strip-types scripts/verify-narrow-cta-count-gate.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\n≤25 Advanced Filter CTA gate — the manual "narrow it down" button\n');

const ag = codeOnly(read('src/app/agent.tsx'));
const i18n = read('src/i18n.tsx');

check('the manual narrow-CTA count reads matchTotal FIRST, never fetched/listings.length alone',
  /const\s+trueTotal\s*=\s*m\.result\.matchTotal\s*\?\?\s*fetched/.test(ag),
  'a page-capped fetched count would incorrectly hide the CTA on a large search whose page just has not filled yet, or show it on a small one');

check("canNarrowFurther is gated on trueTotal > INTERVIEW_STOP_AT (the exact 25/26 boundary, not >=)",
  /const\s+canNarrowFurther\s*=\s*trueTotal\s*>\s*INTERVIEW_STOP_AT/.test(ag));

check("the «Let's narrow it down» Pressable only renders when canNarrowFurther is true",
  /\{canNarrowFurther\s*\?\s*\(\s*<Pressable[\s\S]{0,200}?onPress=\{\(\)\s*=>\s*\{\s*const q = m\.result\.query;/.test(ag),
  'the button must not render unconditionally alongside Load More');

check('the OLD unconditional-button shape (no canNarrowFurther guard around the Pressable) is gone',
  !/<View style=\{\[s\.mBtnRow,[\s\S]{0,300}?<Pressable\s+style=\{s\.mBtnAlt\}/.test(ag),
  'this shape means the narrow-it-down button rendered with no count check at all — the exact bug this test locks out');

check('the closing message drops the "help you find more precise ones?" invitation when canNarrowFurther is false',
  /canNarrowFurther\s*\?\s*\n?\s*t\('I showed you all \{n\} matching listings\. Want help finding more precise ones\?'/.test(ag)
  && /:\s*\n?\s*t\('I showed you all \{n\} matching listings\.'/.test(ag));

check("both new ≤25 copy variants have real Arabic translations (no English key leak)",
  i18n.includes("'I showed you the first {n} listings. Want me to show more?': '")
  && i18n.includes("'I showed you all {n} matching listings.': '"));

// FeedbackRow (👍/Share) must remain UNCONDITIONAL — the owner's spec says the ≤25 action area keeps
// exactly the normal lightweight actions; it must never be swept into the same count gate.
check('FeedbackRow stays unconditional (no count gate added around it — 👍/Share always present)',
  /return <FeedbackRow feedbackKey=\{m\.id\} onFeedback=\{showFbToast\} \/>;/.test(ag));

console.log(failures === 0
  ? '\n✓ ≤25 narrow-CTA gate intact: matchTotal-first, correct boundary, FeedbackRow untouched\n'
  : `\n✗ ${failures} check(s) FAILED — the ≤25 Advanced Filter CTA gate is broken\n`);
process.exit(failures === 0 ? 0 : 1);
