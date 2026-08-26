// The number the Advanced Filter shows must belong to the selection the Advanced Filter shows.
//
// DEFECT (production, found 2026-08-24 during the full AF certification). Live repro: جدة /
// «شراء»+«إيجار» together / سكني / group «الشقق والسكن المشترك» → «خلّنا نحدد الطلب أكثر» → the TYPE
// tier opens on a scope of 27,378. The user ticks «شقة», whose own option row reads 25,030. The
// header chip and the green primary button BOTH kept reading «27,378» — polled 8× over 12s, stable.
// The backend was never wrong: the captured `apartment_guided_counts_ar` call for that selection
// returned cnt_selected = 25,030. The UI simply never showed it, and the button went on promising
// «متابعة · 27,378 نتيجة» — the count of a query the user was no longer asking for.
//
// CAUSE. `fetchApartmentGuidedCounts` is wrapped in `withTimeout(…, AGE_COUNT_TIMEOUT_MS = 4000)`
// (src/data/remote.ts), so a slow count RPC resolves `liveResultCount()` to null. The card's live
// count effect wrote only non-null values:
//
//     liveCount(sel).then((n) => { if (alive && n != null) setCount(n); });   // ← the defect
//
// `n != null` was meant as "don't flash a wrong number on a racey fetch". On a real timeout it does
// the opposite: it PINS the PREVIOUS selection's total onto the NEW selection, silently and with no
// expiry. Measured healthy path in the same session, same card: +دور → 996ms → 25,300 (chip moved);
// −دور → 901ms → 25,030 (chip moved). The failure mode is exclusively the >4s timeout branch.
//
// FIX. Write whatever the fetch resolves to, including null. In flight, nothing is written, so the
// previous number stays up and there is no per-tap flicker; on failure the number is CLEARED. Both
// render sites already degrade correctly — the chip is not rendered when `countChip == null`, and
// the primary button falls back to a bare «متابعة». Showing NO number is honest. Showing another
// selection's number is not.
//
// WHY A BARRIER. This is the owner's permanent "visible AF count = backend" rule, and it is exactly
// the class of regression the rest of the suite cannot see: every count-honesty barrier compares an
// RPC to an oracle and both were correct here — the break was entirely between the resolved promise
// and the pixel. Re-adding the `n != null` guard for any "don't flicker" reason must turn this red.
//
//   node --experimental-strip-types scripts/verify-af-count-belongs-to-selection.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Comments describe the defect in prose; only executable source may satisfy a check.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD = 'src/components/AdvancedQuestionCard.tsx';
const cardSrc = codeOnly(read(CARD));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter — the displayed count must belong to the displayed selection\n');

// The live-count effect, from the call that starts it to the end of its dependency array. Scoping to
// this block is what stops an unrelated `!= null` elsewhere in the file from satisfying (or breaking)
// the checks below.
const startAt = cardSrc.indexOf('liveCount(sel)');
const depsEnd = startAt < 0 ? -1 : cardSrc.indexOf(']);', startAt);
const effect = startAt < 0 || depsEnd < 0 ? '' : cardSrc.slice(startAt, depsEnd + 3);

check(
  'the card still has a live-count effect driven by the current selection',
  effect.length > 0,
  `no \`liveCount(sel)\` … \`]);\` block found in ${CARD}. If the live count moved, move this barrier with it.`,
);

// ── 1. THE DEFECT ITSELF ────────────────────────────────────────────────────────────────────────
// Between the resolved value and setCount there must be NO nullish re-guard. `alive` is the
// supersession guard and is required; a guard on `n` is the bug.
const resolveBody = (() => {
  const at = effect.indexOf('.then(');
  if (at < 0) return '';
  const end = effect.indexOf('});', at);
  return end < 0 ? effect.slice(at) : effect.slice(at, end + 3);
})();

