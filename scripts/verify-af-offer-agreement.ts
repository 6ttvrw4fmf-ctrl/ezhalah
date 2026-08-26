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
  check('the "started" diagnosis names the empty plan',
    !started.ok && /EMPTY plan/.test(started.diagnosis), !started.ok ? started.diagnosis : '');
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
    for (const journey of ['a', 'b']) {
      if (judgeAfCta(obs({ cardEverAppeared: false, loadingEverAppeared: loading, journey })).ok) softened++;
    }
  }
  check('SOFTENER GUARD: with the CTA offered, NO combination of other signals may pass without a card',
    softened === 0, `${softened} combination(s) passed without a rendered question`);
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
    /الوكيل الذكي/.test(live), 'no agent-tab entry found — a Filter-flow journey cannot catch this bug');
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
