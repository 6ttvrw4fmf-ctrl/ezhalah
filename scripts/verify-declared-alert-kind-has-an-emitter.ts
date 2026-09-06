// Barrier: AN ALERT KIND A SPEC DECLARES MUST HAVE SOMETHING THAT CAN RAISE IT.
//
// THE DEFECT THIS EXISTS FOR (ops_incident #25). docs/ops/LISTING_LIFECYCLE_ENGINEER.md declared seven
// alert kinds for routine #11. scripts/lib/alertRouting.ts routed all seven. Migration 20260905022312
// described one of them — `unknown_treated_as_dead` — as "the alert kind that fires when it is broken".
// No mon_raise() anywhere could emit a single one of them. The queue was addressable and unfillable,
// and it stayed that way for four routine-days until a human read the spec next to the database.
//
// Nothing in the repo could see it. `mon_detect_orphaned_detectors()` asks whether a detector is
// REACHED by the sweep. `mon_detect_detector_cannot_raise()` (incident #71) asks whether a detector can
// SPEAK at all. Both walk from the function outwards, so neither can see a kind that has no function.
//
// THE TWO HALVES, AND WHY THIS FILE IS THE OFFLINE ONE.
//
//   LIVE  — mon_detect_declared_kind_without_emitter() reads public.ops_declared_alert_kind and asks
//           production which of those kinds no function passes to mon_raise. That is the real oracle:
//           two emitters in this database (served_after_source_gone, prune_kill_unverified) exist only
//           as production objects and appear in no migration file, so a repository-only check would
//           call them missing and be wrong.
//   HERE  — the live check can only see kinds that are REGISTERED. This file is what keeps that
//           registry honest against the prose: every kind a spec declares with the repo's
//           "(kind `x`)" convention must be in the registry, and the registry must not be quietly
//           emptied to make the live detector green. It also catches the case the live one cannot yet:
//           a kind declared and registered whose emitter no migration builds.
//
// It is deliberately offline (no network) so it can live in the required `npm test` without making an
// unrelated PR fail whenever production hiccups — the reason scripts/test-exclusions.txt exists for the
// live checks.
//
//   node --experimental-strip-types scripts/verify-declared-alert-kind-has-an-emitter.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const DOCS = join(root, 'docs', 'ops');
const MIGRATIONS = join(root, 'supabase', 'migrations');

/**
 * Kinds whose ONLY emitter is a production-only function with no migration in this tree. Verified by
 * direct query on 2026-09-06:
 *   served_after_source_gone -> mon_detect_served_after_source_confirmed_gone
 *   prune_kill_unverified    -> mon_detect_prune_kill_without_source_verdict
 * Both raise the kind in production today; neither has a `create function` anywhere under
 * supabase/migrations (the same mirror gap LISTING_LIFECYCLE_ENGINEER.md §8.1 records for
 * prune_inactive_from_search). This list may only SHRINK — its length is pinned below, so adding to it
 * is a reviewed source edit and not a quiet append.
 */
export const PRODUCTION_ONLY_EMITTERS: ReadonlyArray<string> = [
  'served_after_source_gone',
  'prune_kill_unverified',
];
const PRODUCTION_ONLY_CEILING = 2;

export type Inputs = {
  /** kind -> the doc that declares it */
  declared: ReadonlyMap<string, string>;
  /** kinds inserted into ops_declared_alert_kind by some migration */
  registered: ReadonlySet<string>;
  /** kinds passed to mon_raise as its second argument by some migration */
  emitted: ReadonlySet<string>;
  /** migration files that DELETE from or TRUNCATE the registry */
  registryDeletions: ReadonlyArray<string>;
};

