// THE DAILY COVERAGE PLANNER — stale-first, risk-first, under a fixed production budget.
//
// OWNER RULE, 2026-08-28: «Do not increase production traffic merely to make the search count
// larger. The objective is coverage and defect detection, not request volume. For the daily
// heartbeat, use a bounded production budget and prioritize coverage stalest-first and risk-first
// across property type × city/district × deal/period × filters.»
//
// WHY THIS FILE EXISTS. On 2026-08-28 the daily run fired 446 RPC searches chosen by POPULATION —
// biggest populated cell first. That is precisely the failure the owner named: it re-tested الرياض
// apartments while «سكن عمال», «مخيم» and dozens of small cities went untouched for weeks, and the
// browser sweep (which HAS rotated stalest-first from the ledger since 2026-08-23) was the only
// layer whose coverage actually moved. The count looked impressive and the coverage did not improve.
//
// THE BUDGET IS A CEILING, NOT A TARGET. It exists because production is 2 vCPU and the search RPC
// is already 64.4% of all database time (§40.1). Spending less of it is a perfectly good run;
// spending it on cells that were tested yesterday is not.

import { cohortKey } from './request.mjs';

/** §40.6 safety envelope. A daily heartbeat may not exceed this without an owner-stated reason. */
export const DAILY_BUDGET = 500;

/**
 * RISK WEIGHTS — what earns a slot beyond raw staleness. Each is a bug class this routine has
 * actually found, so "risk-first" means "where defects have really lived", not intuition.
 */
export const RISK = {
  neverTested: 400,        // a cell no run has ever touched is the highest risk in the system
  perStaleDay: 12,         // staleness, valued linearly
  combinedDeal: 60,        // §41.17 — Buy+Rent combined has its own table scope; found live 2026-08-27
  monthlyPeriod: 45,       // §41.6  — the monthly-only sources attach only on some searches
  periodBoth: 40,          // «كلاهما» is NOT null; its own RPC branch
  overlayCohort: 35,       // scope2 cohorts (§41.14) — where p_types2 mistakes surface
  commercialMacro: 25,     // category purity leaks are Commercial-macro rows in residential tables
  smallCohort: 20,         // tiny populations expose boundary/rounding bugs big ones hide
  nonRiyadh: 15,           // the rotation exists to stop Riyadh eating every run
};

/**
 * Score one candidate cell. Higher = tested sooner.
 * @param {object} c    { uiType, deal, period, combined, city, n, macro, hasOverlay }
 * @param {Map}    seen key → staleness_days (absent = never tested)
 */
export function score(c, seen) {
  const key = cohortKey(c);
  const stale = seen.get(key);
  let s = stale === undefined ? RISK.neverTested : Math.round(stale * RISK.perStaleDay);
  if (c.combined) s += RISK.combinedDeal;
  else if (c.period === 'شهري') s += RISK.monthlyPeriod;
  else if (c.period === 'كلاهما') s += RISK.periodBoth;
  if (c.hasOverlay) s += RISK.overlayCohort;
  if (c.macro === 'Commercial') s += RISK.commercialMacro;
  if (c.n != null && c.n < 50) s += RISK.smallCohort;
  if (c.city !== 'الرياض') s += RISK.nonRiyadh;
  return s;
}

/**
 * Choose this run's cells. Stale-first and risk-first, then capped by the budget — and spread, so
 * one very stale نوع cannot take the whole run.
 *
 * @param {Array} cells   every populated (نوع × عملية × فترة × مدينة) cell, from the live index
 * @param {Map}   seen    ledger key → staleness in days
 * @param {number} budget how many searches this run may spend on cells
 * @param {number} perTypeCap the most cells any single نوع may take
 */
export function planCells(cells, seen, budget = DAILY_BUDGET, perTypeCap = 0) {
  const cap = perTypeCap || Math.max(3, Math.ceil(budget / Math.max(1, new Set(cells.map((c) => c.uiType)).size)) * 2);
  const ranked = cells
    .map((c) => ({ ...c, score: score(c, seen), stale: seen.get(cohortKey(c)) ?? null }))
    .sort((a, b) => b.score - a.score || (b.n ?? 0) - (a.n ?? 0));
  const perType = new Map();
  const out = [];
  for (const c of ranked) {
    if (out.length >= budget) break;
    const used = perType.get(c.uiType) ?? 0;
    if (used >= cap) continue;
    perType.set(c.uiType, used + 1);
    out.push(c);
  }
  return out;
}

/**
 * The filter-shape variations layered on top of the chosen cells. These are the dimensions §5–§7,
 * §31 and §32 require every day; each is attached to a DIFFERENT cell so a shape and a cohort are
 * never confounded, and so a shape never costs a cell its own plain-search coverage.
 */
export const SHAPES = [
  { tag: 'p-min', priceMin: 300000 },
  { tag: 'p-max', priceMax: 900000 },
  { tag: 'p-band', priceMin: 400000, priceMax: 800000 },
  { tag: 'p-narrow', priceMin: 499000, priceMax: 501000 },
  { tag: 'p-low', priceMax: 1000 },
  { tag: 'p-high', priceMin: 50000000 },
  { tag: 'a-min', areaMin: 200 },
  { tag: 'a-max', areaMax: 150 },
  { tag: 'a-band', areaMin: 300, areaMax: 600 },
  { tag: 'a-huge', areaMin: 10000 },
  { tag: 'beds-1', beds: [1] },
  { tag: 'beds-3', beds: [3] },
  { tag: 'beds-5plus', bedsMin: 5 },
  { tag: 'price+area', priceMin: 200000, priceMax: 3000000, areaMin: 100, areaMax: 1200 },
  { tag: 'zero-probe', priceMin: 999000001, priceMax: 999000002 },
];
