// How long an Advanced Filter round shows «إزهله يفحص المواقع حسب اختيارك…» and how its picks tick
// off one by one (owner 2026-10-10: «make it 5 seconds», then «it can take up to 7 seconds max»).
// Pure so scripts/verify-af-round-checks-your-picks.ts can execute it.
//
// The whole visible beat — the checklist hold PLUS the loader's exit fade — lands between 5 s and 7 s:
// a short pick list still gets 5 s (each pick checked slowly), a long one never passes 7 s (each pick
// checked faster). Row i turns active at startMs + i·stepMs and ticks ✓ at 80 % of its step, so the last
// tick always lands before the hold ends.
import { AF_LINE_LABEL, AF_LINE_FALLBACK, type AfFacet } from './afSummary.ts';

export const AF_CHECK_MIN_MS = 5000;
export const AF_CHECK_MAX_MS = 7000;
const START_MS = 300;
const STEP_MS = 1400;
const SETTLE_MS = 600;

export function afCheckTiming(picks: number, exitMs: number): { startMs: number; stepMs: number; holdMs: number } {
  const n = Math.max(1, picks);
  const holdMs = Math.min(AF_CHECK_MAX_MS - exitMs, Math.max(AF_CHECK_MIN_MS - exitMs, START_MS + n * STEP_MS + SETTLE_MS));
  return { startMs: START_MS, stepMs: Math.floor((holdMs - START_MS - SETTLE_MS) / n), holdMs };
}

// Every pick the user has committed in this Advanced Filter, in order, once each — the checklist rows,
// each named by the same line label the summary uses («دورات المياه: +١», not a bare «+١»).
export const afPickLabels = (facets: AfFacet[], translate: (key: string) => string): string[] =>
  [...new Set(facets.flatMap((f) => f.labels.map((l) => `${translate(AF_LINE_LABEL[f.id] ?? AF_LINE_FALLBACK)}: ${l}`)))];
