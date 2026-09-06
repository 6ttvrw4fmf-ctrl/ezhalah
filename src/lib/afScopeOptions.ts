// PURE: the counts row → the option list for an Advanced Filter SCOPE tier (group / type).
// Lives in src/lib (no React, no network, no i18n) so scripts/verify-af-unknown-is-not-no-scope-options.ts
// can EXECUTE it — the afProbe/afPlan/afRanking precedent. Owner rule 2026-09-04: UNKNOWN IS NOT NO.
//
//   measured 0            → dropped   (a dead end that would promise results it cannot deliver)
//   measured n > 0        → offered with its number
//   UNKNOWN (null/absent) → offered WITHOUT a number
//
// WHY. A scope option used to be dropped whenever its count RPC timed out or errored, so a slow
// count read as "this branch does not exist". Reproduced live 2026-09-04 (Riyadh / Buy / apartments
// group, 21,892): شقة ~10.6k and دور ~9.7k — the two largest, therefore slowest, counts — vanished
// while غرفة=1 and عمارة سكنية=1,554 stayed. The user's real answer was not on the card, the type
// stayed unresolved, the cohort intersection was empty, and the interview dumped the whole group.
// remote.ts retries a failed count once; whatever is still undetermined arrives here as null.
//
// `unknownCount` is a truthful single number only when every offered count is measured; otherwise
// null (the card shows no caption rather than a fabricated remainder — R7.1.3). `total` prefers the
// measured scope total and falls back to the sum of measured options (a floor, never an invention).
import type { AdvancedOption, AdvancedQuestionResult } from './afRanking';

export const SCOPE_TOTAL_KEY = '__scope_total__';

export function scopeOptionsFromCounts(
  keys: readonly string[],
  counts: Record<string, number | null> | null,
  label: (key: string) => string,
): AdvancedQuestionResult {
  const options: AdvancedOption[] = keys
    .filter((key) => counts?.[key] !== 0)                       // only a MEASURED zero is a dead end
    .map((key) => ({ key, label: label(key), count: counts?.[key] ?? null }));
  const anyUnknown = options.some((o) => o.count == null);
  const offered = options.reduce((n, o) => n + (o.count ?? 0), 0);
  const scopeTotal = counts?.[SCOPE_TOTAL_KEY];
  const total = scopeTotal ?? offered;
  return { options, unknownCount: anyUnknown ? null : Math.max(0, total - offered), total };
}
