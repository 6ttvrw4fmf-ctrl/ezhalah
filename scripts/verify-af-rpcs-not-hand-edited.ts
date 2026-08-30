// THE FOUR AF SHARED-ELIGIBILITY RPCs MAY NOT BE HAND-EDITED BY A MIGRATION.
//
// THE RULE (AGENTS.md hard safety rails, and docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md's own
// rails, verbatim): "never hand-edit the 4 AF shared-eligibility RPCs directly — go through the
// shared clause + rebuild_af_filter_rpcs()". One definition of eligibility is the entire point: the
// four surfaces are GENERATED from `af_rpc_templates` with `__AF_ELIGIBILITY_WHERE__` replaced by
// `af_eligibility_clause()`, so a count surface and the results surface cannot disagree about who is
// eligible. A `CREATE OR REPLACE FUNCTION` aimed straight at one of them breaks that guarantee by
// construction.
//
// UNTIL THIS FILE, THAT RULE WAS ENFORCED ONLY IN PRODUCTION, AFTER THE FACT. `mon_af_predicate_parity()`
// check B compares each live definition's md5 against `af_rpc_build_state` and raises P1
// `af_parity_hand_edit` — but it can only fire once the migration is already applied to production.
// Nothing in the repo looked at a migration before it landed: `grep -rl rebuild_af_filter_rpcs scripts/`
// returned NOTHING on 2026-08-30. A P0-class rail with no PR-time enforcement is a rail that gets
// crossed, and it was:
//
//   20260829172402_ranking_photo_preference_and_rotation_order_by.sql          (see the note below)
//   20260829172433_drop_old_location_search_candidates_ar_overload.sql
//   20260829172838_ranking_photo_preference_fold_into_diversity_partition_order.sql
//
// They redefine public.location_search_candidates_ar directly, and none mentions af_rpc_templates,
// rebuild_af_filter_rpcs or af_rpc_build_state. `af_parity_hand_edit` has been open since
// 2026-08-29 17:43 (live aac854f1f448 vs built f4336f1d8058), still affirmed 2026-08-30 10:43.
// That sequence also caused a real production incident inside 30 seconds on the day: 172402's
// CREATE OR REPLACE added a trailing parameter, which Postgres treats as a NEW OVERLOAD rather than
// a replacement, so every caller omitting it PGRST203-ed until 172433 dropped the old signature.
//
// NOTE ON 172402: its committed file is PROSE ONLY — the DDL it describes was applied to production
// but never mirrored into the repo, so this barrier cannot see it and correctly does not allowlist
// it. That half belongs to the migration-drift guard (AGENTS.md condition #5, "the mirror must match
// what production RAN"), not here. It is recorded in this comment so the next reader is not confused
// by a file that offends in production and looks innocent in git.
//
// WHY THIS IS NOT MERELY BOOKKEEPING — READ BEFORE "JUST RUNNING THE REBUILD". The obvious repair for
// that alert is to run `rebuild_af_filter_rpcs()`. TODAY THAT IS AN OUTAGE, not a repair:
//   · the template was never updated, so it still describes the PRE-2026-08-29 function — rebuilding
//     would silently REVERT the owner's PERMANENT controlled-rotation rule (2026-08-29, tier 4) and
//     the photo-preference ranking folded in beside it;
//   · worse, `p_rotation_seed text DEFAULT NULL::text` is in the LIVE signature and appears nowhere in
//     the migration that seeded the templates. `rebuild_af_filter_rpcs()` DROPS EVERY OVERLOAD FIRST
//     and re-creates from the template, so the parameter would DISAPPEAR — and PostgREST resolves
//     named-parameter RPC calls by EXACT parameter-name match. Every search the app sends carries
//     p_rotation_seed (observed on production 2026-08-30 on every journey), so every search would
//     return "function not found". That is the 2026-07-16 PGRST203 outage shape, re-armed.
// The repair is therefore: fold the ranking change INTO the template, THEN rebuild, and prove the
// rebuild is a no-op by checking the resulting md5 still equals the live one. It needs database
// write access this barrier does not have and must not be attempted blind.
//
// WHAT THIS ASSERTS:
//   §1  no migration at or after the template era touches one of the four RPCs without ALSO updating
//       af_rpc_templates and calling rebuild_af_filter_rpcs() in the same migration;
//   §2  the known-divergence allowlist is EXACTLY the two files above — it cannot quietly grow, and
//       an entry cannot be added without a deliberate, reviewed edit to this file;
//   §3  every allowlisted file still exists and still actually offends (so the allowlist cannot rot
//       into permanent cover for a file that was since fixed or deleted);
//   §4  the protected set is still exactly the four RPCs the rail names.
//
//   node --experimental-strip-types scripts/verify-af-rpcs-not-hand-edited.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const MIGRATIONS_DIR = 'supabase/migrations';

// The four surfaces generated from af_rpc_templates. af_eligible_count is the REFEREE — the
// independent third opinion mon_af_predicate_parity check D compares results and counts against —
// which is exactly why it is protected too: a hand-edited referee agrees with everything.
const PROTECTED = [
  'location_search_candidates_ar',
  'apartment_guided_counts_ar',
  'property_age_option_counts_ar',
  'af_eligible_count',
] as const;

// The template machinery landed 2026-08-11 (parts A/B/C: clause+tables, templates-from-live-defs,
// builder+first build). Migrations BEFORE it defined these functions by hand because there was no
// other way — that is history, not drift. The 2026-08-15 `af_rpc_replay_checkpoint*` migrations are
// the deliberate reconciliation era that followed, and are also below the baseline.
const TEMPLATE_ERA_BASELINE = '20260816000000';

