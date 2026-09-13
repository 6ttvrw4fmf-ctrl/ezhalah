#!/usr/bin/env node --experimental-strip-types
/**
 * REGENERATING A MIRROR IS A TWO-PLACE EDIT. ONLY ONE PLACE WAS ENFORCED.
 *
 * `mon_detect_sql_mirror_drift()` compares the LIVE object's md5 against
 * `ops_sql_mirror_expected.expected_md5` — a row in the DATABASE. The mirror body and its recorded
 * md5 live in the REPO. Regenerating a mirror therefore requires updating both, and until now
 * nothing checked the second one: `scripts/verify-sql-mirrors-not-stale.ts` proves the file is
 * self-consistent and not older than the migrations touching it, but it has no idea the registry
 * exists.
 *
 * MEASURED, TWICE, ON THE SAME OBJECT.
 *   * 2026-09-11 15:51 — migration 20260911155123 exists solely to "catch up" expected_md5 for
 *     `listing_native_location_v1` after a regeneration had moved it. A hand-written repair, no
 *     barrier added.
 *   * 2026-09-12 19:08 — the amlakalahsa activation (20260912190822) regenerated the same view,
 *     md5 moving to 52b8d750cd49b1f46fdb471499678afc. It updated the mirror FILE and its header,
 *     and left the registry on 862a10b719341ab0d425b81b02d69871.
 *
 * The consequence is not a missed defect but a permanent false one: the detector compared live
 * against a number matching NEITHER the file nor production, and raised a P1 that stood open from
 * 2026-09-11 19:29 to 2026-09-13 08:00 over an object that was byte-correct the whole time. A P1
 * that cannot be true is worse than no P1 — it is what teaches everyone to scroll past the kind.
 * (1,014 alerts raised all-time, 2 ever acknowledged — docs/ops/AUTONOMOUS_INCIDENT_LOOP.md.)
 *
 * THE INVARIANT, and why it is checkable offline. The registry is database state this hermetic
 * suite must not read (see AGENTS.md, "The required suite is HERMETIC"). But every legitimate
 * change to it arrives as a committed migration containing the new digest as a literal. So:
 *
 *     every md5 recorded in a sql/mirrors/*.sql header must appear as a 32-hex literal in
 *     at least one committed migration
 *
 * If a mirror records a digest no migration ever writes, the registry cannot possibly agree with
 * it, and the live detector is guaranteed to be comparing against a stale number. That is exactly
 * the 2026-09-12 state, and this check is RED on it.
 *
 * It is deliberately one-directional. It does NOT require the digest's migration to be the same
 * one that regenerated the mirror (a follow-up catch-up migration is a legitimate repair), and it
 * says nothing about migrations carrying digests no mirror uses — an older expected_md5 that has
 * since been superseded is normal history, not drift.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRRORS_DIR = join(ROOT, 'sql', 'mirrors');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
/** A mutation proof: this barrier's OWN predicate, run against a deliberately broken input. */
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