/** The whole decision, pure and executable. Empty array = the invariant holds. */
export function verdict(i: Inputs): string[] {
  const problems: string[] = [];

  for (const [kind, doc] of i.declared) {
    if (!i.registered.has(kind)) {
      problems.push(
        `${kind}: declared in ${doc} but never inserted into public.ops_declared_alert_kind — ` +
          'the live detector cannot check a kind it has not been told about, so this kind is ' +
          'unwatched in both directions',
      );
      continue;
    }
    if (!i.emitted.has(kind) && !PRODUCTION_ONLY_EMITTERS.includes(kind)) {
      problems.push(
        `${kind}: declared in ${doc} and registered, but no migration passes it to mon_raise — ` +
          'build the detector (with its mon_run_all_detectors roster entry, in the same migration) ' +
          'or delete the claim from the spec',
      );
    }
  }

  for (const f of i.registryDeletions) {
    problems.push(
      `${f}: deletes from or truncates public.ops_declared_alert_kind. Removing a row is how this ` +
        'whole check gets made green without building anything — if a kind genuinely no longer ' +
        'exists, remove it from the spec first and say so here.',
    );
  }

  if (PRODUCTION_ONLY_EMITTERS.length > PRODUCTION_ONLY_CEILING) {
    problems.push(
      `the production-only emitter list grew to ${PRODUCTION_ONLY_EMITTERS.length} (ceiling ` +
        `${PRODUCTION_ONLY_CEILING}). It may only shrink: a NEW detector belongs in a migration.`,
    );
  }

  return problems;
}

// ── reading the repository ─────────────────────────────────────────────────────────────────────

/** The convention the ops specs already use to declare an alert kind: "(kind `x`)". */
export function parseDeclared(files: ReadonlyArray<{ name: string; text: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    for (const m of f.text.matchAll(/\(kind `([a-z0-9_]+)`\)/g)) {
      if (!out.has(m[1])) out.set(m[1], `docs/ops/${f.name}`);
    }
  }
  return out;
}

/**
 * Kinds inserted into the registry, read out of the INSERT's value tuples.
 *
 * The statement ends at a `;` that ENDS A LINE, not at the first `;` in the text. Written the naive
 * way this parser stopped inside a row whose note read "shipped name; the spec first called…" and
 * silently lost the three kinds after it — caught the first time it ran, because a truncated block
 * reports "declared but never registered", which is the safe direction.
 */
export function parseRegistered(sql: string): Set<string> {
  const out = new Set<string>();
  const insert = /insert\s+into\s+public\.ops_declared_alert_kind\b[\s\S]*?;[ \t]*$/gim;
  for (const block of sql.matchAll(insert)) {
    for (const m of block[0].matchAll(/\(\s*'([a-z0-9_]+)'\s*,/g)) out.add(m[1]);
  }
  return out;
}

/**
 * Kinds in mon_raise's SECOND argument — the same shape mon_declared_kinds_without_emitter() requires
 * in SQL, and for the same reason: merely mentioning the string (a comment, a mon_resolve call, a jsonb
 * payload) is not an emitter, and treating it as one is how a kind reads as covered while nothing can
 * raise it. The first argument is bounded rather than open-ended so a comma inside a comment or a
 * multi-line expression cannot be swallowed into it.
 */
export function parseEmitted(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/mon_raise\s*\(\s*[^,]{1,40},\s*'([a-z0-9_]+)'/g)) out.add(m[1]);
  return out;
}

export function parseRegistryDeletions(files: ReadonlyArray<{ name: string; text: string }>): string[] {
  return files
    .filter((f) => /(delete\s+from|truncate(\s+table)?)\s+(public\.)?ops_declared_alert_kind\b/i.test(f.text))
    .map((f) => f.name);
}

const docFiles = readdirSync(DOCS)
  .filter((f) => f.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(join(DOCS, name), 'utf8') }));

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, text: readFileSync(join(MIGRATIONS, name), 'utf8') }));

const allSql = migrationFiles.map((f) => f.text).join('\n');

const inputs: Inputs = {
  declared: parseDeclared(docFiles),
  registered: parseRegistered(allSql),
  emitted: parseEmitted(allSql),
  registryDeletions: parseRegistryDeletions(migrationFiles),
};

// ── run ────────────────────────────────────────────────────────────────────────────────────────
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nEvery alert kind a spec declares must have something that can raise it\n');