// KNOWN DIVERGENCES — dated, reasoned, and finite. Each entry is a migration that DID hand-edit and
// is already live; listing it keeps CI honest about the tree's real state instead of pretending the
// rule was never broken, and keeps `npm test` from going red on every unrelated PR for a defect no
// PR can fix (the repair needs database write access — see the header).
//
// TO REMOVE AN ENTRY: fold its change into af_rpc_templates, run rebuild_af_filter_rpcs(), confirm
// the rebuilt md5 equals the live one and that af_parity_hand_edit has resolved — then delete the
// line. Never delete a line to make this file green.
const KNOWN_DIVERGENCES: Record<string, string> = {
  '20260829172433_drop_old_location_search_candidates_ar_overload.sql':
    'live 2026-08-29; emergency DROP of the stale 41-arg overload after the previous migration\'s CREATE OR REPLACE with a new trailing parameter created a SECOND overload and PGRST203-ed every live caller. Correct as an incident fix, still outside the template path.',
  '20260829172838_ranking_photo_preference_fold_into_diversity_partition_order.sql':
    'live 2026-08-29; CREATE OR REPLACE folding photo-preference + rotation into the diversity partition ORDER BY. This is the definition production runs today, and the one af_rpc_templates does not know about. OPEN as alert af_parity_hand_edit (P1) since 2026-08-29 17:43.',
};

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check('§0 migrations directory is readable and non-empty', files.length > 0);

const REPLACE_RE = (fn: string) =>
  new RegExp(String.raw`\b(?:create\s+or\s+replace\s+function|drop\s+function(?:\s+if\s+exists)?)\s+(?:public\.)?${fn}\b`, 'i');

type Offence = { file: string; fns: string[]; hasTemplate: boolean; hasRebuild: boolean };
const offences: Offence[] = [];

for (const file of files) {
  const version = file.slice(0, 14);
  if (version < TEMPLATE_ERA_BASELINE) continue;
  const src = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
  const fns = PROTECTED.filter((fn) => REPLACE_RE(fn).test(src));
  if (!fns.length) continue;
  const hasTemplate = /\baf_rpc_templates\b/i.test(src);
  const hasRebuild = /\brebuild_af_filter_rpcs\b/i.test(src);
  if (hasTemplate && hasRebuild) continue;      // the sanctioned path — allowed
  offences.push({ file, fns: [...fns], hasTemplate, hasRebuild });
}

// ── §1 — no NEW hand edit ───────────────────────────────────────────────────────────────────────
{
  const fresh = offences.filter((o) => !(o.file in KNOWN_DIVERGENCES));
  check('§1 no migration hand-edits an AF shared-eligibility RPC (template + rebuild required)',
    fresh.length === 0,
    fresh.map((o) => `${o.file} redefines [${o.fns.join(', ')}] without ${[
      o.hasTemplate ? null : 'af_rpc_templates', o.hasRebuild ? null : 'rebuild_af_filter_rpcs()',
    ].filter(Boolean).join(' and ')}. Update the template and rebuild — never edit the RPC directly.`).join('\n        '));
}

// ── §2 — the allowlist is exactly what this file says it is ─────────────────────────────────────
{
  const expected = Object.keys(KNOWN_DIVERGENCES).sort();
  check('§2 the known-divergence allowlist holds exactly the 2 reviewed entries',
    expected.length === 2, `allowlist has ${expected.length} entr(ies) — growing it is a deliberate, reviewed act`);
  check('§2 every allowlist entry carries a stated reason',
    expected.every((k) => (KNOWN_DIVERGENCES[k] ?? '').trim().length > 20),
    'an entry with no reason is cover, not a record');
}

// ── §3 — the allowlist cannot rot ───────────────────────────────────────────────────────────────
{
  const stale = Object.keys(KNOWN_DIVERGENCES).filter((k) => !offences.some((o) => o.file === k));
  check('§3 every allowlisted migration still exists and still offends (no stale cover)',
    stale.length === 0,
    `${stale.join(', ')} no longer hand-edits an AF RPC (or is gone) — delete the allowlist entr(ies)`);
}

// ── §4 — the protected set still matches the rail ───────────────────────────────────────────────
{
  check('§4 exactly four AF shared-eligibility RPCs are protected',
    PROTECTED.length === 4 && new Set(PROTECTED).size === 4,
    `PROTECTED = [${PROTECTED.join(', ')}] — the rail says four; shrinking it silently unprotects a surface`);
  check('§4 the results RPC and the referee are both protected',
    PROTECTED.includes('location_search_candidates_ar') && PROTECTED.includes('af_eligible_count'));
}

if (offences.length) {
  console.log(`\n      STANDING DIVERGENCE — ${offences.length} migration(s) currently outside the template path:`);
  for (const o of offences) console.log(`        · ${o.file} → [${o.fns.join(', ')}]`);
  console.log('      Do NOT "repair" this by running rebuild_af_filter_rpcs(): the template predates');
  console.log('      p_rotation_seed, and the rebuild DROPS every overload first — it would revert the');
  console.log('      owner\'s 2026-08-29 rotation rule AND 404 every search. Fold the change into');
  console.log('      af_rpc_templates first, then rebuild, then prove the md5 did not move.\n');
}

console.log(failed === 0
  ? '✓ the four AF shared-eligibility RPCs are generated, not hand-edited (known divergences recorded)'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
