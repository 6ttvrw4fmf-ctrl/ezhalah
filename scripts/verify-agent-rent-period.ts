// Regression guard for the AI Agent explicit-rental-period fix (senior audit run #3, 2026-08-03).
//
// The bug (intent INVERSION, live-proven): «شقق للإيجار الشهري في الرياض» produced query
// {deal:Rent, location:الرياض, type:Apartment} with NO rent-period signal — the agent OUTPUT
// contract had no rent_period field and queryFromBackend never set q.rentPeriod, so the
// emptyQuery() default ('annual') silently searched the ANNUAL pool: an explicitly-monthly request
// returned 0 of the 6,909 monthly Riyadh apartments while the reply promised monthly and the
// search panel showed «(سنوي)».
//
// The fix, three layers this guard pins:
//   1. edge contract: rent_period ∈ {"", "monthly", "annual"} in prompt OUTPUT + Gemini SCHEMA
//      (+ required), set ONLY on the user's explicit wording («الشهري»/«بالشهر»/«السنوي»/«بالسنة»).
//      Deploy lesson (v94 outage, 2026-08-03): Gemini's structured-output validator REJECTS an
//      empty string inside an enum — the unstated value must be "none", mirroring pricing_basis.
//   2. edge mapping: query.rentPeriod from out.rent_period, falling back to a monthly_rent/
//      annual_rent BUDGET basis (a stated budget period is an explicit period); Rent-only;
//      unstated stays undefined (client Filter-parity default).
//   3. client mapping: queryFromBackend maps b.rentPeriod → q.rentPeriod BEFORE applySourceFilter
//      (so the Gathern monthly-only override still wins), and the emptyQuery 'annual' default is
//      unchanged (agent ≡ filter parity for an unstated period).
//
//   node --experimental-strip-types scripts/verify-agent-rent-period.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const edge = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
const defaults = readFileSync(new URL('../src/lib/searchDefaults.ts', import.meta.url), 'utf8');

// ── 1. edge contract ──
// NOTE (clean slate, 2026-08-16): checks that asserted on the SYSTEM-PROMPT PROSE were deleted
// here, not weakened. The prose they pinned was deliberately removed with the whole instruction
// layer; pinning sentences is what made that layer only ever grow. The CODE checks below stand.
// [^{}]* (not a bare .*) so this can't accidentally reach past rent_period's own closing brace into
// an unrelated field — it still fails if the enum values or STRING type are wrong or missing, and
// tolerates extra schema keys (e.g. a `description`) in either order, before or after the enum.
check('SCHEMA declares rent_period with the closed enum (Gemini rejects an empty enum member — "none", never "")',
  /rent_period:\s*\{[^{}]*type:\s*"STRING"[^{}]*enum:\s*\["none"\s*,\s*"monthly"\s*,\s*"annual"\][^{}]*\}/.test(edge) ||
  /rent_period:\s*\{[^{}]*enum:\s*\["none"\s*,\s*"monthly"\s*,\s*"annual"\][^{}]*type:\s*"STRING"[^{}]*\}/.test(edge));
check('SCHEMA required includes rent_period',
  /required:\s*\[[^\]]*"rent_period"[^\]]*\]/.test(edge));

// ── 2. edge mapping ──
check('edge maps out.rent_period with monthly_rent/annual_rent budget-basis fallback',
  edge.includes('if (rp === "monthly" || rp === "annual") rentPeriod = rp;')
  && edge.includes('else if (basis === "monthly_rent") rentPeriod = "monthly";')
  && edge.includes('else if (basis === "annual_rent") rentPeriod = "annual";'));
check('edge clears rentPeriod for non-Rent deals',
  edge.includes('if (deal !== "Rent") rentPeriod = undefined;'));
check('edge returns rentPeriod inside query',
  /query:\s*\{\s*deal,\s*bothDeals,\s*priceIsAnnual,\s*rentPeriod,/.test(edge));
check('daily/weekly/quarterly budget bases do NOT remap the pool (conservative)',
  !edge.includes('basis === "daily_rent") rentPeriod') && !edge.includes('basis === "weekly_rent") rentPeriod'));

// ── 3. client mapping ──
check('BackendQuery declares rentPeriod', /rentPeriod\?:\s*string;/.test(client));
// 'both' joined the closed set on 2026-08-14 (owner feature: monthly AND annual in one search). The set
// stays CLOSED on purpose — the point of this check is that an arbitrary edge-supplied string can never
// reach q.rentPeriod, so any addition must be an explicit literal, exactly like these three.
check('queryFromBackend maps b.rentPeriod to q.rentPeriod (closed values only)',
  client.includes("if (b.rentPeriod === 'monthly' || b.rentPeriod === 'annual' || b.rentPeriod === 'both') q.rentPeriod = b.rentPeriod;"));
const mapIdx = client.indexOf("if (b.rentPeriod === 'monthly'");
const gathernIdx = client.indexOf('applySourceFilter(q, userText, b.platforms)');
check('mapping happens BEFORE applySourceFilter so the Gathern monthly-only override wins',
  mapIdx > -1 && gathernIdx > -1 && mapIdx < gathernIdx);
check("emptyQuery unstated-period default stays 'annual' (Filter parity — do not change without an owner ruling)",
  /rentPeriod:\s*'annual'/.test(defaults));

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nOK — agent explicit rental-period contract intact');