const problems = verdict(inputs);
check(
  `all ${inputs.declared.size} declared kinds are registered and emittable`,
  problems.length === 0,
  problems.length === 0 ? `${inputs.emitted.size} kinds emitted across the migration tree` : '',
);
for (const p of problems) console.log(`         ${p}`);

// The parse is not vacuously empty: a barrier reading zero declarations would report zero problems.
check('the docs actually declare kinds (the parse is not silently empty)', inputs.declared.size >= 11);
check('the registry insert was actually found in the migrations', inputs.registered.size >= 11);

// ── MUTATION PROOF — the predicate is executed against deliberately broken input ────────────────
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};

const ok: Inputs = {
  declared: new Map([['some_kind', 'docs/ops/X.md']]),
  registered: new Set(['some_kind']),
  emitted: new Set(['some_kind']),
  registryDeletions: [],
};

mustCatch(
  'catches the incident #25 shape: a kind declared in a spec that nothing can raise',
  verdict({ ...ok, emitted: new Set<string>() }).length > 0,
);
mustCatch(
  'catches a declared kind that was never registered, so the live detector cannot see it',
  verdict({ ...ok, registered: new Set<string>() }).length > 0,
);
mustCatch(
  'catches a migration that deletes registry rows to make the live detector green',
  verdict({ ...ok, registryDeletions: ['20990101_quietly_forget_a_kind.sql'] }).length > 0,
);
mustCatch(
  'catches the real pre-fix state (four routine-11 kinds declared, none emitted)',
  verdict({
    declared: new Map([
      ['false_resurrection', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md'],
      ['orphan_after_delete', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md'],
      ['lifecycle_duplicate_stale_copy', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md'],
      ['deletion_clock_stalled', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md'],
    ]),
    registered: new Set([
      'false_resurrection',
      'orphan_after_delete',
      'lifecycle_duplicate_stale_copy',
      'deletion_clock_stalled',
    ]),
    emitted: new Set<string>(),
    registryDeletions: [],
  }).length === 4,
);
// Non-vacuity, both ways: a consistent world must PASS, and the production-only exception must work
// without letting an unexcepted kind through.
check('a consistent input PASSES (the proofs above are not vacuous)', verdict(ok).length === 0);
check(
  'a production-only emitter is accepted without a migration',
  verdict({
    declared: new Map([['prune_kill_unverified', 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md']]),
    registered: new Set(['prune_kill_unverified']),
    emitted: new Set<string>(),
    registryDeletions: [],
  }).length === 0,
);

// The parsers are executed too — a verdict() that is perfect over hand-built inputs proves nothing if
// the reader that feeds it cannot tell an emitter from a mention.
mustCatch(
  'parseEmitted ignores a kind that is only MENTIONED, and finds one that is raised',
  !parseEmitted("-- mentions 'ghost_kind' in a comment\nperform mon_resolve('ghost_kind','all');").has('ghost_kind') &&
    parseEmitted("n := n + mon_raise('P1', 'real_kind', 'all', k, '{}'::jsonb);").has('real_kind'),
);
mustCatch(
  'parseRegistered survives a semicolon inside a note and still sees the rows after it',
  parseRegistered(
    "insert into public.ops_declared_alert_kind (kind, declared_in, note) values\n" +
      "  ('first_kind', 'docs/ops/X.md', 'a note; with a semicolon in it'),\n" +
      "  ('second_kind', 'docs/ops/X.md', null)\n" +
      'on conflict (kind) do nothing;\n',
  ).has('second_kind'),
);
mustCatch(
  'parseEmitted is not fooled by a comma-bearing comment between mon_raise( and its kind',
  !parseEmitted(
    "n := mon_raise(\n  -- prose, with a comma, hides the argument\n  sev,\n  'hidden_kind', 'all', k, '{}'::jsonb);",
  ).has('hidden_kind'),
);

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — an alert kind may be routed to a routine that can never receive it`
    : '\n✓ Every declared alert kind is registered and has something that can raise it',
);
process.exit(failed ? 1 : 0);
