// NATIONWIDE / كل المملكة IS NOT A SUPPORTED SEARCH SCOPE (owner, 2026-09-04).
//
// The product requires a city. The Filter has always enforced that — pressing «بحث» with an empty
// city shows «الرجاء اختيار مدينة من القائمة» and opens the city picker. The AGENT never caught up:
// a 2026-06-24 location backstop treated a Kingdom-wide phrase as an explicit scope and SKIPPED the
// city question entirely. Reproduced against production on 2026-09-04, before this barrier existed:
//
//   user: «ابغى شقة للبيع في كل مدن المملكة»
//   → RPC  p_cities: null, p_districts: null, p_region_ids: null
//   → 39,042 listings from every city in the Kingdom
//   → summary printed «المدينة: المملكة العربية السعودية»
//
// So a removed product scope was still live, still advertised in the agent's own city question, and
// nothing in the tree would have noticed. This file is what notices.
//
// SCOPE OF THIS CHECK. It guards the CLIENT SEARCH PATH. isCountryWideQuery() in regions.ts is left
// alone on purpose: it is a CLASSIFIER used for diversity ordering and for the unlocated-rows
// fallback, and deleting a classifier is not the same as closing a user path. What must never exist
// is a user journey that reaches the results RPC with no city, no district and no region.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

const agent = stripComments(read('src/app/agent.tsx'));
const i18n = read('src/i18n.tsx');

// ── 1. THE AGENT MUST NOT ADVERTISE A SCOPE THE PRODUCT DOES NOT HAVE ─────────────────────────
{
  check(!/كل مدن المملكة/.test(agent),
    'the agent never invites the user to search «كل مدن المملكة»',
    'that invitation was printed inside the city question itself');
  check(!/وإذا تبي كل المملكة/.test(agent),
    'the Kingdom-wide offer is gone from the city question');
  // The plain city ask must still exist — closing the scope must not remove the question that
  // replaces it, or a user with no city gets nothing at all.
  check(/'في أي مدينة تبحث؟'/.test(agent),
    'the plain city question still exists (it is what a Kingdom-wide request now falls through to)');
}

// ── 2. NO KINGDOM-WIDE SHORT-CIRCUIT AROUND THE CITY QUESTION ─────────────────────────────────
{
  check(!/KINGDOM_WIDE/.test(agent),
    'no live KINGDOM_WIDE matcher remains in the agent screen',
    'a dead regex kept "just in case" is how a removed scope gets re-wired');
  // The whole-CITY / whole-REGION affordance is DIFFERENT and must survive: «الرياض كاملة» is a
  // supported scope. If this disappears, the fix went too far.
  // Assert the CALL, not the symbol: `WHOLE_AREA` also appears in its own definition, so a mutation
  // that guts the guard (`if (false) return null;`) left a symbol-only check green.
  check(/if \(WHOLE_AREA\.test\(userText\)\) return null;/.test(agent),
    'the whole-city / whole-region affordance («الرياض كاملة») still SHORT-CIRCUITS — it IS supported',
    'closing the Kingdom scope must not also remove the whole-city scope');
}

// ── 3. THE FILTER'S CITY REQUIREMENT IS STILL THE PRODUCT RULE ────────────────────────────────
{
  check(/CITY_REQUIRED_MSG/.test(i18n) && /الرجاء اختيار مدينة/.test(i18n),
    'the Filter still refuses a search with no city («الرجاء اختيار مدينة من القائمة»)');
}

// ── 4. NO NEW NATIONWIDE ENTRY POINT ELSEWHERE IN THE CLIENT SEARCH PATH ──────────────────────
// A future "search everywhere" affordance would most likely appear as one of these strings in a
// user-facing surface. Grep the screens, not the whole tree: regions.ts legitimately NAMES the
// country for classification, and locations.ts still carries the country place for parsing.
{
  const surfaces = ['src/app/agent.tsx', 'src/components/Sidebar.tsx'];
  for (const f of surfaces) {
    let body: string;
    try { body = stripComments(read(f)); } catch { continue; }
    for (const phrase of ['كل المملكة', 'كل مدن المملكة', 'كل المدن', 'search everywhere', 'nationwide']) {
      check(!body.includes(phrase), `${f} offers no «${phrase}» scope`);
    }
  }
}

console.log(failed === 0
  ? '\n✅ verify-no-nationwide-search-scope: all checks passed.'
  : `\n❌ verify-no-nationwide-search-scope: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
