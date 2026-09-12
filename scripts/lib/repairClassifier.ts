// ONE CLASSIFIER FOR "IS THIS MIGRATION A DATA REPAIR", SHARED BY EVERY CHECK THAT ASKS.
//
// WHY THIS FILE EXISTS (routine #7, 2026-09-12). The repo asks that question in two places that
// must never disagree:
//
//   * MERGE TIME — scripts/verify-repair-migrations-are-guarded.ts: a repair must SHIP a detector.
//   * STANDING   — the orphaned-guarantee registry (public.ops_repair_guarantee_registry): that
//     detector must still exist, and the invariant must still HOLD, re-verified forever on
//     oldest-first rotation (docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1).
//
// The standing half can only rotate over repairs it KNOWS ABOUT, and nothing checked enrollment.
// Measured on 2026-09-12: 28 strict-era listing repairs were committed and live, and **9 of them had
// never been entered into the registry** — invisible to the rotation forever, which is the
// orphaned-guarantee bug wearing a registry as a disguise. mon_detect_repair_guarantee_stale() has
// exactly two limbs (a registered repair nothing watches; a registered repair nothing re-verified)
// and BOTH read the registry as their universe, so neither one can see a repair that was never in
// it. The gap was self-referential: the asset built to catch decayed guarantees could not catch a
// guarantee that never arrived.
//
// THE PREDICATE LIVES HERE, ONCE, BECAUSE THE OBVIOUS FIX WAS THE WRONG ONE. The first attempt at
// an enrollment guard re-implemented repairsData() in SQL so a mon_detect_* could run it against
// supabase_migrations.schema_migrations. Executed against the same corpus, the SQL twin missed SIX
// of the 28 repairs the TypeScript original finds (20260815072559, 20260822125152, 20260823145919,
// 20260830140831, 20260906042842, 20260906045735) — Postgres ARE applies one greediness decision to
// a whole regex, so the function-body strip swallowed the executed UPDATE that follows it. A second
// copy of a safety predicate that silently under-detects is worse than no second copy: it reports
// green over exactly the repairs it cannot see. So there is one implementation, in one language, and
// the enrollment check imports it rather than restating it.
//
// Scope note, stated rather than hidden: the callers classify COMMITTED migration files. A repair
// applied to production and never committed is invisible here by construction — that is migration
// drift, and AGENTS.md's four-condition guard (condition 1, applied-but-not-committed) owns it.

/** Strip `create [or replace] function … $tag$ body $tag$` spans. An UPDATE inside a function body
 *  is a definition, not an execution — it only repairs data when something calls it. A `do $$ … $$`
 *  block is deliberately NOT stripped: that runs at migration time, and is how most repairs (the
 *  aqarmonthly one included) are actually written. */
export function executedSql(sql: string): string {
  let out = '';
  let i = 0;
  const fnStart = /create\s+(or\s+replace\s+)?function\b/gi;
  for (;;) {
    fnStart.lastIndex = i;
    const m = fnStart.exec(sql);
    if (!m) { out += sql.slice(i); break; }
    out += sql.slice(i, m.index);
    const tag = /\$([A-Za-z_]*)\$/.exec(sql.slice(m.index));
    if (!tag) { out += sql.slice(m.index); break; }
    const open = m.index + tag.index + tag[0].length;
    const close = sql.indexOf(tag[0], open);
    if (close === -1) { break; }            // unterminated: treat the rest as function body
    i = close + tag[0].length;
  }
  return out;
}

export const stripSqlComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

/** Tables whose rows a scraper re-writes. THIS is the decay mechanism: a config or registry row
 *  stays where you put it, but a repaired LISTING row gets overwritten by the next scrape of that
 *  listing — so a listing repair is exactly the kind whose invariant can silently come undone, and
 *  exactly the kind that needs something standing watch. */
export const LISTING_TABLE = /(^|_)listings$|^search_listings_ar$|^listing_[a-z0-9_]+$/;

/** Does this migration EXECUTE a repair of listing data? */
export function repairsData(sql: string): boolean {
  const body = executedSql(stripSqlComments(sql));
  const re = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_.]*)/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const t = m[1].toLowerCase().replace(/^public\./, '');
    if (LISTING_TABLE.test(t)) return true;
  }
  return false;
}

/** Does this migration name a detector in EXECUTED SQL (a comment does not count)? */
export function isGuarded(sql: string): boolean {
  return /mon_detect_[a-z0-9_]+/i.test(stripSqlComments(sql));
}

/** `20260911221734_foo.sql` → `20260911221734`, padded so short legacy prefixes still compare. */
export const migrationVersion = (f: string) =>
  (f.match(/^(\d{8,14})/)?.[1] ?? '').padEnd(14, '0');

// ── ENROLLMENT ──────────────────────────────────────────────────────────────────────────────────

