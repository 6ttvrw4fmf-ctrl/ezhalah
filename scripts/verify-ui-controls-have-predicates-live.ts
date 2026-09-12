// LIVE HALF — the shipped UI judged against the LIVE af_field_registry.
//
// Split out of scripts/verify-ui-controls-have-predicates.ts on 2026-09-12 (routine #10,
// ops_incident #126). That file remains in the REQUIRED `npm test` and keeps every assertion that
// reads only committed source; this half asks production, so it must NOT be in the required suite —
// `npm test` gates every PR and its verdict must depend only on the diff.
//
// NO per-PR coverage was LOST by the split. The predicate applied here — registryProblems() in
// scripts/lib/uiControlPredicates.ts — is the SAME function the offline half mutation-proves on every
// PR, against every disagreement shape it can produce. What moved is only the READ of production.
//
// WHY THIS HALF MUST EXIST AT ALL: the registry is the contract, and reading it live is deliberate —
// "rather than a copy here, so the check can never drift from the contract it is enforcing". A source
// check alone would stay green if a field were flipped to ui_exposed=false in production while its
// chip kept rendering.
//
// It FAILS CLOSED. An unreachable registry, a PostgREST error object, or an empty result are all
// failures, never skips: AGENTS.md, A FAILED FETCH IS NOT AN EMPTY ANSWER. That judgement lives in
// registryProblems() so it is mutation-proven per-PR rather than written out again here.
//
//   node --experimental-strip-types scripts/verify-ui-controls-have-predicates-live.ts
//   (homed in .github/workflows/af-live-truth-check.yml — see scripts/test-exclusions.txt)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { amenityChipKeys, registryPayload, registryProblems } from './lib/uiControlPredicates.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const ROOT = join(import.meta.dirname, '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe shipped filter UI, judged against the LIVE af_field_registry\n');

// `||`, NOT `??` — an UNSET GitHub Actions secret expands to the EMPTY STRING, not to undefined, so
// `??` would honour '' as the endpoint and this check would probe nothing while looking configured.
// scripts/lib/public-supabase.ts resolves the same value with `||` for exactly this reason.
const REG_URL = process.env.EZHALAH_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const regKey = resolvePublicSupabase(process.env).key;

const chipKeys = amenityChipKeys(readFileSync(join(ROOT, 'src/data/advancedFilters.ts'), 'utf8'));
// A parse miss would hand registryProblems() an EMPTY chip list, against which the leak and
// undescribed-chip rules are both vacuously satisfied. Refuse that before asking production.
check(`the amenity chip keys parsed out of advancedFilters.ts (${chipKeys.length})`, chipKeys.length >= 6,
  `found ${chipKeys.length}: ${chipKeys.join(', ')} — a parse miss makes every registry rule below `
  + 'vacuous, so it is a failure here rather than a silent pass');

// ── MUTATION PROOF — the response→data judgement, before it is used on anything real ────────────
// Same shape and same reason as the sibling split live halves (verify-guided-counts-carry-monthly-af-
// live.ts, verify-af-attribute-views-cover-every-platform-live.ts): the rule that decides whether a
// response counts as an answer is proven here, against responses that are NOT answers, including the
// dangerous case where the failing response's body still parses as a plausible registry.
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${what}`); return; }
  failures++;
  console.error(`FAIL  (mutation) did NOT catch ${what}`);
};
// A body that would be perfectly healthy at 200. If status is ignored, every proof below goes green.
const PLAUSIBLE = [{ canonical_key: 'parking', ui_exposed: true, not_exposed_reason: null, filter_tier: 'advanced' }];

mustCatch('HTTP 500 (statement timeout) treated as usable registry data',
  registryProblems(registryPayload(500, PLAUSIBLE), chipKeys).length > 0);
mustCatch('HTTP 401 (a rotated anon key) treated as usable registry data',
  registryProblems(registryPayload(401, PLAUSIBLE), chipKeys).length > 0);
mustCatch('HTTP 404 (the table or view has not shipped) treated as "no hidden fields"',
  registryProblems(registryPayload(404, []), chipKeys).length > 0);
mustCatch('...and a 200 body is still passed THROUGH unchanged (a rule red for everything guards nothing)',
  registryPayload(200, PLAUSIBLE) === PLAUSIBLE);

let registry: unknown;
try {
  const res = await fetch(
    `${REG_URL}/rest/v1/af_field_registry?select=canonical_key,ui_exposed,not_exposed_reason,filter_tier`,
    { headers: { apikey: regKey, Authorization: `Bearer ${regKey}` } },
  );
  // A non-200 is NOT data. Read the body for the message, but never let it stand in for the registry.
  registry = registryPayload(res.status, res.ok
    ? await res.json().catch((e: unknown) => ({ unparseableBody: String(e) }))
    : await res.text().catch(() => '<unreadable>'));
} catch (e) {
  // An unreachable endpoint is an UNANSWERED question. Hand registryProblems() the failure rather
  // than an empty array, so the verdict comes from the one shared, mutation-proven decision.
  registry = { fetchFailed: String(e) };
}

const problems = chipKeys.length >= 6
  ? registryProblems(registry, chipKeys)
  : ['chip keys did not parse — the registry rules were not evaluated (see the failure above)'];

check('the live af_field_registry agrees with the shipped UI', problems.length === 0,
  problems.join('\n      '));

console.log(failures === 0
  ? '\n✓ every chip the app renders is described by the live registry, and no backend-only field leaked\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
