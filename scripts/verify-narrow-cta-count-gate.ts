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
import { closingNoteKey, keyOffersNarrow } from '../src/data/resultCount.ts';

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

// Name-agnostic (the raw total const was renamed trueTotal→rawTotal in the 2026-08-20 browse-cap
// refactor, when `trueTotal` took on the cap-aware meaning). What matters is the SEMANTICS: some const
// holds `m.result.matchTotal ?? fetched`, and canNarrowFurther gates on THAT const > INTERVIEW_STOP_AT.
const rawTotalName = ag.match(/const\s+(\w+)\s*=\s*m\.result\.matchTotal\s*\?\?\s*fetched/)?.[1];
check('the manual narrow-CTA count reads matchTotal FIRST, never fetched/listings.length alone',
  !!rawTotalName,
  'a page-capped fetched count would incorrectly hide the CTA on a large search whose page just has not filled yet, or show it on a small one');

check("canNarrowFurther is gated on (matchTotal-first total) > INTERVIEW_STOP_AT (the exact 25/26 boundary, not >=)",
  !!rawTotalName && new RegExp(`const\\s+canNarrowFurther\\s*=\\s*${rawTotalName}\\s*>\\s*INTERVIEW_STOP_AT`).test(ag));

check("the «Let's narrow it down» Pressable only renders when canNarrowFurther is true",
  /\{canNarrowFurther\s*\?\s*\(\s*<Pressable[\s\S]{0,200}?onPress=\{\(\)\s*=>\s*\{\s*const q = m\.result\.query;/.test(ag),
  'the button must not render unconditionally alongside Load More');

check('the OLD unconditional-button shape (no canNarrowFurther guard around the Pressable) is gone',
  !/<View style=\{\[s\.mBtnRow,[\s\S]{0,300}?<Pressable\s+style=\{s\.mBtnAlt\}/.test(ag),
  'this shape means the narrow-it-down button rendered with no count check at all — the exact bug this test locks out');

// The invitation used to be an inline ternary in agent.tsx and was asserted here by matching that
// text. Since 2026-09-05 the sentence's KEY comes from the pure `closingNoteKey` in
// src/data/resultCount.ts, because the old wording was blind to two further gates the buttons carry
// (`isLatestResults` and `!ageFlow`) and promised «عرض المزيد» with zero buttons rendered — measured
// live on الرياض/بيع/فيلا. So this rule is now EXECUTED against that function rather than matched
// against a source line: the same property, proven instead of spelled.
check('the closing message drops the "help you find more precise ones?" invitation when the button is not offered',
  !keyOffersNarrow(closingNoteKey({ endKind: 'all', quoteTotal: true, offersMore: false, offersNarrow: false }))
  && !keyOffersNarrow(closingNoteKey({ endKind: 'more', quoteTotal: true, offersMore: true, offersNarrow: false })),
  'a ≤25 set must never be invited to narrow further');
check('…and still makes the invitation when the button IS offered',
  keyOffersNarrow(closingNoteKey({ endKind: 'all', quoteTotal: true, offersMore: false, offersNarrow: true })),
  'dropping the false offers must not retire the true one');
check('agent.tsx feeds that function the RENDERED-button booleans, not the raw gates',
  /const offersNarrow = canNarrowFurther && showActionsRow;/.test(ag)
  && /closingNoteKey\(\{ endKind: rc\.endKind, quoteTotal, offersMore, offersNarrow \}\)/.test(ag),
  'the pure function can only be as right as the values handed to it');

check("both new ≤25 copy variants have real Arabic translations (no English key leak)",
  i18n.includes("'I showed you the first {n} listings. Want me to show more?': '")
  && i18n.includes("'I showed you all {n} matching listings.': '"));

// FeedbackRow (👍/Share) must remain UNCONDITIONAL — the owner's spec says the ≤25 action area keeps
// exactly the normal lightweight actions; it must never be swept into the same count gate. Matched
// loosely on the two load-bearing props (not the full prop list, and not requiring a bare `return`
// prefix — owner 2026-08-23 merged this into the same block as the closing-message View so Read
// Aloud could reuse its computed text, so FeedbackRow now sits inside a returned Fragment alongside
// it rather than being the sole return value) so an unrelated feature adding a new prop to the same
// call (e.g. readAloudSegments) or restructuring the surrounding JSX can't produce a false failure
// here — what this guards against is a NEW count-based condition wrapping the tag, not its exact
// prop list or return-statement shape.
check('FeedbackRow stays unconditional (no count gate added around it — 👍/Share always present)',
  /<FeedbackRow[^>]*\bfeedbackKey=\{m\.id\}[^>]*\bonFeedback=\{showFbToast\}[^>]*\/>/.test(ag),
  'FeedbackRow must render regardless of canNarrowFurther/trueTotal — only the typing/reveal gate above it may apply');
check('no canNarrowFurther/trueTotal condition wraps the FeedbackRow return (still gated only on typing/reveal)',
  !/canNarrowFurther[\s\S]{0,200}<FeedbackRow/.test(ag) && !/trueTotal[\s\S]{0,200}<FeedbackRow/.test(ag));

console.log(failures === 0
  ? '\n✓ ≤25 narrow-CTA gate intact: matchTotal-first, correct boundary, FeedbackRow untouched\n'
  : `\n✗ ${failures} check(s) FAILED — the ≤25 Advanced Filter CTA gate is broken\n`);
process.exit(failures === 0 ? 0 : 1);
