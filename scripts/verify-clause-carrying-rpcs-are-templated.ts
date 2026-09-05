// EVERY SURFACE THAT INLINES THE ELIGIBILITY CLAUSE MUST BE OWNED BY THE REBUILD.
//
// WHY THIS EXISTS (ops_incident #59 — the CLASS behind #31). af_eligibility_clause() is the one
// canonical definition of "which rows are eligible". Four RPCs were rendered from it by
// rebuild_af_filter_rpcs(); two more — top_cities_by_deal_ar and district_options_ar — inlined the
// same clause but were maintained BY HAND, as needle-edits over pg_get_functiondef of the live
// function. Nothing forced the result to still BE the canonical clause, and twice in twenty-four
// hours it was not:
//
//   2026-09-04  a rewire to price_total_effective reached four surfaces and left top_cities behind
//               (جدة chip 10,835 against a click-through of 10,925)
//   2026-09-05  top_cities' purity gate was RETYPED rather than substituted — broad Commercial
//               under-counted by ~92% (الرياض 269 against a click-through of 3,361)
//
// Migration 20260905183033 templated both, so the rebuild owns all six. This barrier exists so the
// SEVENTH cannot arrive unnoticed.
//
// IT DISCOVERS, IT DOES NOT CARRY A LIST. ops_af_clause_surfaces() asks the database which public
// functions contain the clause VERBATIM and whether af_rpc_templates covers each one. A surface
// added tomorrow is therefore RED the moment it exists — nobody has to remember to register it.
// That is the same shape as the MATCH-FIRST stage barrier, and the opposite of the shape this repo
// keeps getting burned by: a hand-maintained roster that silently stops covering the thing it names.
//
// AND IT READS THE INVARIANT FROM OUTSIDE THE DETECTOR THAT ENFORCES IT.
// mon_detect_af_clause_surface_untemplated() runs twice an hour and is the continuous guard, but a
// detector can only be verified by reading its own body — which is exactly how nine dark detectors
// once read as a clean bill of health (AGENTS.md, 2026-08-10). This executes the same predicate
// through the anon path the app itself uses, so the detector going dark is visible from outside.
//
// FAILS CLOSED. An unreachable or unreadable RPC is a FAILURE, never a pass: "I could not check"
// must never render as "there is nothing wrong" (the SOURCE-IS-TRUTH rule, applied to this harness).
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
  if (!ok) failed++;
};

export type Surface = { fn_name: string; templated: boolean; exempt: boolean; exempt_reason: string | null };

/**
 * THE INVARIANT, as a pure predicate. A surface is acceptable when the rebuild renders it, or when
 * someone deliberately exempted it AND said why. An exemption with no reason is not an exemption —
 * it is an unexplained hole, and this is the shape that lets a "temporary" waiver become permanent.
 */
export const surfaceIsGoverned = (s: Surface): boolean =>
  s.templated || (s.exempt && typeof s.exempt_reason === 'string' && s.exempt_reason.trim().length >= 20);

console.log('\nEvery function that inlines af_eligibility_clause() is rendered by the rebuild\n');

let rows: Surface[];
try {
  const r = await fetch(`${BASE}/rest/v1/rpc/ops_af_clause_surfaces`, { method: 'POST', headers: H, body: '{}' });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  rows = (await r.json()) as Surface[];
  if (!Array.isArray(rows)) throw new Error('did not return an array');
} catch (e) {
  console.error(`\n✗ ops_af_clause_surfaces() is unreadable — ${(e as Error).message}`);
  console.error('  This check FAILS CLOSED: an unverifiable invariant is not a satisfied one. If the');
  console.error('  RPC was renamed or its grant removed, that is itself the defect — the barrier and');
  console.error('  the detector both read it, so losing it blinds them together.');
  process.exit(1);
}

// The clause has to be inlined SOMEWHERE, or the discovery predicate has silently stopped matching
// (a reformatted clause, a renamed function) and every check below would pass vacuously.
check('the discovery actually found the clause-carrying surfaces', rows.length >= 4,
  `only ${rows.length} surface(s) matched — af_eligibility_clause() is inlined in at least the four ` +
  `af_rpc_templates RPCs, so a smaller number means the predicate stopped matching, not that the ` +
  `surfaces went away. A vacuously green run is the failure mode this line exists for.`);

for (const s of rows) {
  check(`${s.fn_name}: ${s.templated ? 'rendered by rebuild_af_filter_rpcs()' : s.exempt ? 'exempt, with a stated reason' : 'GOVERNED'}`,
    surfaceIsGoverned(s),
    s.exempt
      ? `${s.fn_name} is exempt but its reason is missing or too short to be one — ` +
        `ops_af_clause_surface_exempt.reason must say why this surface may stay hand-maintained.`
      : `${s.fn_name} inlines af_eligibility_clause() but af_rpc_templates does not cover it, so it is ` +
        `maintained by hand and can drift from the one canonical definition of eligibility — the exact ` +
        `shape that produced two incidents in 24h on 2026-09-04/05. Add it to af_rpc_templates with the ` +
        `clause replaced by __AF_ELIGIBILITY_WHERE__, DERIVED from pg_get_functiondef and proven to ` +
        `round-trip byte-identically, then run rebuild_af_filter_rpcs() and assert the md5 did not move.`);
}

const templated = rows.filter((s) => s.templated).length;
console.log(`\n  ${rows.length} clause-carrying surface(s) · ${templated} rendered by the rebuild · ` +
  `${rows.filter((s) => s.exempt).length} exempt`);

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// The predicate is fed the real shapes it exists to reject. Without these, a predicate that simply
// returned true would pass every check above and this file would be decoration.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

console.log('\nMutation proofs\n');

mustCatch('an untemplated surface — top_cities_by_deal_ar as it stood before 20260905183033',
  !surfaceIsGoverned({ fn_name: 'top_cities_by_deal_ar', templated: false, exempt: false, exempt_reason: null }));
mustCatch('an exemption with NO reason (an unexplained hole wearing a waiver)',
  !surfaceIsGoverned({ fn_name: 'x', templated: false, exempt: true, exempt_reason: null }));
mustCatch('an exemption whose reason is too short to be one',
  !surfaceIsGoverned({ fn_name: 'x', templated: false, exempt: true, exempt_reason: 'later' }));
mustCatch('…while a templated surface is NOT reported as a defect (the predicate is not vacuously red)',
  surfaceIsGoverned({ fn_name: 'location_search_candidates_ar', templated: true, exempt: false, exempt_reason: null }));
mustCatch('…and a genuine, stated exemption is accepted',
  surfaceIsGoverned({ fn_name: 'x', templated: false, exempt: true,
    exempt_reason: 'hand-maintained on purpose because it predates the template mechanism entirely' }));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ every surface that inlines the eligibility clause is rendered by rebuild_af_filter_rpcs()'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
