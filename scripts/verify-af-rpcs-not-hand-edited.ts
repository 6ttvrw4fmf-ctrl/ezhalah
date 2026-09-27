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
// WHY THIS WAS NOT MERELY BOOKKEEPING — the state this file was born into, kept because the lesson
// is the reusable part. Between 2026-08-29 17:43 and 2026-08-30 13:43, the obvious repair for that
// alert — running `rebuild_af_filter_rpcs()` — was an OUTAGE, not a repair:
//   · the template was never updated, so it still described the PRE-2026-08-29 function; rebuilding
//     would silently have REVERTED the owner's PERMANENT controlled-rotation rule (2026-08-29,
//     tier 4) and the photo-preference ranking folded in beside it;
//   · worse, `p_rotation_seed text DEFAULT NULL::text` was in the LIVE signature and appeared nowhere
//     in the migration that seeded the templates. `rebuild_af_filter_rpcs()` DROPS EVERY OVERLOAD
//     FIRST and re-creates from the template, so the parameter would have DISAPPEARED — and PostgREST
//     resolves named-parameter RPC calls by EXACT parameter-name match. Every search the app sends
//     carries p_rotation_seed, so every search would have returned "function not found": the
//     2026-07-16 PGRST203 outage shape, re-armed.
//
// REPAIRED 2026-08-30 by 20260830134244_af_template_absorbs_2026_08_29_ranking_so_rebuild_is_a_noop.
// The template is now the live definition with the single af_eligibility_clause() occurrence swapped
// back out for the placeholder, so `replace(template, placeholder, clause)` equals
// pg_get_functiondef() BYTE FOR BYTE (md5 aac854f1f4483863b142cb6cda9c1ae5 both sides) — the rebuild
// it then performed was a provable no-op on all four RPCs, and af_parity_hand_edit resolved at
// 13:43:00 because the condition genuinely cleared, not by hand.
//
// THE REUSABLE RULE, which is why this paragraph stays: before running a rebuild, never assume the
// template matches live. Check. Fold any direct edit into the template FIRST, prove the round trip
// is byte-exact, and only then rebuild — asserting inside the same transaction that every md5 is
// unchanged, so a wrong port rolls back instead of shipping.
//
// WHAT THIS ASSERTS:
//   §1  no migration at or after the template era touches one of the four RPCs without ALSO updating
//       af_rpc_templates and calling rebuild_af_filter_rpcs() in the same migration;
//   §2  the known-divergence allowlist is EXACTLY the two files above — it cannot quietly grow, and
//       an entry cannot be added without a deliberate, reviewed edit to this file;
//   §3  every allowlisted file still exists and still actually offends (so the allowlist cannot rot
//       into permanent cover for a file that was since fixed or deleted);
//   §4  the protected set is still exactly the six RPCs the rail names;
//   §5  a divergence claiming to be RECONCILED names a migration that really exists in this repo AND
//       that itself went through the template path — so "this was repaired" is checkable, not a
//       comment anyone can write.
//
//   node --experimental-strip-types scripts/verify-af-rpcs-not-hand-edited.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const MIGRATIONS_DIR = 'supabase/migrations';

// The surfaces generated from af_rpc_templates. af_eligible_count is the REFEREE — the
// independent third opinion mon_af_predicate_parity check D compares results and counts against —
// which is exactly why it is protected too: a hand-edited referee agrees with everything.
// THIS LIST SAID FOUR UNTIL 2026-09-27, AND THE RAIL HAD HELD SIX SINCE 2026-09-05.
// 20260905183033 brought district_options_ar and top_cities_by_deal_ar under rebuild_af_filter_rpcs()
// — af_rpc_templates and af_rpc_build_state have carried six rows ever since. This file kept
// protecting four, and §4 below ASSERTED the number was four, so the omission read as a verified
// fact rather than a gap. The two unprotected surfaces are Trending Cities and Trending Districts:
// exactly the two that were hand-edited on 2026-09-26 and left three P1s standing (af_parity_empirical,
// af_rebuild_would_revert, af_count_surfaces_carry_af). This check was green throughout.
const PROTECTED = [
  'location_search_candidates_ar',
  'apartment_guided_counts_ar',
  'property_age_option_counts_ar',
  'af_eligible_count',
  'district_options_ar',
  'top_cities_by_deal_ar',
] as const;