export type EnrollmentInput = {
  /** Versions of in-era committed migrations that repairsData() classifies as repairs. */
  repairs: string[];
  /**
   * Versions present in public.ops_repair_guarantee_registry — or `null` when the registry could
   * not be READ. The distinction is load-bearing and is why this is not `string[]`: the registry is
   * RLS-protected, and an anon read of it returns HTTP 200 with `[]`. A check that accepted that as
   * "the registry is empty" would report the friendly half of a failure (see AGENTS.md, "A FAILED
   * FETCH IS NOT AN EMPTY ANSWER"). Callers must pass null on any non-2xx.
   */
  enrolled: string[] | null;
  /** version → reason, from the committed waiver file. A reason, never a mute button. */
  waived: Map<string, string>;
};

export type EnrollmentVerdict = {
  ok: boolean;
  /** In-era repairs that are neither registered nor waived — the rotation can never reach these. */
  unenrolled: string[];
  /** Everything else wrong: an unreadable registry, a reasonless waiver, a waiver for a non-repair. */
  problems: string[];
};

/** Shortest reason that can carry an argument. Mirrors the merge-time barrier's own waiver rule. */
export const MIN_WAIVER_REASON = 20;

/**
 * The whole rule, pure and injectable so it can be fed a broken world and watched to fail.
 *
 * A repair is ACCOUNTED FOR when it is registered in the standing registry, or when a committed,
 * reasoned waiver says it is not the kind of thing that can decay (the canonical example is
 * 20260831195108, whose only UPDATE is `city_id = city_id` — a self-assignment that exists solely to
 * fire a trigger, so no row changes meaning and there is no repaired state to drift back).
 */
export function enrollmentVerdict(input: EnrollmentInput): EnrollmentVerdict {
  const problems: string[] = [];
  const repairs = [...new Set(input.repairs)].sort();

  // A registry that cannot be read is UNKNOWN, never "nothing is enrolled" and never "all clear".
  if (input.enrolled === null) {
    problems.push(
      'ops_repair_guarantee_registry could not be read — treating this as UNKNOWN, not as an empty '
      + 'registry. Re-run with a key that can read it (the table is RLS-protected; an anon read '
      + 'returns 200 with [] and would silently look like a registry with nothing in it).');
    return { ok: false, unenrolled: [], problems };
  }
  if (input.enrolled.length === 0 && repairs.length > 0) {
    problems.push(
      `ops_repair_guarantee_registry returned ZERO rows while ${repairs.length} in-era repairs exist. `
      + 'That is the RLS-filtered read, not a real state — the registry has never been empty since '
      + 'it was seeded. Refusing to report an enrollment gap computed from an empty universe.');
    return { ok: false, unenrolled: [], problems };
  }

  const enrolled = new Set(input.enrolled);
  const repairSet = new Set(repairs);

  for (const [version, reason] of input.waived) {
    if (reason.trim().length < MIN_WAIVER_REASON) {
      problems.push(`waiver for ${version} has no real reason ("${reason.trim()}")`);
    }
    // A waiver that no longer matches a repair is a mute button nobody can see behind. Fail on it
    // so the file cannot quietly accumulate entries that stopped meaning anything.
    if (!repairSet.has(version)) {
      problems.push(
        `waiver for ${version} does not match any in-era repair — stale or misspelled; remove it or `
        + 'fix the version (a waiver must always name something the classifier actually flags)');
    }
  }

  const unenrolled = repairs.filter((v) => !enrolled.has(v) && !input.waived.has(v));
  return { ok: unenrolled.length === 0 && problems.length === 0, unenrolled, problems };
}

/**
 * Turn ONE HTTP answer about the registry into `string[]` or `null`, and nothing in between.
 *
 * This is the line the whole check hangs on, so it is pure and lives beside the rule rather than
 * inside the fetch loop. `ops_repair_guarantee_registry` is RLS-protected: an anon read of it
 * returns HTTP **200 with `[]`**, which is a permissions failure wearing the shape of an answer. A
 * non-2xx is `null` (unknown), a non-array body is `null` (unknown), and only a real array is data.
 * The caller then decides what an EMPTY array means — see enrollmentVerdict(), which refuses it
 * while repairs exist rather than reporting every repair as unenrolled.
 */
export function registryVersionsFromResponse(ok: boolean, body: unknown): string[] | null {
  if (!ok) return null;
  if (!Array.isArray(body)) return null;
  return body.map((r) => String((r as { repair_version: unknown }).repair_version));
}

/** Parse the committed waiver file: `version | reason`, `#` comments and blank lines ignored. */
export function parseWaivers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bar = line.indexOf('|');
    if (bar === -1) continue;
    out.set(line.slice(0, bar).trim(), line.slice(bar + 1).trim());
  }
  return out;
}
