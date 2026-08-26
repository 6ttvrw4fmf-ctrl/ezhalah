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

export type AfCtaObservation = {
  /** Was «خلّنا نحدد الطلب أكثر» (testID=results-narrow) present before the tap? */
  ctaOffered: boolean;
  /** Did an actual AF question card render at any point after the tap? */
  cardEverAppeared: boolean;
  /** Did the actions row ever disappear after the tap (⇒ ageFlow was set, at least to 'loading')? */
  loadingEverAppeared: boolean;
  /** Label for the journey, used in the failure message. */
  journey: string;
};

export type AfCtaVerdict =
  | { ok: true; reason: 'not-offered' | 'offered-and-opened' }
  | { ok: false; reason: 'offered-but-never-opened'; diagnosis: string };

export function judgeAfCta(o: AfCtaObservation): AfCtaVerdict {
  if (!o.ctaOffered) return { ok: true, reason: 'not-offered' };
  if (o.cardEverAppeared) return { ok: true, reason: 'offered-and-opened' };
  return {
    ok: false,
    reason: 'offered-but-never-opened',
    diagnosis: o.loadingEverAppeared
      // The round STARTED and gave up: startAgeFlow ran, ranked, and fell through the
      // `plan.length < MIN_USEFUL_QUESTIONS_TO_SHOW` gate back to setAgeFlow(null).
      ? `${o.journey}: the CTA was offered and the round STARTED (the actions row hid, so ageFlow was `
        + 'set) but no question ever rendered — the round ranked an EMPTY plan and closed itself. The '
        + 'offer gate and the round gate disagree: something said "there is a useful question here" '
        + 'and the round then found none.'
      // The row never hid: startAgeFlow was never entered at all.
      : `${o.journey}: the CTA was offered but the round NEVER STARTED (the actions row never hid, so `
        + 'ageFlow was never set) and no question rendered. The tap handler took the non-AF branch '
        + 'while the offer gate had already promised a round.',
  };
}
