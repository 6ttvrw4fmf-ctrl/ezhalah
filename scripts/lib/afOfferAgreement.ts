// THE OFFER/ROUND AGREEMENT RULE — pure, so it can be mutation-proven offline (2026-08-26).
//
// WHY THIS EXISTS
// ---------------
// agent.tsx states the invariant in prose and calls the violation "unrepresentable":
//
//   "Sharing the predicate makes offer and round agree by construction. […] 'Tap, open,
//    immediately close' stops being unlikely and becomes unrepresentable."
//
// On 2026-08-26 it was represented, in production, on the deployed bundle 22a2936. In the AI-agent
// chat flow the «خلّنا نحدد الطلب أكثر» CTA was offered, the tap entered startAgeFlow (the actions
// row hid at t=5.0s, which only happens once setAgeFlow({phase:'loading'}) lands), the round
// computed an EMPTY plan, and the row came back at t=8.2s with no question ever rendered. The user
// taps a visible button and gets a three-second flicker.
//
// The permanent AF live check did not catch it because every one of its journeys reaches Advanced
// Filter through the FILTER flow, where the same cohort opens correctly — measured the same day:
// Rent-Annual/Apartment/Riyadh, chip 10,670, opened on «تفضل تدفع الإيجار على دفعات؟». That is the
// detection gap this rule closes: the invariant is about the OFFER agreeing with the ROUND, and it
// has to be checked on the entry path the user actually took.
//
// WHAT THE RULE IS
// ----------------
// Exactly two outcomes are acceptable after a results turn:
//   • the CTA is NOT offered                      -> nothing was promised, nothing owed;
//   • the CTA is offered AND a question renders   -> the promise was kept.
// Offered-then-nothing is the defect, whatever the underlying cause. Deliberately cause-agnostic:
// it pins the USER-VISIBLE contract, so it keeps holding if the internals are rewritten again.
//
// A card that opens and then closes on its own counts as a violation too: `cardEverAppeared` is
// sampled across the whole observation window, so a flash of 'loading' with no question is not a
// pass. `loadingEverAppeared` is recorded ONLY to sharpen the diagnosis (it distinguishes "the
// round never started" from "the round ran and came back empty"), never to soften the verdict.

// THE ROUND HAS THREE ENDINGS, NOT TWO (2026-09-11, ops_incident #156).
// ---------------------------------------------------------------------
// The two-outcome model above was written on 2026-08-26 and was right for the product as it stood.
// On 2026-09-04 agent.tsx gained an explicit, owner-locked UNKNOWN branch: when the round's count
// probes do not answer even after a bounded retry, it asserts NOTHING and restores «تحديد أكثر»
// (`mayAssertNothingToNarrow(probeVerdict(...))`, src/lib/afProbe.ts). Under the old model that
// correct behaviour was indistinguishable from the defect, and the check filed the strongest
// accusation it could make — «the offer gate and the round gate disagree», a live R4.4.2/R13.10
// violation — against a production that was handling an UNKNOWN exactly as the owner requires.
//
// MEASURED before this was written, twice, on the deployed bundle entry-3545b04a (الرياض / إيجار
// سنوي / شقق): cardEverAppeared=false, loadingEverAppeared=true, **CTA back = true, refine chips =
// false**. That is the UNKNOWN branch, not a disagreement. The likely upstream cause is already
// filed and is not an AF logic defect: apartment_guided_counts_ar on a large unfiltered scope has
// been measured at 14-19 s and has tripped the anon statement timeout (ops_incident #48, #127).
//
// THIS IS NOT A SOFTENER, AND THE GUARD BELOW PROVES IT. Every input that failed under the old
// model still fails: `ok` is still true for exactly two observations (not offered, card appeared)
// and for nothing else. What changes is WHICH failure is reported — a check that names the wrong
// cause sends the next engineer to rewrite correct product code, which is how this surface has now
// produced five false accusations. 'probe-undetermined' is a FAILURE with `undetermined: true`, so
// the run still goes red (a check that could not certify must never read green) while saying the
// truthful thing.
export type AfCtaObservation = {
  /** Was «خلّنا نحدد الطلب أكثر» (testID=results-narrow) present before the tap? */
  ctaOffered: boolean;
  /** Did an actual AF question card render at any point after the tap? */
  cardEverAppeared: boolean;
  /** Did the actions row ever disappear after the tap (⇒ ageFlow was set, at least to 'loading')? */
  loadingEverAppeared: boolean;
  /**
   * After the round closed with no question: is «تحديد أكثر» back on screen? The product restores it
   * on, and only on, an undetermined probe — asserting nothing about the user's search.
   */
  ctaReturned?: boolean;
  /**
   * After the round closed with no question: did the plain refine chips appear? The product reaches
   * startRefine() on, and only on, a MEASURED 'no' — so this is the round ASSERTING that nothing
   * certified narrows, which is the genuine disagreement with an offer that promised one.
   */
  refineChipsAppeared?: boolean;
  /** Label for the journey, used in the failure message. */
  journey: string;
};

