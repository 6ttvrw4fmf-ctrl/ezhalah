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

const AGE_BUCKETS: Array<{ key: string; labelKey: string; count: (c: AgeOptionCounts) => number }> = [
  { key: 'new', labelKey: 'New construction', count: (c) => c.cnt_new },
  { key: 'lt1', labelKey: 'Less than a year', count: (c) => c.cnt_lt1 },
  { key: '1_2', labelKey: '1–2 years', count: (c) => c.cnt_1_2 },
  { key: '3_5', labelKey: '3–5 years', count: (c) => c.cnt_3_5 },
  { key: '6_9', labelKey: '6–9 years', count: (c) => c.cnt_6_9 },
  { key: '10p', labelKey: '10+ years', count: (c) => c.cnt_10p },
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
    logAgeConcentration(counts.platform_breakdown);
    const options = AGE_BUCKETS
      .map((b) => ({ key: b.key, label: t(b.labelKey), count: b.count(counts) }))
      .filter((o) => o.count > 0); // rule 4: only options with ≥1 active matching listing in THIS scope
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
