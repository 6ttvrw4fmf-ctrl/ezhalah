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
import { windowBetween, MarkerMissing } from './lib/sourceWindow.ts';

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

// ── THE RULE, AS PURE FUNCTIONS SO A MUTANT CAN BE JUDGED BY IT (routine #10, 2026-09-21) ───────
//
// Sections 1–4 used to be four inline source-TEXT tripwires with no proof of any kind — this file
// sat on scripts/mutation-proof-grandfathered.txt, i.e. nobody had ever watched it fail, and the
// dominant failure shape in this repo is a text tripwire that passes for exactly as long as the
// defect is live (BARRIER_ENGINEER.md §0.1: five such barriers, each pinning its own defect).
// The assertions themselves are UNCHANGED — nothing here is looser than it was. What changed is
// that they are now one pure function over the source, so §MUTATIONS can re-break the REAL
// AdvancedQuestionCard.tsx IN MEMORY and watch each property go red, then restore.
//
// Still text and not execution, and the reason is stated rather than assumed: the subject is a
// React effect's ORDER OF WRITES inside a 2,000-line screen component — `setCount(null)` before the
// await, `setCount(n)` unconditionally after it — which is not a value any lifted function returns.
// What IS liftable here is the window extraction, and it fails CLOSED: a marker that has moved
// raises MarkerMissing naming it, rather than silently widening to the whole file (the 2026-09-20
// raw-slice class, scripts/lib/sourceWindow.ts).

/** The live-count effect: from the call that starts it to the end of its dependency array. */
export function liveCountEffect(cardSource: string): string {
  return windowBetween(cardSource, 'liveCount(sel)', ']);', CARD);
}

/** Everything between the resolved promise and the end of its `.then` — where the defect lived. */
export function resolvedWrite(effectSrc: string): string {
  return windowBetween(effectSrc, '.then(', '});', `${CARD} live-count effect`);
}

/** The whole selection-keyed effect, including the statements BEFORE the fetch starts. */
export function selectionEffect(cardSource: string): string {
  const dep = /\}\s*,\s*\[\s*sel\.join\([^)]*\)\s*,\s*titleKey\s*\]\s*\)/.exec(cardSource);
  if (!dep) throw new MarkerMissing('}, [sel.join(…), titleKey])', CARD);
  const s = cardSource.lastIndexOf('useEffect(', dep.index);
  if (s < 0) throw new MarkerMissing('useEffect( before the selection dependency list', CARD);
  return cardSource.slice(s, dep.index + dep[0].length);
}

