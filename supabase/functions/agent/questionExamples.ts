// EXAMPLES INSIDE THE AGENT'S QUESTIONS (owner 2026-10-11: «always give examples so the user knows what to type»).
// Picked by CODE from real data, never by the AI, so every example really works and costs no tokens.
//   • the two cities with the most listings in our database (measured 2026-10-11 with top_cities_by_deal_ar():
//     الرياض 152,942 · جدة 82,466 · then الخبر 15,644 · الدمام 14,638);
//   • example SEARCHES are sentences already proven against the live agent (docs/ops/INTRO_EXAMPLES_PROOF.md).
// An example shows how to TYPE, never what to CHOOSE: no «best», no recommendation.
// Mirrored literally from src/data/questionExamples.ts (Deno cannot import from src/):
// scripts/verify-question-examples.ts fails if the two files drift apart.
export const EXAMPLE_CITIES_AR = ['الرياض', 'جدة'] as const;
export const EXAMPLE_CITIES_EN = ['Riyadh', 'Jeddah'] as const;
export const EXAMPLE_SEARCH_AR = 'أبي شقة ٣ غرف في الدمام';
export const EXAMPLE_SEARCH_EN = 'Villa in Jeddah';
export const PIN = '📍';
export const HOUSE = '🏡';
export const cityExampleAr = (): string => `مثلاً ${EXAMPLE_CITIES_AR.join(' أو ')}`;
export const cityExampleEn = (): string => `For example ${EXAMPLE_CITIES_EN.join(' or ')}`;
