// AF+Trending Data Integrity run, 2026-08-23 — barrier for the duplicate-refine-question bug.
//
// Reproduced LIVE on production (ezhalah-app.vercel.app): شقة/3 غرف نوم/الصفاء، جدة (405 matches,
// correctly < the AF plan's 2-useful-question floor, so startAgeFlow fell through to the legacy
// refine chips per its own comment). Tapping «خلّنا نحدد الطلب أكثر» twice in quick succession —
// once via the AF entry point, once via the reappeared CTA the instant `setAgeFlow(null)` re-showed
// it — called startRefine(q) twice. startRefine had no guard against a second call while a refine
// question was already pending, so BOTH calls appended their own copy of «كم ميزانيتك تقريباً؟»
// with independently-tappable, duplicate chip sets — visible side by side in the same chat.
//
// The fix is one line, in the ONE function every caller already routes through: startRefine() now
// no-ops while `pendingRefineRef.current` is set — the SAME ref send()'s REFINE INTERCEPT and
// runRefine() already treat as "there is exactly one pending refine question" (agent.tsx's own
// comment: "One question at a time"). This script pins that source shape and proves both
// directions: the duplicate-question bug pattern cannot reappear silently, AND the guard does not
// permanently lock the flow out (runRefine still clears the ref so the next question can be asked).
//
//   node --experimental-strip-types scripts/verify-refine-single-pending-guard.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

console.log('\nRefine single-pending-question guard (duplicate «كم ميزانيتك» bug, 2026-08-23)\n');

// 1. THE FIX: startRefine's own signature line guards on pendingRefineRef.current.
const startRefineGuard = /const startRefine = \(q\?: SearchQuery\) => \{\s*\n\s*if \(!q \|\| pendingRefineRef\.current\) return;/;
check(
  'startRefine bails out while a refine question is already pending (the actual fix)',
  startRefineGuard.test(src),
  'expected `if (!q || pendingRefineRef.current) return;` as the first line of startRefine()',
);

// 2. THE BUG PATTERN MUST NOT REAPPEAR: the old unguarded entry (`if (!q) return;` with nothing else)
//    is gone. Matched narrowly against the startRefine declaration itself so this can't false-positive
//    on an unrelated `if (!q) return;` elsewhere in the file.
const startRefineFnMatch = src.match(/const startRefine = \(q\?: SearchQuery\) => \{\s*\n\s*(if \([^)]*\) return;)/);
check(
  'the old unguarded `if (!q) return;` entry is gone from startRefine',
  !!startRefineFnMatch && startRefineFnMatch[1].includes('pendingRefineRef.current'),
  `startRefine's guard line reads: ${startRefineFnMatch?.[1] ?? '<not found>'}`,
);

// 3. NOT A PERMANENT LOCKOUT (direction B): runRefine — the handler that runs when the user actually
//    answers (tap OR typed) — must still clear the ref, or no refine question could ever be asked
//    again after the first one. This is the exact line the bug's fix must not remove.
check(
  'runRefine still clears pendingRefineRef.current on an actual answer (guard is not permanent)',
  /const runRefine = async \([\s\S]{0,400}?pendingRefineRef\.current = null;/.test(src),
);

// 4. Both real call sites still reach startRefine unchanged — the fix lives in the shared function,
//    not a patch on one caller, so both the AF-plan-too-small fallback and the outline «نتائج أدق»
//    button still resolve through it (root-cause fix, not a per-site workaround).
const callSites = (src.match(/\bstartRefine\(q\)/g) ?? []).length;
check(
  'both known callers of startRefine(q) are still present (fix is in the shared function, not per-site)',
  callSites === 2,
  `found ${callSites} call(s) to startRefine(q), expected 2`,
);

// 5. pendingRefineRef itself is declared exactly once as a ref (the guard and the intercepts in
//    send()/runRefine() must all be reading the SAME instance, not a re-declared local).
const refDecls = (src.match(/const pendingRefineRef = useRef</g) ?? []).length;
check('pendingRefineRef is declared exactly once (no shadow/second instance)', refDecls === 1, `found ${refDecls}`);

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ refine single-pending-question guard holds — no duplicate «نتائج أدق» prompts, no permanent lockout');
process.exit(failed ? 1 : 0);
