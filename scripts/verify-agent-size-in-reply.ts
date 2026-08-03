// Regression guard for the "size shows in the summary but not in the reply sentence" bug reported
// live 2026-07-27 (user: AI Agent chat, logged-in path).
//
// supabase/functions/agent/index.ts's `out.detail` (a size in m², or a bedroom count) always lands
// in query.detail and therefore always renders in the deterministic "Search Summary" block
// (searchSummary() in src/data/search.ts). But for a logged-in user the chat REPLY SENTENCE shown
// above it is the model's own free-form `out.reply` text — the model is only told to "briefly
// restate what you understood", and inconsistently omits a size the user actually gave (e.g. "فيلا
// 500 متر" → summary correctly said "Size: 500 m²", the reply sentence never said 500 at all).
//
// Fixed the same way as the price-range bug: don't trust the model to be exhaustive — append the
// size to the reply deterministically when query.detail is size-shaped (not a bedroom count 1-4/5+)
// and that number doesn't already appear in the reply text.
//
//   node --experimental-strip-types scripts/verify-agent-size-in-reply.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
check('isSizeDetail excludes bedroom-shaped values (1-4, 5+)', /const isSizeDetail = detailStr !== "" && !\/\^\(\[1-4\]\|5\\\+\?\)\$\/\.test\(detailStr\);/.test(src));
check('appends the size only when the reply does not already mention it', /if \(isSizeDetail && !replyOut\.includes\(detailStr\)\)/.test(src));
check('the listings reply now uses replyOut, not the raw lead(out.reply)', /reply: replyOut,\s*\n\s*query: \{/.test(src));

// Verbatim copy of the fixed logic — executed against real cases.
function appendSizeIfMissing(reply: string, detail: string, locale: 'ar' | 'en'): string {
  const detailStr = detail.trim();
  const isSizeDetail = detailStr !== '' && !/^([1-4]|5\+?)$/.test(detailStr);
  let replyOut = reply;
  if (isSizeDetail && !replyOut.includes(detailStr)) {
    replyOut = locale === 'en' ? `${replyOut} (${detailStr} m²)` : `${replyOut} (${detailStr} م²)`;
  }
  return replyOut;
}

const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

eq(
  'size given, reply omits it -> size appended (Arabic)',
  appendSizeIfMissing('تمام، جاري البحث عن فيلا في الرياض.', '500', 'ar'),
  'تمام، جاري البحث عن فيلا في الرياض. (500 م²)',
);
eq(
  'size given, reply omits it -> size appended (English)',
  appendSizeIfMissing('Got it, searching for a villa in Riyadh.', '500', 'en'),
  'Got it, searching for a villa in Riyadh. (500 m²)',
);
eq(
  'size already mentioned in the reply -> left unchanged, no duplicate',
  appendSizeIfMissing('جاري البحث عن فيلا 500 متر في الرياض.', '500', 'ar'),
  'جاري البحث عن فيلا 500 متر في الرياض.',
);
eq(
  'bedroom count "3" is NOT a size -> never appended',
  appendSizeIfMissing('جاري البحث عن شقة 3 غرف في جدة.', '3', 'ar'),
  'جاري البحث عن شقة 3 غرف في جدة.',
);
eq(
  'bedroom count "5+" is NOT a size -> never appended',
  appendSizeIfMissing('Searching for a villa with 5+ bedrooms.', '5+', 'en'),
  'Searching for a villa with 5+ bedrooms.',
);
eq(
  'empty detail -> reply untouched',
  appendSizeIfMissing('جاري البحث في الرياض.', '', 'ar'),
  'جاري البحث في الرياض.',
);
eq(
  'commercial land size "1200" -> appended',
  appendSizeIfMissing('Searching for commercial land in Dammam.', '1200', 'en'),
  'Searching for commercial land in Dammam. (1200 m²)',
);

console.log(
  failed === 0
    ? '\n✓ agent size-in-reply fix verified (reply sentence always mentions a size the user gave)'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
