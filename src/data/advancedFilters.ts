import type { SearchQuery } from './search';
import { fetchPropertyAgeOptionCounts, type AgeOptionCounts } from './remote';
import { t } from '@/i18n';

// Reusable advanced-question engine («خلّنا نحدد الطلب أكثر»). عمر العقار (below) is the first and, for
// this build, ONLY entry — it exists to be the reference template. Adding الواجهة / الحمامات / الفرش /
// رقم الدور / عرض الشارع later means adding ONE more AdvancedQuestionConfig object to ADVANCED_QUESTIONS
// and nothing else: AdvancedQuestionCard.tsx and agent.tsx's age-flow orchestration are driven entirely
// by this config and must never gain a field-specific branch (owner instruction: do not hardcode the
// engine to age). Reached ONLY from the results screen's existing «خلّنا نحدد الطلب أكثر» button, in a
// strict Residential+Apartment scope — never before first results, never for other types (2026-07-13).

// One tappable choice inside a question card, with its LIVE count already resolved for the user's
// full current normal-filter scope (deal/category/group/type/region/city/district/price/area/bedrooms
// + any earlier-answered advanced question). `count` is always the combined cross-platform total —
// per-platform contribution is tracked separately and never rendered (rule: one combined count only).
export type AdvancedOption = {
  key: string;
  label: string;
  count: number;
};

export type AdvancedQuestionResult = {
  options: AdvancedOption[]; // pre-filtered to count > 0 — callers render exactly this list, no re-filtering
  unknownCount: number;      // disclosed as a caption, never a selectable bucket (unknown stays eligible, never "0")
};

export type AdvancedQuestionConfig = {
  key: string;
  titleKey: string; // i18n key for the card's question title
  fetchOptions: (q: SearchQuery) => Promise<AdvancedQuestionResult>;
  applyAnswer: (q: SearchQuery, optionKey: string) => SearchQuery;
};

// Fewer than this many real (count > 0) options → the caller falls back to whatever else it does for
// "narrow further" (agent.tsx falls back to the pre-existing refine chips). A "choice" between zero or
// one real answers isn't a meaningful question.
export const MIN_OPTIONS_TO_SHOW = 2;

// Owner 2026-07-16: don't even attempt the question unless the current scope has enough total
// matching listings to make it worth asking — grounded in real Buy/Rent × city distributions (see
// project memory): there's a natural gap in the live data between ~112 and ~192-653 total listings.
export const MIN_TOTAL_TO_SHOW = 150;

// Owner 2026-07-16: a bucket only counts as a real, meaningful option once it has at least this many
// REAL (non-null-age) listings behind it. Every bucket except cnt_new is OR-NULL-safe by design
// (unknown-age listings stay eligible for every numeric range, per the migration's data-semantics
// decision) — so raw `count > 0` alone doesn't mean the bucket has real age-tagged signal, only that
// SOME listing in scope has an unknown age. Live-verified this was a real gap, not theoretical: a
// 909-listing scope that was 98% unknown-age showed every numeric bucket as "count > 0" while the
// real per-bucket count was ≤8.
export const MIN_REAL_BUCKET_COUNT = 5;

const AGE_BUCKETS: Array<{
  key: string;
  labelKey: string;
  count: (c: AgeOptionCounts) => number;
  // REAL (non-null-age) count backing this bucket — cnt_new is already strict (property_age=0 only,
  // no OR-NULL), so it needs no adjustment; every other bucket subtracts cnt_unknown to undo the
  // OR-NULL inflation and expose the true age-tagged signal.
  real: (c: AgeOptionCounts) => number;
}> = [
  { key: 'new', labelKey: 'New construction', count: (c) => c.cnt_new, real: (c) => c.cnt_new },
  { key: 'lt1', labelKey: 'Less than a year', count: (c) => c.cnt_lt1, real: (c) => c.cnt_lt1 - c.cnt_unknown },
  { key: '1_2', labelKey: '1–2 years', count: (c) => c.cnt_1_2, real: (c) => c.cnt_1_2 - c.cnt_unknown },
  { key: '3_5', labelKey: '3–5 years', count: (c) => c.cnt_3_5, real: (c) => c.cnt_3_5 - c.cnt_unknown },
  { key: '6_9', labelKey: '6–9 years', count: (c) => c.cnt_6_9, real: (c) => c.cnt_6_9 - c.cnt_unknown },
  { key: '10p', labelKey: '10+ years', count: (c) => c.cnt_10p, real: (c) => c.cnt_10p - c.cnt_unknown },
];

// Internal-only concentration visibility (rule 6): logs which platforms back a bucket so a
// near-single-platform field can be caught in monitoring, without ever surfacing a per-platform
// number in the UI. No ops-console ingestion is wired yet (see dashboard-first-monitoring-rule in
// memory) — a real sink is a deliberate follow-up, not something this PR should invent.
function logAgeConcentration(breakdown: AgeOptionCounts['platform_breakdown']): void {
  if (!breakdown) return;
  if (__DEV__) console.log('[advancedFilters] property_age platform breakdown', breakdown);
}

const AGE_QUESTION: AdvancedQuestionConfig = {
  key: 'property_age',
  titleKey: 'How old is the property?',
  async fetchOptions(q) {
    const counts = await fetchPropertyAgeOptionCounts(q);
    if (!counts) return { options: [], unknownCount: 0 };
    // Owner 2026-07-16: too few total matching listings → the question can't meaningfully narrow
    // anything down. Return empty rather than special-case this — the caller's existing
    // MIN_OPTIONS_TO_SHOW fallback (to the plain refine-chip flow) handles it identically to "no
    // real buckets", so this stays a single code path.
    if (counts.cnt_total < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
    logAgeConcentration(counts.platform_breakdown);
    const options = AGE_BUCKETS
      // rule 4 (updated 2026-07-16): only options with a MEANINGFUL number of REAL (non-null-age)
      // matching listings — not just count > 0 (see MIN_REAL_BUCKET_COUNT comment above for why raw
      // count alone was misleading). The displayed `count` stays the raw cnt_X — that's still exactly
      // what Search returns if this option is picked (unknown-age listings are meant to stay eligible
      // at search time; this filter only decides whether the OPTION is worth offering at all).
      .filter((b) => b.real(counts) >= MIN_REAL_BUCKET_COUNT)
      .map((b) => ({ key: b.key, label: t(b.labelKey), count: b.count(counts) }));
    return { options, unknownCount: counts.cnt_unknown };
  },
  applyAnswer(q, key) {
    switch (key) {
      case 'new': return { ...q, isNewConstruction: true, ageMin: null, ageMax: null };
      case 'lt1': return { ...q, isNewConstruction: null, ageMin: 0, ageMax: 0 };
      case '1_2': return { ...q, isNewConstruction: null, ageMin: 1, ageMax: 2 };
      case '3_5': return { ...q, isNewConstruction: null, ageMin: 3, ageMax: 5 };
      case '6_9': return { ...q, isNewConstruction: null, ageMin: 6, ageMax: 9 };
      case '10p': return { ...q, isNewConstruction: null, ageMin: 10, ageMax: null };
      default: return q;
    }
  },
};

// The engine's question queue — exactly one entry today by explicit owner instruction ("start with
// عمر العقار only; do not build the other advanced questions yet"). Each future field adds one config
// object here, in the order it should be asked.
export const ADVANCED_QUESTIONS: AdvancedQuestionConfig[] = [AGE_QUESTION];