export type AfCtaVerdict =
  | { ok: true; reason: 'not-offered' | 'offered-and-opened' }
  | {
      ok: false;
      reason: 'offered-but-never-opened' | 'offered-then-asserted-nothing-narrows'
            | 'offered-then-stranded' | 'probe-undetermined';
      /** true ⇒ production asserted nothing and this run could not certify R4.4.2 either way. */
      undetermined?: true;
      diagnosis: string;
    };

export function judgeAfCta(o: AfCtaObservation): AfCtaVerdict {
  if (!o.ctaOffered) return { ok: true, reason: 'not-offered' };
  if (o.cardEverAppeared) return { ok: true, reason: 'offered-and-opened' };

  // The round never started at all — the tap took the non-AF branch. Unchanged from 2026-08-26.
  if (!o.loadingEverAppeared) {
    return {
      ok: false,
      reason: 'offered-but-never-opened',
      diagnosis: `${o.journey}: the CTA was offered but the round NEVER STARTED (the actions row never `
        + 'hid, so ageFlow was never set) and no question rendered. The tap handler took the non-AF '
        + 'branch while the offer gate had already promised a round.',
    };
  }

  // The round RAN. What it did next is the whole finding.
  if (o.refineChipsAppeared) {
    return {
      ok: false,
      reason: 'offered-then-asserted-nothing-narrows',
      diagnosis: `${o.journey}: the CTA was offered, the round STARTED, and it then ASSERTED that `
        + 'nothing certified narrows — it fell through to the plain refine chips, which the product '
        + 'only reaches on a MEASURED "no" (mayAssertNothingToNarrow). So the offer gate and the round '
        + 'gate genuinely disagree: one said "there is a useful question here" and the other measured '
        + 'that there is not.',
    };
  }
  if (o.ctaReturned) {
    return {
      ok: false,
      reason: 'probe-undetermined',
      undetermined: true,
      diagnosis: `${o.journey}: NOT EXERCISED — the round STARTED, could not determine its option `
        + 'counts even after the bounded retry, asserted NOTHING, and restored «تحديد أكثر» so the user '
        + 'can try again. That is the owner-locked UNKNOWN handling (src/lib/afProbe.ts) behaving '
        + 'correctly, NOT an offer/round disagreement — so R4.4.2/R13.10 is neither proved nor broken '
        + 'by this run. Look upstream at the count probe, not at the AF gates: '
        + 'apartment_guided_counts_ar has been measured at 14-19s on a large scope and has tripped the '
        + 'anon statement timeout (ops_incident #48, #127).',
    };
  }
  return {
    ok: false,
    reason: 'offered-then-stranded',
    diagnosis: `${o.journey}: the CTA was offered, the round STARTED, and then NOTHING came back — no `
      + 'question, no refine chips, and «تحديد أكثر» did not return. The user tapped a visible button '
      + 'and was left with no way forward at all.',
  };
}
