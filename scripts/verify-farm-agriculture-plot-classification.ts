// Automated, REAL regression test for the Farm / Agriculture Plot filter-taxonomy split
// (owner decision 2026-07-21, PR#186, deployed 2026-07-23 — memory: project_farm-agriculture-plot-
// split-2026-07-21). Before this split, أرض زراعية (Agriculture Plot) was silently folded into the
// "Farm" clean type/filter button even though it outnumbered real مزرعة (Farm) listings 5:1 —
// meaning the button mostly surfaced bare agricultural land, not real farms. This split is easy to
// silently re-break: re-merging RAW_TO_CLEAN, dropping the AR_TYPE free-text entry, or losing the
// EN_TO_AR label would each independently reintroduce the exact bug, invisibly (the UI wouldn't
// error, it would just quietly conflate the two again).
//
// The taxonomy-layer checks below import src/data/propertyTypes.ts directly (a pure, RN-free data
// module — same pattern as verify-age-filter-gate.ts). src/data/agent.ts (the mock free-text agent)
// CANNOT be imported this way: its import chain pulls in react-native, which neither plain node nor
// tsx can parse outside the Metro bundler (confirmed: both fail). So the AR_TYPE free-text mapping
// is regression-checked as a SOURCE-TEXT assertion instead (honest about being weaker than executing
// the function — it only proves the literal mapping line still exists, not that nothing upstream
// shadows it). The real executed-behavior proof for the AI layer is the live smoke test against the
// deployed edge function in the daily production-audit routine (hits the actual Gemini classification).
//
//   node --experimental-strip-types scripts/verify-farm-agriculture-plot-classification.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { CLEAN_MACRO, CLEAN_TO_QUERY, EN_TO_AR, normalizeType } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── Taxonomy layer: the two must be DISTINCT clean types, never re-merged ──────────────────────────
check('Farm and Agriculture Plot are both real clean types', 'Farm' in CLEAN_MACRO && 'Agriculture Plot' in CLEAN_MACRO);
check(
  "Farm's query only pulls raw 'Farm' (Agriculture Plot not folded back in)",
  CLEAN_TO_QUERY['Farm'].rawTypes.length === 1 && CLEAN_TO_QUERY['Farm'].rawTypes[0] === 'Farm',
);
check(
  "Agriculture Plot's query only pulls raw 'Agriculture Plot' (not aliased to Farm)",
  CLEAN_TO_QUERY['Agriculture Plot'].rawTypes.length === 1 && CLEAN_TO_QUERY['Agriculture Plot'].rawTypes[0] === 'Agriculture Plot',
);
check("EN_TO_AR['Farm'] is مزرعة", EN_TO_AR['Farm'] === 'مزرعة');
check("EN_TO_AR['Agriculture Plot'] is أرض زراعية", EN_TO_AR['Agriculture Plot'] === 'أرض زراعية');

// normalizeType is the exact function the filter/search/card paths all call — test it directly.
check("normalizeType('Farm') resolves to clean='Farm'", normalizeType('Farm', 'res').clean === 'Farm');
check(
  "normalizeType('Agriculture Plot') resolves to clean='Agriculture Plot' (not 'Farm')",
  normalizeType('Agriculture Plot', 'res').clean === 'Agriculture Plot',
);

// ── AI-agent free-text layer (source-text tripwire — see header note on why not executed) ──────────
const agentSrc = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
check(
  "src/data/agent.ts AR_TYPE still maps 'أرض زراعية' -> 'Agriculture Plot'",
  /['"]أرض زراعية['"]\s*:\s*['"]Agriculture Plot['"]/.test(agentSrc),
);
check(
  "src/data/agent.ts AR_TYPE still maps 'مزرعة' -> 'Farm'",
  /['"]مزرعة['"]\s*:\s*['"]Farm['"]/.test(agentSrc),
);

// The real production LLM prompt (supabase/functions/agent/index.ts) must still list Agriculture
// Plot as a distinct COMMERCIAL_TYPES entry AND carry an explicit synonym line distinguishing it
// from Farm — otherwise the model silently defaults agricultural-land requests back to Farm.
const edgeFnSrc = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
check(
  "supabase/functions/agent/index.ts COMMERCIAL_TYPES still lists 'Agriculture Plot'",
  /COMMERCIAL_TYPES\s*=\s*\[[\s\S]{0,400}?"Agriculture Plot"/.test(edgeFnSrc),
);
check(
  'supabase/functions/agent/index.ts SYNONYMS still distinguish Agriculture Plot from Farm',
  /أرض زراعية[\s\S]{0,20}→\s*Agriculture Plot/.test(edgeFnSrc),
);

console.log(
  failed === 0
    ? '\n✓ all Farm/Agriculture Plot classification assertions passed'
    : `\n✗ ${failed} assertion(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
