// A SEARCH REQUIRES A REAL PLACE — NATIONWIDE IS NOT A SCOPE (owner, 2026-09-04).
//
// The Normal Filter has always refused a search with no city («الرجاء اختيار مدينة من القائمة»).
// The agent had no such rule. PR #1711 removed the client-side affordance and the advertisement,
// and production STILL searched the whole Kingdom, because the client deliberately does not
// re-litigate the server's decision ("THE SERVER IS THE SINGLE DECISION AUTHORITY", 2026-08-30) —
// so the rule has to live in decideAgentTurn(), the one function allowed to assign a `kind`.
//
// Reproduced on production 2026-09-04 AFTER #1711 had shipped:
//   «ابغى شقة للبيع في كل مدن المملكة» → p_cities/p_districts/p_region_ids all null → 39,055 rows,
//   summary «المدينة: المملكة العربية السعودية».
// hasEnoughToSearch() was satisfied by the TYPE alone, so the ladder searched, and the country-level
// location made that search unscoped.
//
// This barrier EXECUTES the real ladder — never a copy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideAgentTurn, hasUsableLocation, QUESTION_BUDGET_CEILING } from '../supabase/functions/agent/decide.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const decide = (state: Record<string, unknown>, askCount = 0, locationAmbiguous = false) =>
  decideAgentTurn({ rawText: 'شقة', locationAmbiguous, establishedState: state as never, askCount }).kind;

// ── 1. THE COUNTRY IS NOT A PLACE ─────────────────────────────────────────────────────────────
{
  for (const loc of [
    'المملكة العربية السعودية', 'المملكة', 'السعودية', 'السعوديه', 'كل المملكة', 'كل مدن المملكة',
    'في كل مدن المملكة', 'جميع مدن السعودية', 'Saudi Arabia', 'saudi', 'KSA', 'the Kingdom', '', '   ',
    // «سعودية» without the definite article is caught ONLY by the exact-alias branch — the loose
    // Kingdom test looks for «السعودي». Without this case that branch is untested and a mutation
    // deleting it survives (it did, on the first run of this barrier).
    'سعودية',
  ]) {
    check(!hasUsableLocation({ location: loc } as never), `«${loc || '(empty)'}» is NOT a usable location`);
  }
  // Real places must stay usable — a fix that also blocks these has gone too far.
  for (const loc of ['الرياض', 'جدة', 'حي الملقا', 'منطقة الرياض', 'المدينة المنورة', 'الخبر', 'أبها']) {
    check(hasUsableLocation({ location: loc } as never), `«${loc}» IS a usable location`);
  }
}

// ── 2. THE LADDER NEVER RETURNS `listings` WITHOUT A PLACE ────────────────────────────────────
{
  // Any single signal used to be enough on its own — that is exactly how the nationwide search
  // survived, since a bare type satisfies hasEnoughToSearch().
  for (const [label, st] of [
    ['type only', { type: 'Villa' }],
    ['price only', { price: '500000' }],
    ['detail only', { detail: '3' }],
    ['amenities only', { amenities: ['parking'] }],
    ['af only', { af: { bathrooms: 2 } }],
    ['type + the COUNTRY as location', { type: 'Apartment', location: 'المملكة العربية السعودية' }],
    ['type + «كل مدن المملكة»', { type: 'Apartment', location: 'كل مدن المملكة' }],
    ['nothing at all', {}],
  ] as const) {
    check(decide(st as never) === 'message', `${label} → message, never a nationwide search`);
  }
  // …and the budget ceiling must not manufacture one either. This is the half that actually bit:
  // step 3 used to read "search anyway, broad/nationwide if that's nothing at all".
  for (const askCount of [QUESTION_BUDGET_CEILING, QUESTION_BUDGET_CEILING + 3, 50]) {
    check(decide({ type: 'Apartment' }, askCount) === 'message',
      `askCount=${askCount} with no place → still asks, never searches the Kingdom`);
  }
}

// ── 3. SUPPORTED SCOPES STILL SEARCH NORMALLY ────────────────────────────────────────────────
// The whole risk of this rule is over-blocking. Every supported scope must be unaffected.
{
  for (const [label, st] of [
    ['city', { location: 'الرياض' }],
    ['city + type', { location: 'جدة', type: 'Apartment' }],
    ['district', { location: 'حي الملقا' }],
    ['region', { location: 'منطقة الرياض' }],
    ['city + price', { location: 'الدمام', price: '500000' }],
  ] as const) {
    check(decide(st as never) === 'listings', `${label} → listings (supported scope, unaffected)`);
  }
  check(decide({ location: 'الرياض' }, QUESTION_BUDGET_CEILING) === 'listings',
    'a real place at the budget ceiling still searches — optional fields never block');
}

// ── 4. AN AMBIGUOUS PLACE IS A NAMED PLACE ───────────────────────────────────────────────────
// «الهفوف» exists in two regions. The user DID name somewhere; the 2026-08-30 round-2 fix converges
// that on a search once the budget is spent instead of asking forever. This rule must not silently
// reintroduce that unbounded loop — the search it converges on is scoped to the term, not nationwide.
{
  check(decide({}, 0, true) === 'message', 'ambiguous place under the ceiling → still asks');
  for (const askCount of [QUESTION_BUDGET_CEILING, 50]) {
    check(decide({}, askCount, true) === 'listings',
      `ambiguous place at askCount=${askCount} → converges to listings (no unbounded loop)`);
  }
}

// ── 5. THE COUNTRY VOCABULARY IS A DOCUMENTED MIRROR, NOT A SILENT COPY ──────────────────────
{
  const decideSrc = readFileSync(join(root, 'supabase/functions/agent/decide.ts'), 'utf8');
  check(/LITERAL MIRROR of COUNTRY_ALIASES/.test(decideSrc),
    'the country vocabulary says it mirrors src/data/regions.ts (edge cannot import it)');
  const regions = readFileSync(join(root, 'src/data/regions.ts'), 'utf8');
  for (const alias of ['المملكة', 'السعودية', 'ksa']) {
    check(regions.includes(alias), `«${alias}» still exists in regions.ts's own alias set`,
      'if regions.ts drops it, the edge mirror is stale');
  }
}

// ── 6. THE REFUSAL ASKS FOR THE CITY — it never just goes quiet ──────────────────────────────
// Closing the search without asking anything is its own defect: verified live 2026-09-05, the
// ladder correctly issued ZERO searches but the reply still read «أبشر، بدور لك على شقق للبيع في
// كل مدن المملكة» — a promise to search the Kingdom, followed by nothing.
{
  const idx = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
  check(/const noPlaceReply\s*=/.test(idx),
    'index.ts builds a deterministic reply when the turn was refused for having no place');
  check(/hasUsableLocation\(wired\.establishedState\)/.test(idx),
    'that reply is gated on the SAME hasUsableLocation() the ladder used — not a second rule');
  check(/في أي مدينة تبحث؟/.test(idx),
    'the refusal asks the city question in Arabic');
  check(/ambiguityReply \?\? noPlaceReply \?\?/.test(idx),
    'a loc_classify ambiguity still wins — its question is more specific than the generic city ask');
  check(/!ambiguityReply && !hasUsableLocation/.test(idx),
    'the no-place question never overrides an ambiguity question');
}

console.log(failed === 0
  ? '\n✅ verify-search-requires-a-real-place: all checks passed.'
  : `\n❌ verify-search-requires-a-real-place: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
