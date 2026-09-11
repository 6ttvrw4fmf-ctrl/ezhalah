// ONE MAIN REQUEST + ONE FOLLOW-UP (owner rule, 2026-09-11). Ezhalah's free-text AI composer is not
// an unlimited chatbot. Once a chat has shown its FIRST result set (from Filter or from the AI
// Agent's own onboarding), the user gets exactly one more free-text refinement message. Ezhalah may
// ask AT MOST one follow-up — only when the user's exact compound requirement has ZERO matches but
// dropping ONE of this turn's own new requirements would produce results — and the user's reply to
// that follow-up (yes/no, loosely parsed) always ends the turn. Off-topic replies, fully-resolved
// searches, and a follow-up's answer all lock the composer; nothing else in the app is affected —
// Advanced Filter, its own «نتائج أدق» fallback question, Show More and normal Filter stay untouched
// (they do not run through this module or through the free-text composer at all).
//
// Pure, side-effect-free by design (same rule as every permanent-rule module in this repo — testable
// without React, a live network call, or the edge function): src/app/agent.tsx is the only caller.

import type { SearchQuery } from '@/data/search';

export type RefinementTurnState = 'available' | 'awaiting_followup' | 'locked';

/** Has this turn actually established a value? Mirrors conversationState.ts's own predicate exactly
 * (kept local + duplicated rather than exported, since exporting a one-line helper across modules for
 * a single extra call site is not worth the coupling — see AGENTS.md token-efficiency rule). */
function established(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true; // boolean/number: false and 0 are real answers, not absence
}

// The ONLY fields this module will ever offer to drop. Deliberately a SUBSET of STICKY_FIELDS —
// never the identity of the search (deal, location, category, type, budget, platforms). Relaxing
// "villa in Riyadh" down to "anything in Riyadh" is not what a user who over-asked for a gym meant;
// relaxing "villa with a gym and 2 pools" down to "villa with a gym" is. Order is the trial order —
// deterministic, and short-circuits on the first field whose removal produces a real result.
export const RELAXABLE_FIELDS = [
  'detail', 'districts', 'amenities', 'furnishedPref', 'bathMin', 'ratingMin', 'reviewsMin',
  'ageMin', 'ageMax', 'isNewConstruction', 'streetWidthMin', 'directions', 'unitSubtypes',
  'areaMin', 'areaMax',
] as const satisfies readonly (keyof SearchQuery)[];
export type RelaxableField = (typeof RELAXABLE_FIELDS)[number];

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** State-machine step: called once a REFINEMENT turn (post-results) has resolved.
 *  - Answering the one allowed follow-up ALWAYS locks, no matter how it was answered.
 *  - A fresh 'available' turn locks unless this specific response IS the one offered follow-up. */
export function nextTurnState(current: RefinementTurnState, offeredFollowup: boolean): RefinementTurnState {
  if (current === 'awaiting_followup') return 'locked';
  return offeredFollowup ? 'awaiting_followup' : 'locked';
}

/** Which relaxable fields did THIS turn newly establish or change, relative to the query before it?
 * `prev` null (no prior turn recorded) ⇒ every established relaxable field is a candidate, matching
 * mergeConversationState's own "no prev ⇒ nothing to compare against" convention. */
export function relaxationCandidates(prev: SearchQuery | null | undefined, next: SearchQuery): RelaxableField[] {
  const p = (prev ?? {}) as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  return RELAXABLE_FIELDS.filter((f) => established(n[f]) && (!prev || !eq(p[f], n[f])));
}

/** `next` with exactly one field reverted to its value on `prev` (usually absent ⇒ cleared). */
export function withFieldRelaxed(prev: SearchQuery | null | undefined, next: SearchQuery, field: RelaxableField): SearchQuery {
  const p = (prev ?? {}) as Record<string, unknown>;
  return { ...next, [field]: p[field] ?? null } as SearchQuery;
}

// Loose yes/no, Arabic-dialect-aware (never digit-blind — mirrors the Arabic-notation-parity rule for
// deterministic parsers elsewhere in the repo: نعم/ايه/اه/تمام/اوك/أكيد all read as yes in normal
// Saudi chat). Anything that isn't recognisably affirmative is treated as "no" — the spec's own binary
// framing ("the user answers YES or NO") leaves no third state, and an unclear reply must never be
// read as consent to widen a search the user did not ask to widen.
//
// Matched by FIRST-TOKEN membership, never a \b-anchored regex: JS regex word boundaries are ASCII-
// only (\w = [A-Za-z0-9_]), so \b silently fails to bound an Arabic word — "نعم" alone would never
// match a \b-anchored alternation, the exact trap the barrier's own mutation-proof pins.
const YES_WORDS = new Set([
  'yes', 'yeah', 'yep', 'sure', 'ok', 'okay',
  'نعم', 'ايوه', 'أيوه', 'ايه', 'أه', 'اه', 'تمام', 'اوك', 'أوك', 'أكيد', 'اكيد', 'ابشر', 'زين', 'طيب', 'ياريت',
]);
export function parseYesNo(text: string): 'yes' | 'no' {
  const first = (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[.,!؟?،]+$/, '');
  return YES_WORDS.has(first) ? 'yes' : 'no';
}

// Arabic label for the ONE dropped requirement, named so the follow-up question is honest about
// exactly what would be missing ("couldn't find a match WITH X — show it without X?"), never a vague
// "some of your filters". English fallback for an English-language chat (see agent.tsx's per-message
// locale flip). Every RELAXABLE_FIELDS entry must resolve here — a barrier pins that.
const LABELS_AR: Record<RelaxableField, string> = {
  detail: 'عدد الغرف',
  districts: 'الحي المحدد',
  amenities: 'بعض المرافق المطلوبة',
  furnishedPref: 'شرط التأثيث',
  bathMin: 'الحد الأدنى لعدد الحمامات',
  ratingMin: 'الحد الأدنى للتقييم',
  reviewsMin: 'الحد الأدنى لعدد التقييمات',
  ageMin: 'الحد الأدنى لعمر العقار',
  ageMax: 'الحد الأقصى لعمر العقار',
  isNewConstruction: 'شرط أنه جديد',
  streetWidthMin: 'الحد الأدنى لعرض الشارع',
  directions: 'اتجاه الواجهة',
  unitSubtypes: 'النوع الفرعي المحدد',
  areaMin: 'الحد الأدنى للمساحة',
  areaMax: 'الحد الأقصى للمساحة',
};
const LABELS_EN: Record<RelaxableField, string> = {
  detail: 'the bedroom count',
  districts: 'the specific district',
  amenities: 'some of the requested amenities',
  furnishedPref: 'the furnishing requirement',
  bathMin: 'the minimum bathroom count',
  ratingMin: 'the minimum rating',
  reviewsMin: 'the minimum review count',
  ageMin: 'the minimum property age',
  ageMax: 'the maximum property age',
  isNewConstruction: 'the new-construction requirement',
  streetWidthMin: 'the minimum street width',
  directions: 'the facing direction',
  unitSubtypes: 'the specific unit subtype',
  areaMin: 'the minimum area',
  areaMax: 'the maximum area',
};
export function relaxedFieldLabel(field: RelaxableField, locale: 'ar' | 'en'): string {
  return (locale === 'ar' ? LABELS_AR : LABELS_EN)[field];
}