// The template machinery landed 2026-08-11 (parts A/B/C: clause+tables, templates-from-live-defs,
// builder+first build). Migrations BEFORE it defined these functions by hand because there was no
// other way — that is history, not drift. The 2026-08-15 `af_rpc_replay_checkpoint*` migrations are
// the deliberate reconciliation era that followed, and are also below the baseline.
const TEMPLATE_ERA_BASELINE = '20260816000000';

// KNOWN DIVERGENCES — dated, reasoned, finite, and each pointing at the migration that RECONCILED
// it. Every entry is a migration that DID hand-edit one of the four and is already live. A hand edit
// is a permanent fact about history: the file will offend forever, because the remediation lands in
// a LATER migration, not by editing the old one. So an entry is a RECORD, not a to-do item.
//
// DO NOT DELETE AN ENTRY once its migration exists — §1 would go red, because the file still
// hand-edits and always will. What changes when a divergence is repaired is the `reconciledBy`
// field, which §5 then forces to name a migration that actually exists in this repo. That is what
// makes "this was fixed" a checkable claim rather than a comment.
//
// DO NOT raise TEMPLATE_ERA_BASELINE to make an entry disappear. That hides divergence rather than
// recording it, and the mutation suite explicitly proves it turns this file red.
type Divergence = { why: string; reconciledBy: string | null };
const KNOWN_DIVERGENCES: Record<string, Divergence> = {
  // ── The four 2026-09-26 performance edits on the two Trending count surfaces ────────────────
  // All four are output-preserving and all four STAY. What none of them did was update the
  // generator, which is why af_parity_empirical / af_rebuild_would_revert / af_count_surfaces_carry_af
  // stood P1 open until 20260927111536. Each is a needle edit, invisible to REPLACE_RE.
  '20260926184944_district_options_ar_uses_stored_district_norm_tok.sql': {
    why: 'live 2026-09-26; needle edit making the "live" CTE group on the STORED district_norm_tok '
      + 'column instead of recomputing norm_district_tok(district_ar) per row — 577ms to 72ms on the '
      + 'Riyadh 54,924-row cohort, ~88% of this RPC\'s latency. Output-preserving; outside the template path.',
    reconciledBy: '20260927111536_af_rail_catches_up_to_shipped_perf_edits.sql',
  },
  '20260926185002_top_cities_by_deal_ar_materializes_cohort.sql': {
    why: 'live 2026-09-26; needle edit adding the MATERIALIZED keyword to the cohort CTE so the 30+ '
      + 'predicate filter is evaluated once rather than per reference — 406ms to 299ms, identical '
      + '172,981-row result. No column changed, so the column-granular rebuild guard was blind to it.',
    reconciledBy: '20260927111536_af_rail_catches_up_to_shipped_perf_edits.sql',
  },
  '20260926222522_top_cities_by_deal_ar_stats_friendly_predicate.sql': {
    why: 'live 2026-09-26; needle edit rewriting coalesce(col,0) >= 0 to col IS NULL OR col >= 0 so '
      + 'Postgres can use per-column statistics (the coalesce form forced a generic ~33% guess and a '
      + '~96% row underestimate). Algebraically identical for every value; no column changed.',
    reconciledBy: '20260927111536_af_rail_catches_up_to_shipped_perf_edits.sql',
  },
  '20260926222530_district_options_ar_stats_friendly_predicate.sql': {
    why: 'live 2026-09-26; the same stats-friendly predicate rewrite applied to the district picker. '
      + 'Algebraically identical for every value; no column changed, so also invisible to the '
      + 'column-granular guard inside rebuild_af_filter_rpcs().',
    reconciledBy: '20260927111536_af_rail_catches_up_to_shipped_perf_edits.sql',
  },

  // ── Pre-2026-09-06 divergences, surfaced by widening PROTECTED to six and by the needle ─────
  // detector. All predate 20260905183033, which templated all six surfaces and rebuilt from the LIVE
  // definitions — so that migration is where each of these stopped diverging. Recorded, not to-do:
  // the current rail is byte-consistent (rendered == live for all six, re-measured 2026-09-27).
  '20260818231309_trending_rpcs_rent_period_token_owner_2026_08_19.sql': {
    why: 'live 2026-08-19; CREATE OR REPLACE of both Trending RPCs for the owner-mandated rent-period '
      + 'token. Predates these two surfaces being templated at all, so there was no template path to use.',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260822141945_top_cities_by_deal_ar_understands_advanced_filter.sql': {
    why: 'live 2026-08-22; CREATE OR REPLACE teaching the Trending Cities count surface the full AF '
      + 'parameter set. Predates the surface being templated.',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260903224522_district_options_ar_scoped_by_af_eligibility_clause.sql': {
    why: 'live 2026-09-03; CREATE OR REPLACE scoping the district picker by the canonical eligibility '
      + 'clause — the right semantics, applied before the surface was owned by the rebuild.',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260903230551_buy_price_predicate_uses_price_total_effective_everywhere.sql': {
    why: 'live 2026-09-03; needle edit switching the buy-price predicate to price_total_effective '
      + 'across four protected RPCs at once. The semantics are current (the clause and the '
      + 'location_search_candidates_ar template both carry price_total_effective today).',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260905025332_top_cities_cluster_collapse.sql': {
    why: 'live 2026-09-05; needle edit collapsing Trending city rows onto their cluster head. Reverted '
      + 'hours later by 20260905031509 when the collapse moved to the client.',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260905031509_revert_top_cities_cluster_collapse_moves_to_client.sql': {
    why: 'live 2026-09-05; the needle edit REVERTING the cluster collapse above. Correct as a revert, '
      + 'still outside the template path. The template carries no cluster logic today, confirming it.',
    reconciledBy: '20260905183033_every_surface_that_inlines_the_af_clause_is_owned_by_the_rebuild.sql',
  },
  '20260904143246_location_search_candidates_ar_distinct_platform_count.sql': {
    why: 'live 2026-09-04; first attempt at adding distinct_platform_count (a platform-diversity ' +
      'experiment later superseded by PR #1688\'s client-side distinctPlatformCount()) went straight ' +
      'at the RPC — a plain DROP + dynamic CREATE, mirroring what production actually ran before the ' +
      'mistake was caught. Never merged to main in this form; both the column and this hand-edit were ' +
      'reconciled the same day.',
    reconciledBy: '20260904143618_af_template_absorbs_distinct_platform_count_and_rebuild.sql',
  },
  '20260829172433_drop_old_location_search_candidates_ar_overload.sql': {
    why: 'live 2026-08-29; emergency DROP of the stale 41-arg overload after the previous migration\'s CREATE OR REPLACE with a new trailing parameter created a SECOND overload and PGRST203-ed every live caller. Correct as an incident fix, still outside the template path.',
    reconciledBy: '20260830134244_af_template_absorbs_2026_08_29_ranking_so_rebuild_is_a_noop.sql',
  },
  '20260829172838_ranking_photo_preference_fold_into_diversity_partition_order.sql': {
    why: 'live 2026-08-29; CREATE OR REPLACE folding photo-preference + rotation into the diversity partition ORDER BY. This is the definition production runs today, and the one af_rpc_templates did not know about. Raised af_parity_hand_edit (P1) 2026-08-29 17:43.',
    reconciledBy: '20260830134244_af_template_absorbs_2026_08_29_ranking_so_rebuild_is_a_noop.sql',
  },
};

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check('§0 migrations directory is readable and non-empty', files.length > 0);

