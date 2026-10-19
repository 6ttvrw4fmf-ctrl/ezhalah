// MUTATION-PROOF for the offer/round agreement rule (scripts/lib/afOfferAgreement.ts).
//
// Hermetic and offline — no browser, no network — so it belongs in `npm test`. The LIVE half that
// drives production's agent flow is scripts/verify-af-agent-cta-live.ts, run from the AF live-truth
// workflow, on the same precedent as every other live check in this repo.
//
//   node --experimental-strip-types scripts/verify-af-offer-agreement.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeAfCta, type AfCtaObservation } from './lib/afOfferAgreement.ts';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const obs = (o: Partial<AfCtaObservation>): AfCtaObservation => ({
  ctaOffered: true, cardEverAppeared: false, loadingEverAppeared: false, journey: 'j', ...o,
});

// ── 1. the truth table ───────────────────────────────────────────────────────────────────────────
// The rule has exactly three outcomes; all four input combinations are pinned so a refactor cannot
// quietly re-map one of them.
check('CTA not offered ⇒ pass (nothing promised)',
  judgeAfCta(obs({ ctaOffered: false })).ok === true);
check('CTA not offered ⇒ pass even if a card somehow appeared',
  judgeAfCta(obs({ ctaOffered: false, cardEverAppeared: true })).ok === true);
check('offered + card appeared ⇒ pass',
  judgeAfCta(obs({ cardEverAppeared: true })).ok === true);
check('offered + card appeared ⇒ reason is offered-and-opened',
  judgeAfCta(obs({ cardEverAppeared: true })).reason === 'offered-and-opened');
check('offered + NO card ⇒ FAIL (this is the production bug)',
  judgeAfCta(obs({})).ok === false);
check('offered + NO card + loading seen ⇒ FAIL (round started, then gave up)',
  judgeAfCta(obs({ loadingEverAppeared: true })).ok === false);

// ── 2. `loadingEverAppeared` may sharpen the diagnosis but must NEVER flip the verdict ───────────
// The exact shape observed in production on 2026-08-26: the actions row hid at 5.0s and returned at
// 8.2s with no question. If a future edit lets "well, it did start" count as a pass, this fails.
{
  const started = judgeAfCta(obs({ loadingEverAppeared: true, journey: 'agent/riyadh' }));
  const never = judgeAfCta(obs({ loadingEverAppeared: false, journey: 'agent/riyadh' }));
  check('a round that STARTED and rendered nothing is still a failure', started.ok === false);
  check('a round that never started and rendered nothing is still a failure', never.ok === false);
  check('the two failures are distinguishable in their diagnosis',
    !started.ok && !never.ok && started.diagnosis !== never.diagnosis);
  check('the "started" diagnosis is about what the round DID next, not a blanket accusation',
    !started.ok && started.reason !== 'offered-but-never-opened', !started.ok ? started.diagnosis : '');
  check('the "never started" diagnosis says the round never started',
    !never.ok && /NEVER STARTED/.test(never.diagnosis), !never.ok ? never.diagnosis : '');
  check('the failing journey is named in the diagnosis',
    !started.ok && started.diagnosis.includes('agent/riyadh'));
}

// ── 3. SOFTENER GUARD ────────────────────────────────────────────────────────────────────────────
// The one way this barrier dies quietly is someone making `cardEverAppeared` optional — treating a
// 'loading' flash, or the CTA merely disappearing, as good enough. Pin that the verdict depends on
// cardEverAppeared and on nothing else once the CTA was offered.
{
  let softened = 0;
  for (const loading of [true, false]) {
    for (const returned of [true, false, undefined]) {
      for (const chips of [true, false, undefined]) {
        for (const journey of ['a', 'b']) {
          const v = judgeAfCta(obs({
            cardEverAppeared: false, loadingEverAppeared: loading,
            ctaReturned: returned, refineChipsAppeared: chips, journey,
          }));
          if (v.ok) softened++;
        }
      }
    }
  }
  check('SOFTENER GUARD: with the CTA offered, NO combination of other signals may pass without a card',
    softened === 0, `${softened} combination(s) passed without a rendered question`);
}