const nullGuard = /\bn\s*(?:!=|!==)\s*(?:null|undefined)|\bn\s*!=\s*null|typeof\s+n\s*===?\s*['"]number['"]|\bn\s*\?\?|Number\.isFinite\s*\(\s*n\s*\)/;
check(
  'the resolved count is written UNCONDITIONALLY — no nullish guard between the promise and setCount',
  resolveBody.length > 0 && !nullGuard.test(resolveBody),
  `found a guard on the resolved value in:\n      ${resolveBody.replace(/\s+/g, ' ').trim()}\n`
    + '      A null resolution means "the count for THIS selection is unknown". Dropping the write keeps the\n'
    + '      PREVIOUS selection\'s number on screen — that is the 2026-08-24 defect. Clear it instead.',
);

check(
  'setCount receives the resolved value itself, not a substitute',
  /setCount\(\s*n\s*\)/.test(resolveBody),
  'expected `setCount(n)`. Substituting a fallback (e.g. `setCount(n ?? count)`) re-creates the defect.',
);

check(
  'the supersession guard on `alive` is still present',
  /\bif\s*\(\s*alive\s*\)/.test(resolveBody) || /\bif\s*\(\s*!\s*alive\s*\)/.test(resolveBody),
  'the effect must still ignore a resolution from an abandoned selection; removing `alive` lets a slow '
    + 'fetch for an OLD selection overwrite the current one — the same class of bug from the other side.',
);

// ── 2. THE EFFECT MUST RE-RUN WHEN THE SELECTION CHANGES ────────────────────────────────────────
// If the selection drops out of the dependency list the count stops tracking the selection at all,
// which is the same user-visible defect by a different route.
const deps = effect.slice(effect.lastIndexOf('}, ['));
check(
  'the effect re-runs on selection change (selection is in its dependency list)',
  /sel\b/.test(deps),
  `dependency list was: ${deps.replace(/\s+/g, ' ').trim()}`,
);
check(
  'the effect also re-runs when the QUESTION changes',
  /titleKey/.test(deps),
  `dependency list was: ${deps.replace(/\s+/g, ' ').trim()}`,
);

// ── 3. NULL MUST DEGRADE HONESTLY AT BOTH RENDER SITES ──────────────────────────────────────────
// Clearing is only honest if "cleared" renders as NO number. If either site started rendering a raw
// null/NaN, or kept a stale local copy, the fix above would be undone at the pixel.
check(
  'the header chip renders nothing when the count is unknown',
  /countChip\s*!=\s*null\s*\?/.test(cardSrc),
  'expected the af-count-chip render to be guarded by `countChip != null`.',
);
check(
  'the primary button drops the number when the count is unknown',
  /count\s*!=\s*null\s*\?[\s\S]{0,200}?t\('Continue'\)/.test(cardSrc),
  "expected the af-confirm label to fall back to a bare t('Continue') when `count == null`.",
);

// ── 4. THE TIMEOUT THAT CAUSES IT IS STILL A REAL, BOUNDED TIMEOUT ──────────────────────────────
// Not a style rule: this barrier's premise is that liveResultCount CAN resolve null. If the timeout
// is ever removed the null branch becomes unreachable and these checks quietly stop protecting
// anything — better to notice that deliberately than to keep a barrier guarding a dead path.
const remote = codeOnly(read('src/data/remote.ts'));
check(
  'the count fetch is still time-bounded (so the null branch this barrier guards is reachable)',
  /AGE_COUNT_TIMEOUT_MS\s*=\s*\d+/.test(remote) && /withTimeout\(/.test(remote),
  'AGE_COUNT_TIMEOUT_MS / withTimeout not found in src/data/remote.ts — if the count fetch can no longer '
    + 'time out, re-derive this barrier rather than deleting it: liveResultCount still returns null on error.',
);

// ── 5. THE IN-FLIGHT WINDOW IS THE SAME LIE, JUST SHORTER ───────────────────────────────────────
// Extends this barrier rather than adding a second one: same contract, same effect, the other half
// of its lifetime. Sections 1–4 make the RESOLVED value honest. They deliberately left the PENDING
// window holding the previous number ("no per-tap flicker"). Driving the real timeout branch on
// production (2026-08-24, after the section-1 fix was already live) measured what that costs:
//
//   الرياض / إيجار سنوي / شقة → «كم عمر العقار تقريباً؟», tap «جديد» (4,537),
//   then tap «١٠+ سنوات» with the count RPC delayed past its 4s timeout:
//     t+0.5s … t+3s   «١٠+ سنوات» selected, its own pill reading 1,196,
//                     chip «4,537 نتيجة», button «متابعة · 4,537 نتيجة»
//     t+4.5s          chip gone, button «متابعة»          ← sections 1–4, working
//
// Two numbers on one card disagreeing about one selection, with the wrong one on the primary
// action, for up to the full 4s timeout. The owner's rule does not carve out a grace period: the UI
// must never present an old count as though it belongs to the newly selected answer. So the clear
// is hoisted to the START of the effect and the pending window says what the post-timeout window
// already says — nothing.
const effectFull = (() => {
  const dep = /\}\s*,\s*\[\s*sel\.join\([^)]*\)\s*,\s*titleKey\s*\]\s*\)/.exec(cardSrc);
  if (!dep) return '';
  const s = cardSrc.lastIndexOf('useEffect(', dep.index);
  return s < 0 ? '' : cardSrc.slice(s, dep.index + dep[0].length);
})();

/** Exported so the mutation proof below runs the REAL predicate, not a paraphrase of it. */
export function clearsBeforeFetch(effectSrc: string): boolean {
  const clear = effectSrc.search(/setCount\(\s*null\s*\)/);
  const fetch = effectSrc.search(/liveCount\s*\(/);
  return clear >= 0 && fetch >= 0 && clear < fetch;
}

check(
  'the stale number is cleared BEFORE the new one is awaited (the in-flight window shows no number)',
  clearsBeforeFetch(effectFull),
  'expected `setCount(null)` to run before `liveCount(sel)` inside the selection-keyed effect, so the '
    + "previous answer's count is never displayed against the new selection while the fetch is pending.",
);

// Mutation proof — the check above must be the thing that fails, not decoration.
{
  const PENDING_LIE = `useEffect(() => { let alive = true;
    liveCount(sel).then((n) => { if (alive) setCount(n); });
  }, [sel.join(','), titleKey])`;
  const FIXED = `useEffect(() => { let alive = true; setCount(null);
    liveCount(sel).then((n) => { if (alive) setCount(n); });
  }, [sel.join(','), titleKey])`;
  const CLEARED_TOO_LATE = `useEffect(() => { let alive = true;
    liveCount(sel).then((n) => { if (alive) setCount(n); }); setCount(null);
  }, [sel.join(','), titleKey])`;
  const cases: Array<[string, boolean]> = [
    ['the exact pre-fix effect is flagged', clearsBeforeFetch(PENDING_LIE) === false],
    ['the fixed effect passes', clearsBeforeFetch(FIXED) === true],
    ['clearing AFTER the fetch is still flagged — order is the whole point',
      clearsBeforeFetch(CLEARED_TOO_LATE) === false],
  ];
  for (const [label, ok] of cases) {
    if (ok) console.log(`  PASS  mutation: ${label}`);
    else { failures++; console.error(`  FAIL  mutation: ${label}`); }
  }
}

if (failures) {
  console.error(`\n❌ ${failures} check(s) failed — the AF count could show a number that belongs to a different selection.\n`);
  process.exit(1);
}
console.log('\n✅ AF displayed-count-belongs-to-displayed-selection contract passed.\n');