const REPLACE_RE = (fn: string) =>
  new RegExp(String.raw`\b(?:create\s+or\s+replace\s+function|drop\s+function(?:\s+if\s+exists)?)\s+(?:public\.)?${fn}\b`, 'i');

/**
 * Comments are stripped before any match. A migration that only DISCUSSES one of these RPCs — and
 * the barrier migrations in this tree discuss them constantly — is not editing it. (Same rule, and
 * same reason, as verify-sql-mirrors-not-stale's (B) limb.)
 */
export function strippedSql(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

/**
 * THE SECOND WAY TO EDIT ONE OF THESE FUNCTIONS, which REPLACE_RE cannot see at all.
 *
 *     old_def text := pg_get_functiondef(...);        -- read the live definition
 *     new_def := replace(old_def, needle, patch);     -- patch it in place
 *     execute new_def;                                -- and ship the patched CREATE
 *
 * There is no `create or replace function <name>` anywhere in that migration, so a source-text
 * check for one reports nothing. All four of the 2026-09-26 edits are exactly this shape, and so
 * are three earlier ones. The technique is legitimate and deliberately chosen — it avoids
 * hand-transcribing a 150-line function — but it is still an edit outside the template path, and
 * AGENTS.md recorded the general lesson the same week: "a needle edit is opaque to the guard".
 *
 * Detected by DATAFLOW, not by proximity: a variable assigned from pg_get_functiondef (directly, or
 * through a chain of replace() calls) and then EXECUTEd. Measured across every migration at or after
 * TEMPLATE_ERA_BASELINE: 7 hits, all 7 genuine. The naive signature (pg_get_functiondef AND execute
 * AND the function's name) returns 36, nearly all of them barrier migrations that merely READ a
 * definition to assert on it — a guard that noisy is a guard everyone learns to ignore.
 */
export function executesAPatchedDefinition(src: string): string[] {
  const fromDef = new Set<string>();
  for (const m of src.matchAll(/(\w+)\s*(?::=|\btext\s*:=)\s*[^;]*pg_get_functiondef/gi)) {
    fromDef.add(m[1].toLowerCase());
  }
  // Follow replace() chains to a fixed point: v2 := replace(v1, …) taints v2 when v1 is tainted.
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of src.matchAll(/(\w+)\s*:=\s*replace\s*\(\s*(\w+)/gi)) {
      if (fromDef.has(m[2].toLowerCase()) && !fromDef.has(m[1].toLowerCase())) {
        fromDef.add(m[1].toLowerCase());
        changed = true;
      }
    }
  }
  const executed: string[] = [];
  for (const m of src.matchAll(/\bexecute\s+(\w+)\s*;/gi)) {
    if (fromDef.has(m[1].toLowerCase())) executed.push(m[1].toLowerCase());
  }
  return [...new Set(executed)];
}