// ── 3b. THE ROUND'S THREE ENDINGS ARE TOLD APART (2026-09-11, ops_incident #156) ─────────────────
// The two-outcome model reported the product's owner-locked UNKNOWN handling as a live R4.4.2
// violation. Measured twice on production (الرياض/إيجار سنوي/شقق): no card, the round STARTED, the
// CTA came BACK and no refine chips appeared — which is `mayAssertNothingToNarrow` declining to
// claim anything, exactly as src/lib/afProbe.ts requires. Each ending now gets its own verdict, and
// each verdict must stay a FAILURE: naming the cause correctly is the point, never going green.
{
  const started = { cardEverAppeared: false, loadingEverAppeared: true } as const;
  const asserted = judgeAfCta(obs({ ...started, refineChipsAppeared: true, ctaReturned: false }));
  const undet = judgeAfCta(obs({ ...started, refineChipsAppeared: false, ctaReturned: true }));
  const stranded = judgeAfCta(obs({ ...started, refineChipsAppeared: false, ctaReturned: false }));

  check('a round that ASSERTED «nothing narrows» is the genuine disagreement',
    !asserted.ok && asserted.reason === 'offered-then-asserted-nothing-narrows'
      && /MEASURED "no"/.test(asserted.diagnosis));
  check('a round that asserted NOTHING and restored the CTA is UNDETERMINED, not an accusation',
    !undet.ok && undet.reason === 'probe-undetermined' && undet.undetermined === true
      && /NOT EXERCISED/.test(undet.diagnosis));
  check('...and it points upstream at the count probe, not at the AF gates',
    !undet.ok && /apartment_guided_counts_ar/.test(undet.diagnosis));
  check('a round that left the user with NOTHING is its own, worst finding',
    !stranded.ok && stranded.reason === 'offered-then-stranded');
  check('the three endings are genuinely distinguishable',
    new Set([asserted.reason, undet.reason, stranded.reason]).size === 3);
  check('UNDETERMINED still FAILS — a run that could not certify never reads green',
    undet.ok === false);
  check('the assertion branch WINS over a returned CTA (chips are the stronger evidence)',
    (() => {
      const both = judgeAfCta(obs({ ...started, refineChipsAppeared: true, ctaReturned: true }));
      return !both.ok && both.reason === 'offered-then-asserted-nothing-narrows';
    })());
  check('an unobserved pair (both undefined) still fails, and never as UNDETERMINED',
    (() => {
      const v = judgeAfCta(obs({ ...started }));
      return !v.ok && v.reason === 'offered-then-stranded' && v.undetermined === undefined;
    })());
  check('a round that NEVER STARTED is unchanged by any of this',
    (() => {
      const v = judgeAfCta(obs({ cardEverAppeared: false, loadingEverAppeared: false, ctaReturned: true }));
      return !v.ok && v.reason === 'offered-but-never-opened' && /NEVER STARTED/.test(v.diagnosis);
    })());
}

