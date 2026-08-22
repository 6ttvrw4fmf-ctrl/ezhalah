// THE Advanced Filter interview record — pure, so it can be EXECUTED by a barrier rather than
// pattern-matched (owner 2026-08-22, «رجوع»).
//
// The interview is ONE ordered list of the questions presented, each carrying the answer recorded
// for it, plus a CURSOR into that list. Everything the rest of the flow reads — the narrowed query,
// which questions count as asked, the summary labels, the removable result pills — is DERIVED from
// that list by `deriveGuided`, never mutated in place.
//
// Why it matters: Back has to un-apply an answer. Un-applying by writing a per-question inverse is
// exactly how a stale predicate survives a "removed" answer, and how an APPENDING answer (amenities)
// accumulates twice when the same question is answered again. Rebuilding from `base` by re-applying
// the steps before the cursor makes both failures structurally impossible — a step that is dropped,
// changed, or sitting under the cursor simply does not contribute.
import type { SearchQuery } from '@/data/search';
import type { AdvancedOption, AdvancedQuestion } from '@/data/advancedFilters';

// `keys: null` = presented but not answered yet · `[]` = SKIPPED (no preference — never a "no", so
// it writes no predicate) · non-empty = the picked option keys. `options`/`total` are the live
// values the question was presented WITH, so walking Back re-shows exactly what the user saw.
export type GuidedStep = {
  question: AdvancedQuestion;
  options: AdvancedOption[];
  unknownCount: number;
  total: number;
  keys: string[] | null;
};

// Order-insensitive: a multi-select answer re-confirmed in a different tap order is the SAME answer
// and must not trigger a needless re-validation of everything that came after it.
export const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export type DerivedGuided = {
  query: SearchQuery | null;
  askedIds: string[];
  labels: string[];
  facets: Array<{ id: string; keys: string[]; labels: string[] }>;
};

// Rebuild everything from steps[0 .. upTo-1]. `upTo` is the CURSOR: the step being asked is
// deliberately NOT applied, so its option counts and live count read against the scope the user is
// answering FROM — re-answering a question never stacks on top of its own previous answer.
export function deriveGuided(base: SearchQuery | null, steps: readonly GuidedStep[], upTo: number): DerivedGuided {
  let query = base;
  const labels: string[] = [];
  const facets: DerivedGuided['facets'] = [];
  const askedIds: string[] = [];
  for (const st of steps.slice(0, Math.max(0, upTo))) {
    if (st.keys == null) continue;             // presented, not answered — not asked, not applied
    askedIds.push(st.question.id);
    if (!st.keys.length) continue;             // SKIPPED: asked, but contributes no predicate at all
    if (query) query = st.question.apply(query, st.keys);
    const ls = st.keys.map((k) => st.options.find((o) => o.key === k)?.label).filter(Boolean) as string[];
    labels.push(...ls);
    facets.push({ id: st.question.id, keys: st.keys, labels: ls });
  }
  return { query, askedIds, labels, facets };
}