type Offence = { file: string; fns: string[]; hasTemplate: boolean; hasRebuild: boolean };
const offences: Offence[] = [];

for (const file of files) {
  const version = file.slice(0, 14);
  if (version < TEMPLATE_ERA_BASELINE) continue;
  const src = strippedSql(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'));
  const patched = executesAPatchedDefinition(src);
  const fns = PROTECTED.filter((fn) =>
    REPLACE_RE(fn).test(src)
    // A needle edit names no CREATE, so the function is identified by being named anywhere in the
    // executed SQL of a migration that ships a patched definition.
    || (patched.length > 0 && new RegExp(String.raw`\b${fn}\b`, 'i').test(src)));
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
  check('§2 the known-divergence allowlist holds exactly the 13 reviewed entries',
    expected.length === 13, `allowlist has ${expected.length} entr(ies) — growing it is a deliberate, reviewed act`);
  check('§2 every allowlist entry carries a stated reason',
    expected.every((k) => (KNOWN_DIVERGENCES[k]?.why ?? '').trim().length > 20),
    'an entry with no reason is cover, not a record');
}

// ── §5 — a claimed reconciliation must name a migration that really exists ──────────────────────
// Without this, "reconciledBy" would be a comment anyone could write. With it, the only way to mark
// a divergence repaired is to have actually landed the migration that repaired it.
{
  const claimed = Object.entries(KNOWN_DIVERGENCES).filter(([, d]) => d.reconciledBy);
  const missing = claimed.filter(([, d]) => !files.includes(d.reconciledBy!));
  check('§5 every claimed reconciliation names a migration present in this repo',
    missing.length === 0,
    missing.map(([k, d]) => `${k} claims ${d.reconciledBy}, which is not in ${MIGRATIONS_DIR}`).join('; '));

  // and the reconciling migration must be the sanctioned path: template + rebuild, together
  const unsound = claimed
    .filter(([, d]) => files.includes(d.reconciledBy!))
    .filter(([, d]) => {
      const src = readFileSync(`${MIGRATIONS_DIR}/${d.reconciledBy}`, 'utf8');
      return !(/\baf_rpc_templates\b/i.test(src) && /\brebuild_af_filter_rpcs\b/i.test(src));
    });
  check('§5 every reconciling migration goes through af_rpc_templates AND rebuild_af_filter_rpcs()',
    unsound.length === 0,
    unsound.map(([k, d]) => `${k} claims ${d.reconciledBy}, which does not use the template path`).join('; '));
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
  // The number is SIX, and it is the number af_rpc_templates/af_rpc_build_state actually hold. This
  // assertion said four for three weeks after the rail grew to six, which is how Trending Cities and
  // Trending Districts went unprotected while a green check reported the set was complete.
  check('§4 exactly six AF shared-eligibility RPCs are protected',
    PROTECTED.length === 6 && new Set(PROTECTED).size === 6,
    `PROTECTED = [${PROTECTED.join(', ')}] — the rail renders six; shrinking it silently unprotects a surface`);
  check('§4 both Trending count surfaces are protected',
    PROTECTED.includes('district_options_ar') && PROTECTED.includes('top_cities_by_deal_ar'));
  check('§4 the results RPC and the referee are both protected',
    PROTECTED.includes('location_search_candidates_ar') && PROTECTED.includes('af_eligible_count'));
}

if (offences.length) {
  const open = offences.filter((o) => !KNOWN_DIVERGENCES[o.file]?.reconciledBy);
  console.log(`\n      HISTORICAL HAND EDITS — ${offences.length} migration(s) that bypassed the template path:`);
  for (const o of offences) {
    const rec = KNOWN_DIVERGENCES[o.file]?.reconciledBy;
    console.log(`        · ${o.file} → [${o.fns.join(', ')}]  ${rec ? `RECONCILED by ${rec}` : 'NOT YET RECONCILED'}`);
  }
  if (open.length) {
    console.log('\n      One or more divergences are NOT yet reconciled. Before running');
    console.log('      rebuild_af_filter_rpcs(), check what af_rpc_templates actually contains: if it');
    console.log('      predates the live definition, the rebuild DROPS every overload first and would');
    console.log('      revert live behaviour — and drop any parameter the template does not know about,');
    console.log('      which 404s every caller that sends it. Fold the change into the template FIRST,');
    console.log('      then rebuild, then prove md5(pg_get_functiondef) did not move.\n');
  } else {
    console.log('\n      All reconciled: af_rpc_templates now reproduces the live definitions, so a');
    console.log('      rebuild is a proven no-op. That was NOT true before 20260830134244 — the template');
    console.log('      predated p_rotation_seed, and a rebuild would have dropped it and 404\'d every');
    console.log('      search. Re-verify the same way if you touch these RPCs again: the round trip');
    console.log('      through the placeholder must equal pg_get_functiondef() byte for byte.\n');
  }
}

console.log(failed === 0
  ? '✓ the six AF shared-eligibility RPCs are generated, not hand-edited (known divergences recorded)'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