// ── 3b. A HEALTHY PROBE IS AN OBSERVATION, AND IT OVERRIDES THE INFERENCE ───────────────────────
// (routine #5, 2026-09-20, ops_incident #340.)
//
// §3 above reads a restored CTA as PROOF that the probes came back undetermined, on the strength of
// "the product restores it on, and only on, an undetermined probe". That "only on" is FALSE, and
// production disproved it: measured five times on الرياض/إيجار/سنوي/شقة, both count RPCs returned
// HTTP 200 in 565-813 ms — far inside the 4 s cap — with NO retry pair on the wire, so
// shouldRetryProbes() never saw 'unknown'. The round still rendered nothing and the CTA still came
// back, and the verdict still read «probe-undetermined … look upstream at the count probe».
//
// That is this surface's own recurring failure mode pointed the other way: instead of accusing a
// correct production, it EXONERATES a broken one and sends the next engineer to a probe that was
// healthy all along. agent.tsx has other silent paths to the same screen — finishGuided()'s bare
// `setAgeFlow(null)` when ageFlowChangedRef is false, and every token-supersession early return.
//
// So the cause is now OBSERVED, never inferred, and an observed-healthy probe makes the round's
// silence a REAL red rather than a NOT EXERCISED.
{
  const started = { cardEverAppeared: false, loadingEverAppeared: true, refineChipsAppeared: false,
                    ctaReturned: true } as const;
  const healthy = judgeAfCta(obs({ ...started, countProbesAnswered: true }));
  const failed = judgeAfCta(obs({ ...started, countProbesAnswered: false }));
  const unobserved = judgeAfCta(obs({ ...started, countProbesAnswered: null }));
  const legacy = judgeAfCta(obs({ ...started }));

  check('an OBSERVED-HEALTHY probe turns the silent round into a real red',
    !healthy.ok && healthy.reason === 'offered-then-closed-silently-on-healthy-probes');
  check('...and it is NOT marked undetermined — this run certified a genuine disagreement',
    !healthy.ok && healthy.undetermined === undefined);
  check('...and it points at the silent early returns, NOT at the count probe',
    !healthy.ok && /finishGuided/.test(healthy.diagnosis)
      && /Do NOT look at the count probe/.test(healthy.diagnosis));
  check('an OBSERVED-FAILED probe is still the owner-locked UNKNOWN, still NOT EXERCISED',
    !failed.ok && failed.reason === 'probe-undetermined' && failed.undetermined === true);
  check('an UNOBSERVED probe falls back to the pre-2026-09-20 reading (nothing is claimed)',
    !unobserved.ok && unobserved.reason === 'probe-undetermined');
  check('a journey that never supplies the field behaves exactly as before (backward compatible)',
    !legacy.ok && legacy.reason === 'probe-undetermined' && legacy.undetermined === true);
  check('the fourth ending is distinguishable from the other three',
    new Set([healthy.reason, failed.reason,
             judgeAfCta(obs({ ...started, refineChipsAppeared: true, ctaReturned: false, countProbesAnswered: true })).reason,
             judgeAfCta(obs({ ...started, ctaReturned: false, countProbesAnswered: true })).reason]).size === 4);
  // THE SOFTENER GUARD, again: healthy probes must never turn a failure into a pass.
  check('a healthy probe never makes an empty round OK',
    healthy.ok === false && failed.ok === false && unobserved.ok === false);
  check('a card that DID open is still a pass whatever the probes did',
    judgeAfCta(obs({ cardEverAppeared: true, loadingEverAppeared: true, countProbesAnswered: false })).ok === true);
}

// ── 4. the live half must exist, and must be reached by the workflow ─────────────────────────────
// A rule nothing runs against production is decoration — the same reasoning as AGENTS.md's
// "a detector outside the roster is decoration".
{
  const root = join(import.meta.dirname, '..');
  const read = (p: string) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
  const live = read('scripts/verify-af-agent-cta-live.ts');
  check('the live agent-flow check exists', live.length > 0,
    'scripts/verify-af-agent-cta-live.ts is missing');
  check('the live check imports the shared rule instead of re-implementing it',
    /from '\.\/lib\/afOfferAgreement\.ts'/.test(live));
  check('the live check drives the AGENT flow, not the Filter flow',
    /الوسيط الذكي/.test(live), 'no agent-tab entry found — a Filter-flow journey cannot catch this bug');
  const wf = read('.github/workflows/af-live-truth-check.yml');
  check('the AF live workflow runs the agent-flow check',
    /verify-af-agent-cta-live\.ts/.test(wf),
    'af-live-truth-check.yml never invokes it, so nothing would run it against production');
}

if (failures.length) {
  console.error('✗ verify-af-offer-agreement FAILED\n');
  for (const f of failures) console.error(`   • ${f}\n`);
  process.exit(1);
}
console.log('✓ AF offer/round agreement pinned: truth table, diagnosis split, softener guard, live check wired.');
