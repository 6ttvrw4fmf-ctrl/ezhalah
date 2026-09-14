// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ORPHANED JOURNEY-LEDGER KEYS (routine #6, 2026-09-14)
//
// `scripts/verify-journey-ledger-reachable.ts` (2026-08-31) closed the WRITE door: `ledgerRecord()`
// refuses a key no committed journey can emit, and fails closed. That guard works and is unchanged
// here.
//
// It does not, and cannot, look at rows ALREADY in the table — and three were. On 2026-08-30 a run
// wrote `adv-favorite-survives-navigation`, `adv-favorites-remove` and
// `adv-modeswitch-back-push-vs-replace` in the pre-suffix key format. The journeys were then landed
// properly and have been driven ever since under `…:desktop` / `…:mobile` (6 descendants each,
// 62–128 recorded runs). The three bare rows stayed, frozen at 2026-08-30, unwritable by
// construction — `ledgerKeysFor()` always appends a viewport suffix, so nothing can ever touch them
// again.
//
// WHY A FROZEN ROW IS NOT HARMLESS. PART 3 item 7 gives the ledger exactly one job: decide which
// surface gets attacked next, oldest first. A row nothing can refresh sits at the TOP of that
// ordering forever. So the three best-covered adversarial surfaces in the suite permanently
// impersonated the three most neglected ones, and the rotation pointed there every single run.
// Measured 2026-09-14: they were the top three of an oldest-first query, 15 days stale, while their
// own descendants had been green that morning. This routine followed that signal before catching it.
//
// The 2026-08-31 fix was right and incomplete in the shape §G.9 warns about: root cause fixed and a
// barrier added, while the DATA left behind kept producing the original symptom.
//
// THE CLASS RECURS ON A RENAME. Nothing about this needed a key-FORMAT change: renaming any journey
// (`voice-control` → `voice-input`, say) orphans its keys identically, and journeys do get renamed —
// PART 9.5 is a whole section about a rename that four e2e suites were never updated for. So the
// rule is checked, not remembered.
//
// The producible set comes from `ledgerKeysFor()` ITSELF rather than a second copy of its spelling,
// so a future change to the key shape moves both sides together instead of silently splitting them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { ledgerKeysFor } from '../../e2e/journeys/harness.mjs';

/** Every engine the sweep can run under — `.github/workflows/journey-sweep.yml`'s matrix. */
export const LEDGER_ENGINES = ['chromium', 'webkit', 'firefox'] as const;

/** Every ledger key the committed suite is capable of writing, across all engines and viewports. */
export function producibleLedgerKeys(registeredJourneyNames: string[]): Set<string> {
  const keys = new Set<string>();
  for (const engine of LEDGER_ENGINES) {
    for (const k of ledgerKeysFor(registeredJourneyNames, engine)) keys.add(k);
  }
  return keys;
}

/**
 * Ledger keys that NO committed journey can produce — rows that can never be refreshed and will
 * therefore lead the oldest-first rotation forever.
 *
 * Returned sorted so a failure message is stable and diffable rather than set-ordered.
 *
 * Deliberately NOT a "looks stale" heuristic: staleness is what a genuinely neglected surface looks
 * like too, and a rule that cannot tell those apart would either hide real neglect or delete real
 * coverage. Reachability is the fact that actually distinguishes them.
 */
export function orphanLedgerKeys(registeredJourneyNames: string[], ledgerKeys: string[]): string[] {
  const producible = producibleLedgerKeys(registeredJourneyNames);
  return [...new Set(ledgerKeys.filter((k) => !producible.has(k)))].sort();
}