/** `true` when the stale number is cleared BEFORE the new one is awaited. */
export function clearsBeforeFetch(effectSrc: string): boolean {
  const clear = effectSrc.search(/setCount\(\s*null\s*\)/);
  const fetch = effectSrc.search(/liveCount\s*\(/);
  return clear >= 0 && fetch >= 0 && clear < fetch;
}

const NULL_GUARD =
  /\bn\s*(?:!=|!==)\s*(?:null|undefined)|\bn\s*!=\s*null|typeof\s+n\s*===?\s*['"]number['"]|\bn\s*\?\?|Number\.isFinite\s*\(\s*n\s*\)/;

export type Property = { label: string; ok: boolean; detail?: string };

/**
 * Every property the AF card must satisfy for its displayed count to belong to its displayed
 * selection. A MarkerMissing anywhere is reported as a FAILED property, never as a silent pass —
 * "the barrier could not find what it guards" is a red, not a clean bill of health.
 */
export function displayedCountProperties(cardSource: string, remoteSource: string): Property[] {
  const out: Property[] = [];
  const add = (label: string, ok: boolean, detail?: string) => out.push({ label, ok, detail });

  let effect = '';
  try {
    effect = liveCountEffect(cardSource);
    add('the card still has a live-count effect driven by the current selection', true);
  } catch (e) {
    add('the card still has a live-count effect driven by the current selection', false,
      `${(e as Error).message}. If the live count moved, move this barrier with it.`);
    return out;                       // every property below is about that effect
  }

  // ── 1. THE DEFECT ITSELF ──────────────────────────────────────────────────────────────────────
  // Between the resolved value and setCount there must be NO nullish re-guard. `alive` is the
  // supersession guard and is required; a guard on `n` is the bug.
  let body = '';
  try {
    body = resolvedWrite(effect);
  } catch (e) {
    add('the resolved count is written UNCONDITIONALLY', false, (e as Error).message);
  }
  if (body) {
    add('the resolved count is written UNCONDITIONALLY — no nullish guard between the promise and setCount',
      !NULL_GUARD.test(body),
      `found a guard on the resolved value in:\n      ${body.replace(/\s+/g, ' ').trim()}\n`
      + '      A null resolution means "the count for THIS selection is unknown". Dropping the write keeps\n'
      + "      the PREVIOUS selection's number on screen — that is the 2026-08-24 defect. Clear it instead.");
    add('setCount receives the resolved value itself, not a substitute',
      /setCount\(\s*n\s*\)/.test(body),
      'expected `setCount(n)`. Substituting a fallback (e.g. `setCount(n ?? count)`) re-creates the defect.');
    add('the supersession guard on `alive` is still present',
      /\bif\s*\(\s*alive\s*\)/.test(body) || /\bif\s*\(\s*!\s*alive\s*\)/.test(body),
      'the effect must still ignore a resolution from an abandoned selection; removing `alive` lets a slow '
      + 'fetch for an OLD selection overwrite the current one — the same class of bug from the other side.');
  }

  // ── 2. THE EFFECT MUST RE-RUN WHEN THE SELECTION CHANGES ──────────────────────────────────────
  // If the selection drops out of the dependency list the count stops tracking the selection at all,
  // which is the same user-visible defect by a different route.
  const deps = effect.slice(effect.lastIndexOf('}, ['));
  add('the effect re-runs on selection change (selection is in its dependency list)',
    /sel\b/.test(deps), `dependency list was: ${deps.replace(/\s+/g, ' ').trim()}`);
  add('the effect also re-runs when the QUESTION changes',
    /titleKey/.test(deps), `dependency list was: ${deps.replace(/\s+/g, ' ').trim()}`);

  // ── 3. NULL MUST DEGRADE HONESTLY AT BOTH RENDER SITES ────────────────────────────────────────
  // Clearing is only honest if "cleared" renders as NO number. If either site started rendering a
  // raw null/NaN, or kept a stale local copy, the fix above would be undone at the pixel.
  add('the header chip renders nothing when the count is unknown',
    /countChip\s*!=\s*null\s*\?/.test(cardSource),
    'expected the af-count-chip render to be guarded by `countChip != null`.');
  add('the primary button drops the number when the count is unknown',
    /count\s*!=\s*null\s*\?[\s\S]{0,200}?t\('Continue'\)/.test(cardSource),
    "expected the af-confirm label to fall back to a bare t('Continue') when `count == null`.");

  // ── 4. THE TIMEOUT THAT CAUSES IT IS STILL A REAL, BOUNDED TIMEOUT ────────────────────────────
  // Not a style rule: this barrier's premise is that liveResultCount CAN resolve null. If the
  // timeout is ever removed the null branch becomes unreachable and these checks quietly stop
  // protecting anything — better to notice that deliberately than to keep guarding a dead path.
  add('the count fetch is still time-bounded (so the null branch this barrier guards is reachable)',
    /AGE_COUNT_TIMEOUT_MS\s*=\s*\d+/.test(remoteSource) && /withTimeout\(/.test(remoteSource),
    'AGE_COUNT_TIMEOUT_MS / withTimeout not found in src/data/remote.ts — if the count fetch can no longer '
    + 'time out, re-derive this barrier rather than deleting it: liveResultCount still returns null on error.');

  // ── 5. THE IN-FLIGHT WINDOW (narrated below) — part of the SAME rule, so a mutant is judged by
  // the same function. Keeping it outside meant M6 below mutated the pending window and every
  // property here still passed: the proof would have reported a hole that was not there.
  try {
    add('the stale number is cleared BEFORE the new one is awaited (the in-flight window shows no number)',
      clearsBeforeFetch(selectionEffect(cardSource)),
      'expected `setCount(null)` to run before `liveCount(sel)` inside the selection-keyed effect, so the '
      + "previous answer's count is never displayed against the new selection while the fetch is pending.");
  } catch (e) {
    add('the stale number is cleared BEFORE the new one is awaited', false, (e as Error).message);
  }

  return out;
}

/** The labels of every violated property. Empty = the card is honest. */
export const displayedCountProblems = (card: string, remote: string): string[] =>
  displayedCountProperties(card, remote).filter((p) => !p.ok).map((p) => p.label);

const remoteSrc = codeOnly(read('src/data/remote.ts'));
for (const p of displayedCountProperties(cardSrc, remoteSrc)) check(p.label, p.ok, p.detail);

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
// (the property itself is asserted inside displayedCountProperties, section 5.)

// ── MUTATIONS — the REAL card source is re-broken IN MEMORY and the SAME predicates re-run ──────
// Before 2026-09-21 only `clearsBeforeFetch` was proven, and it was proven against three hand-typed
// effect strings — a proof that supplies its own input (PART 3, R1.4). Every property above is now
// re-run against a mutated copy of the REAL AdvancedQuestionCard.tsx. Nothing is written to disk: a
// mutant that cannot be left behind cannot be committed by a concurrent session in this shared
// working directory.
const RAW_CARD = read(CARD);

const mutation = (label: string, from: string, to: string) => {
  if (!RAW_CARD.includes(from)) {
    failures++;
    console.error(`  FAIL  mutation anchor MOVED — ${label}: ${JSON.stringify(from)}`);
    return;                 // a moved anchor is a loud failure, never a proof that stopped proving
  }
  const broken = codeOnly(RAW_CARD.replace(from, to));
  let caught: string[];
  try {
    caught = displayedCountProblems(broken, remoteSrc);
  } catch (e) {
    caught = [`the mutated card could not even be read: ${(e as Error).message}`];
  }
  if (caught.length > 0) console.log(`  PASS  mutation: ${label}`);
  else { failures++; console.error(`  FAIL  mutation: ${label} — every property still passed`); }
};

// M1 — THE 2026-08-24 DEFECT ITSELF, restored in the real file.
mutation('the `n != null` re-guard that pins the PREVIOUS selection\'s count (the original defect)',
  'if (alive) setCount(n);', 'if (alive && n != null) setCount(n);');

// M2 — the substitute form: write SOMETHING rather than clearing.
mutation('substituting a fallback instead of writing the resolved value',
  'if (alive) setCount(n);', 'if (alive) setCount(n ?? count);');

// M3 — the same bug from the other side: a stale resolution overwriting the current selection.
mutation('dropping the `alive` supersession guard',
  'if (alive) setCount(n);', 'setCount(n);');

// M4 — the count stops tracking the selection at all.
mutation('dropping the selection from the effect\'s dependency list',
  '}, [sel.join(\',\'), titleKey]);', '}, [titleKey]);');

// M5 — the clear is honest only if "cleared" renders as NO number.
mutation('rendering a number even when the count is unknown (the chip render site)',
  'countChip != null ?', 'countChip !== undefined ?');

// M6 — the in-flight window, the half section 5 is about.
mutation('clearing the stale number only AFTER the fetch starts (the pending-window lie)',
  'setCount(null);', '/* moved below */');

// NEGATIVE CONTROL. A barrier red for everything is as useless as one green for everything, and a
// file-hash masquerading as a barrier is how a real guard gets weakened out of annoyance.
{
  const reformatted = codeOnly(RAW_CARD.replace('if (alive) setCount(n);', 'if (alive) { setCount(n); }'));
  const bad = displayedCountProblems(reformatted, remoteSrc);
  if (bad.length === 0) console.log('  PASS  NEGATIVE CONTROL: a harmless reformat is NOT flagged');
  else { failures++; console.error(`  FAIL  NEGATIVE CONTROL: a harmless reformat was flagged: ${bad.join(' | ')}`); }
}

// …and the fail-closed direction: a window whose marker has moved reads as MISSING, never healthy.
{
  const gone = codeOnly(RAW_CARD.replace('liveCount(sel)', 'liveResultCountFor(sel)'));
  const bad = displayedCountProblems(gone, remoteSrc);
  if (bad.length > 0) console.log('  PASS  mutation: a MOVED marker reads as missing, not as healthy');
  else { failures++; console.error('  FAIL  a moved marker read as healthy — the window failed OPEN'); }
}

if (failures) {
  console.error(`\n❌ ${failures} check(s) failed — the AF count could show a number that belongs to a different selection.\n`);
  process.exit(1);
}
console.log('\n✅ AF displayed-count-belongs-to-displayed-selection contract passed.\n');
