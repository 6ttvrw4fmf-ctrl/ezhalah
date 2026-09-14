// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ARMING A RAPID-CANCEL SUBMIT (routine #6, 2026-09-14)
//
// WHY THIS EXISTS
// `submitSearch()` in scripts/verify-web-runtime-smoke.mjs was written on 2026-08-24 for a real,
// measured race: `onSearch` returns at `if (!citySelected)` with «الرجاء اختيار مدينة من القائمة»
// and fires ZERO requests (src/app/index.tsx — the owner's 2026-07-17 "never guess a location"
// rule), and every keystroke in the city field clears `citySelected`. On a loaded runner a tap can
// land inside that window, so submitSearch CONFIRMS a request left the app and re-taps when one
// did not.
//
// Two call sites could never adopt it: the RAPID-CANCEL entries ([E] desktop, [H mobile]). They
// must navigate back ~300 ms after the tap, while submitSearch waits up to 5 s for the request to
// land — adopting it would destroy the very timing those journeys exist to test. So both kept the
// bare `tap('بحث')`, and both kept the race.
//
// Measured cost, CI run 34791858611 (2026-09-14T00:10Z, `main` @ b455a085): the bare tap lost the
// race on [H mobile] and produced a FOUR-assertion cascade —
//     FAIL [H mobile] Filter search landed on /agent before cancellation   url=…:35215/
//     FAIL [H mobile] rapid-cancel restores city/district/area EXACTLY
//     FAIL [H mobile] resubmitting untouched … EXACT SAME serialized search request  resubmitReq=null
//     FAIL [H mobile] the mobile resubmit still lands a real result count  count=null
// — whose own page dump carries the proof that the app was behaving correctly the whole time:
// «الرجاء اختيار مدينة من القائمة». Nothing was wrong with the build. The same shape is recorded
// four times earlier in that file's own comment at the submitSearch definition.
//
// THE FIX IS TO ARM, NOT TO RETRY. Retrying the tap is what the rapid-cancel timing forbids;
// proving the form is SUBMITTABLE before tapping costs no timing at all. The oracle is the app's
// OWN marker, `selected-city-visual`, which src/app/index.tsx renders iff `citySelected` is
// non-null — not a DOM guess about what the app probably thinks.
//
// Both functions below are PURE by signature (no Playwright, no DOM) specifically so the barrier
// `scripts/verify-armed-rapid-cancel-submit.ts` EXECUTES them against injected failures rather
// than grepping their source. AGENTS.md, "A FAILED FETCH IS NOT AN EMPTY ANSWER": every one of the
// five defects of 2026-09-04 had a source-TEXT tripwire over the exact line, and every one of
// those tripwires passed for the entire time the defect was live.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Is the app's own commit marker present right now? (`selected-city-visual` ⟺ `citySelected`.) */
export type CommitProbe = () => Promise<boolean>;

/** Re-run the city commit gesture (type → tap the suggestion → confirm). */
export type Reprime = () => Promise<void>;

export type ArmResult = {
  /** True iff the app itself confirmed a committed city — i.e. «بحث» will actually submit. */
  armed: boolean;
  /** How many probes were made (1 when the form was already armed). */
  attempts: number;
  /** Human-readable reason, always populated — a skip with no reason is PART 9.5's tidy skip. */
  reason: string;
};

/**
 * Prove the search form is submittable, re-priming when it is not.
 *
 * Deliberately probes BEFORE re-priming: the overwhelmingly common case is an already-armed form,
 * and a re-prime there would retype the city for no reason and re-open the very window this is
 * closing.
 *
 * A probe that THROWS counts as "not committed" rather than propagating: a detached element or a
 * mid-navigation read is exactly the condition a re-prime fixes, and turning it into an exception
 * would abort the journey instead of arming it. It is never silently swallowed — the throw's
 * message rides in `reason` so a skip always explains itself.
 */
export async function armForSubmit(
  isCommitted: CommitProbe,
  reprime: Reprime,
  maxAttempts = 3,
): Promise<ArmResult> {
  if (maxAttempts < 1) {
    return { armed: false, attempts: 0, reason: `maxAttempts=${maxAttempts} is below 1 — nothing was probed` };
  }
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let committed = false;
    try {
      committed = await isCommitted();
    } catch (e) {
      committed = false;
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (committed) {
      return {
        armed: true,
        attempts: attempt,
        reason: attempt === 1
          ? 'the form was already armed: the app reports a committed city'
          : `armed after ${attempt - 1} re-prime(s): the app reports a committed city`,
      };
    }
    if (attempt < maxAttempts) {
      try {
        await reprime();
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return {
    armed: false,
    attempts: maxAttempts,
    reason: `the app never confirmed a committed city after ${maxAttempts} attempts`
      + `; «بحث» would correctly refuse with «الرجاء اختيار مدينة من القائمة» and fire zero requests`
      + (lastError ? ` (last error: ${lastError})` : ''),
  };
}

/**
 * What did a rapid-cancel entry actually observe? This is the load-bearing rule, and each of the
 * three verdicts is one of PART 9's two opposite errors, or the correct answer between them:
 *
 *  - NOT ARMED → `skip`. The app was correctly refusing to search an uncommitted city, so nothing
 *    about cancel-and-restore was measured. Filing this as a defect is PART 9.1's first error
 *    (a harness artifact reported as an Ezhalah bug, which is what CI run 34791858611 did, four
 *    times in one journey). Calling it a pass is PART 9.5's — a measurement that did not happen.
 *
 *  - ARMED but never landed on /agent → `defect`, and it must stay LOUD. The app had a committed
 *    city and «بحث» still did nothing: that is a dead control, PART 5 shape #6. Arming must never
 *    become a way to make this quiet — that is the exact inversion PART 9.1 forbids.
 *
 *  - ARMED and landed → `pass`.
 */
export function classifyRapidCancelEntry(o: { armed: boolean; landedOnAgent: boolean }): 'pass' | 'defect' | 'skip' {
  if (!o.armed) return 'skip';
  return o.landedOnAgent ? 'pass' : 'defect';
}