/** The digest a mirror header claims it was verified against. Same shape the sibling check reads. */
export function recordedMd5(fileText: string): string | null {
  const lines = fileText.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('--') || !lines[i].trim())) i++;
  const header = lines.slice(0, i).join('\n');
  const m = header.match(/md5[^:]*:\s*([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

/** Every 32-hex literal any committed migration writes. */
export function digestsWrittenByMigrations(migrationBodies: string[]): Set<string> {
  const seen = new Set<string>();
  for (const body of migrationBodies) {
    for (const m of body.matchAll(/\b([0-9a-f]{32})\b/gi)) seen.add(m[1].toLowerCase());
  }
  return seen;
}

/**
 * Mirrors that `ops_sql_mirror_expected` does not cover AT ALL, so no migration would ever carry
 * their digest and the live drift detector never looks at them.
 *
 * This is a real, separate gap, not an exemption: AGENTS.md says "sql/mirrors/ must stay byte-exact
 * with live objects (verify via md5 of pg_get_functiondef)", and measured 2026-09-13 that is
 * enforced against production for only 3 of the 8 mirrors. The other five are checked for
 * SELF-consistency by verify-sql-mirrors-not-stale.ts and against nothing else — a file can be
 * perfectly consistent with a body that production stopped matching months ago.
 *
 * SHRINK-ONLY. Registering one means proving file == live and adding a migration that writes its
 * digest into ops_sql_mirror_expected; then delete it from here. The ceiling cannot be raised, so
 * a NEW mirror added tomorrow is RED until it is either registered or deliberately listed.
 *
 * The three af_* mirrors are Advanced Filter surface, owned by routine #5, and are NOT this
 * routine's to register (docs/ops/ENGINEER_ROUTINES.md §G.3 — route, do not reach in).
 */
const UNREGISTERED_MIRROR_BASELINE = new Set([
  'af_canon_select.sql',        // routine #5 (Advanced Filter)
  'af_cohort_registry.sql',     // routine #5 (Advanced Filter)
  'af_eligibility_clause.sql',  // routine #5 (Advanced Filter)
  'mark_stale_listings_inactive.sql', // routine #11 (lifecycle/liveness)
  'resolve_aqar_locations.sql',       // routine #3 — registerable, needs file==live proof first
]);
const UNREGISTERED_CEILING = 5; // measured 2026-09-13. Shrink-only; raising it is a regression.

/** THE PREDICATE. Mirrors whose recorded digest no migration ever writes. */
export function unregisteredMirrors(
  mirrors: { file: string; md5: string | null }[],
  registered: Set<string>,
  baseline: Set<string> = new Set(),
): string[] {
  return mirrors
    .filter((m) => m.md5 !== null && !registered.has(m.md5) && !baseline.has(m.file))
    .map((m) => `${m.file} records ${m.md5} — no migration writes that digest`);
}

console.log('verify-mirror-md5-is-registered: a mirror digest no migration writes means the live');
console.log('drift detector is comparing production against a number nothing else believes.\n');

const mirrorFiles = readdirSync(MIRRORS_DIR).filter((f) => f.endsWith('.sql'));
check('sql/mirrors contains at least one mirror', mirrorFiles.length > 0);

const migrationBodies = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
check('supabase/migrations is readable', migrationBodies.length > 0, `${migrationBodies.length} files`);

const mirrors = mirrorFiles.map((file) => ({
  file,
  md5: recordedMd5(readFileSync(join(MIRRORS_DIR, file), 'utf8')),
}));
const registered = digestsWrittenByMigrations(migrationBodies);

const problems = unregisteredMirrors(mirrors, registered, UNREGISTERED_MIRROR_BASELINE);
for (const m of mirrors) {
  if (m.md5 === null) continue; // the sibling check owns "header records a verified md5"
  if (UNREGISTERED_MIRROR_BASELINE.has(m.file)) {
    console.log(`  ⚠ ${m.file} is OUTSIDE the live drift registry (declared backlog) — ${m.md5.slice(0, 8)}…`);
    continue;
  }
  check(`${m.file} digest is registered by a migration`, registered.has(m.md5), `${m.md5.slice(0, 8)}…`);
}
check('no NEW mirror escapes the live drift registry', problems.length === 0, problems.join('; '));

const stale = [...UNREGISTERED_MIRROR_BASELINE].filter((f) => !mirrorFiles.includes(f));
check('the backlog names only mirrors that exist', stale.length === 0, stale.join(', '));
check(
  'the unregistered backlog has not grown',
  UNREGISTERED_MIRROR_BASELINE.size <= UNREGISTERED_CEILING,
  `${UNREGISTERED_MIRROR_BASELINE.size} vs ceiling ${UNREGISTERED_CEILING}`,
);

// ── MUTATION PROOFS: the predicate must actually be able to fail ────────────────────────────────
console.log('\n  mutation proofs:');
{
  const reg = new Set(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  mustCatch(
    'an unregistered digest is caught',
    unregisteredMirrors([{ file: 'x.sql', md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }], reg).length === 1,
  );
  mustCatch(
    'a registered digest passes',
    unregisteredMirrors([{ file: 'x.sql', md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }], reg).length === 0,
  );
  mustCatch(
    'a mirror with no recorded digest is left to the sibling check',
    unregisteredMirrors([{ file: 'x.sql', md5: null }], reg).length === 0,
  );
  // The real 2026-09-12 shape: the file moved to 52b8d750…, migrations still only wrote 862a10b7….
  mustCatch(
    'the actual 2026-09-12 regression is caught',
    unregisteredMirrors(
      [{ file: 'listing_native_location_v1.sql', md5: '52b8d750cd49b1f46fdb471499678afc' }],
      new Set(['862a10b719341ab0d425b81b02d69871']),
    ).length === 1,
  );
  mustCatch(
    '…and passes once the catch-up migration exists',
    unregisteredMirrors(
      [{ file: 'listing_native_location_v1.sql', md5: '52b8d750cd49b1f46fdb471499678afc' }],
      new Set(['862a10b719341ab0d425b81b02d69871', '52b8d750cd49b1f46fdb471499678afc']),
    ).length === 0,
  );
  mustCatch(
    'digest extraction reads a real header',
    recordedMd5('-- Recorded md5: 52b8d750cd49b1f46fdb471499678afc\nselect 1;') ===
      '52b8d750cd49b1f46fdb471499678afc',
  );
  mustCatch(
    'a digest in the BODY is not mistaken for the header record',
    recordedMd5('-- no digest here\nselect md5: 52b8d750cd49b1f46fdb471499678afc;') === null,
  );
}

console.log(
  failures === 0
    ? '\n✓ verify-mirror-md5-is-registered: every mirror digest is written by a migration.'
    : `\n✗ verify-mirror-md5-is-registered: ${failures} failure(s). Regenerating a mirror is a TWO-place edit: update sql/mirrors/<obj>.sql AND add a migration setting ops_sql_mirror_expected.expected_md5 to the same digest.`,
);
process.exit(failures === 0 ? 0 : 1);
