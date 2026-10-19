// THE FLEET'S LISTING IDs ARE GLOBALLY UNIQUE BY CONSTRUCTION, AND NOTHING CHECKED IT.
//
// (routine-10-barrier, 2026-09-24, ops_incident #660 — routed here by routine #9 as MISSING
// COVERAGE, not as a live defect. The invariant HOLDS today and was measured holding.)
//
// WHAT DEPENDS ON IT. The client keys two things on a listing's per-table primary key ALONE:
//   · LISTING_CACHE — `Map<number, Listing>` in src/data/remote.ts, written by cacheListings and
//     read by getCachedListing on the card-open path;
//   · every result card's DOM identity — `testID={`card-listing-${listing.id}`}` in
//     src/components/ResultCard.tsx, which is also the join every card-evidence barrier and routine
//     #9's chain driver use to hold a card to its row.
// `id` is `Number(r.id)` (remote.ts) — a PLATFORM TABLE'S OWN primary key. Unique per table. The
// fleet has 143 of those tables. Nothing in the type system, the RPCs or the client says the number
// may not repeat across two of them.
//
// WHY IT NEVERTHELESS HOLDS. Every listing table in the tree is created with
// `CREATE TABLE <new> (LIKE <sibling> INCLUDING ALL)`, and `INCLUDING ALL` implies
// `INCLUDING DEFAULTS`, which copies the DEFAULT EXPRESSION VERBATIM. The template's id default is
// `nextval('aqar_residential_listings_id_seq'::regclass)` — a plain serial default, not an identity
// column — so every clone draws from the ONE fleet sequence. Measured on production 2026-09-23 and
// re-measured 2026-09-24: all 143 `*_{residential,commercial}_listings` tables carry exactly that
// default, attidentity is empty on every one, and 233,815 production_ready rows hold 233,815
// distinct ids — zero id appears in two source_tables.
//
// SO THE INVARIANT IS A SIDE EFFECT OF A TEMPLATE NOBODY DOCUMENTED AS LOAD-BEARING, and there are
// two ways to lose it, both silent, both delayed:
//
//   1. THE OBVIOUS ONE. A platform table added tomorrow with its own `bigserial` / `GENERATED AS
//      IDENTITY` / `DEFAULT nextval('its_own_seq')` starts at 1 and walks straight through ids the
//      fleet already issued. First symptom: a user opens card A and is shown listing B from a
//      different platform, because LISTING_CACHE answered from the id alone. No detector exists for
//      a card-evidence disagreement of that shape.
//
//   2. THE ONE THE TEMPLATE HIDES, and the reason this file judges ALTERs too. `INCLUDING ALL` also
//      implies `INCLUDING IDENTITY`, and INCLUDING IDENTITY does NOT share — it creates a NEW
//      sequence for the new table. So a routine "modernise serial → identity" migration aimed at
//      `aqar_residential_listings` alone would leave all 143 existing tables correct and every
//      FUTURE `LIKE ... INCLUDING ALL` clone silently private. The damage arrives on the next
//      platform onboarding, months later, in a migration that looks identical to the 17 before it.
//
// WHAT THIS FILE JUDGES: COMMITTED MIGRATIONS ONLY, stated rather than implied. A table created
// straight through `execute_sql` and never committed is invisible here by construction — that is
// migration drift, and AGENTS.md's four-condition guard owns it. The pre-baseline era is likewise
// invisible: 143 tables exist and only 17 migrations in the tree create any of them, so the great
// majority were created before the committed era. Their CURRENT state is measured (all shared), but
// that measurement is a live fact this hermetic check cannot re-derive — `npm test` is the REQUIRED
// status check on every PR and a check whose verdict is decided by production fails unrelated diffs
// (AGENTS.md, "The required suite is HERMETIC"). What this file does cover is the only direction
// that can still change: the NEXT table, and the next ALTER.

/** The one sequence the whole fleet draws from. */
export const FLEET_SEQUENCE = 'aqar_residential_listings_id_seq';

/** A live fleet listing table. Anchored so `toor_residential_listings_backup_20260714` — an
 *  `AS SELECT` snapshot, not a served table — is NOT swept in. */
export const LISTING_TABLE_NAME = /^[a-z0-9_]+_(?:residential|commercial)_listings$/;

/** Block comments, whole-line `--`, AND TRAILING `--`.
 *
 *  The trailing half is not tidiness. `repairClassifier.stripSqlComments` removes only whole-LINE
 *  `--`, which is right for the shapes it hunts (an un-stripped comment there makes a detector fire,
 *  i.e. fail CLOSED). Here the polarity is reversed: this file reads a LIKE clause as EVIDENCE OF
 *  HEALTH, so a `CREATE TABLE x (id bigserial)  -- was: (LIKE aqar_residential_listings INCLUDING ALL)`
 *  would be rescued by its own decoy. Over-stripping loses the LIKE and goes red; under-stripping
 *  goes green on a broken table. Only one of those is survivable. */
export function stripSqlCommentsStrict(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

export type ListingCreation = {
  /** Literal target name, or `'<dynamic>'` for a `format()`-built identifier. */
  target: string;
  /** The parenthesised table definition, contents only. */
  body: string;
  dynamic: boolean;
};

/** Read the balanced parenthesised span starting at `open` (which must index a `(`). */
function balanced(sql: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') { depth--; if (depth === 0) return sql.slice(open + 1, i); }
  }
  return null;
}

/** Does this migration build listing-table names at run time? `EXECUTE format('CREATE TABLE %I …')`
 *  hides its target behind a placeholder, so the only honest reading is migration-level: a dynamic
 *  create inside a migration that constructs `…_listings` names must prove its id provenance like
 *  any other. Over-inclusion is fail-CLOSED here and that is deliberate. */
export function buildsListingNames(sql: string): boolean {
  return /_listings\b/.test(sql);
}

/** Every CREATE TABLE in this migration's EXECUTED sql that creates a fleet listing table. */
export function listingTableCreations(sql: string): ListingCreation[] {
  const body = stripSqlCommentsStrict(sql);
  const dynamicOk = buildsListingNames(body);
  const out: ListingCreation[] = [];

  const re = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([%A-Za-z_][%A-Za-z0-9_."]*)/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const raw = m[1].replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
    const open = body.indexOf('(', m.index + m[0].length);
    if (open === -1) continue;
    // `CREATE TABLE x AS SELECT …` has no parenthesised definition of its own; a `(` further down
    // belongs to the query. Only treat it as a definition if nothing but whitespace precedes it.
    if (body.slice(m.index + m[0].length, open).trim() !== '') continue;
    const def = balanced(body, open);
    if (def === null) continue;

    const isLiteral = LISTING_TABLE_NAME.test(raw);
    const isDynamic = /%[isl]/i.test(raw);
    if (isLiteral) out.push({ target: raw, body: def, dynamic: false });
    else if (isDynamic && dynamicOk) out.push({ target: '<dynamic>', body: def, dynamic: true });
  }
  return out;
}

export type IdVerdict = { shared: boolean; reason: string };

/** Does this creation's `id` column draw from the fleet sequence?
 *
 *  UNKNOWN IS NEVER HEALTHY. A definition this function cannot read is reported as not-shared with
 *  the reason "unreadable", never waved through — the owner-locked SOURCE IS TRUTH rule
 *  (silent→NULL, never unknown→NO) applies to a barrier's own reads exactly as it applies to the
 *  product's (BARRIER_ENGINEER.md PART 1.5). */
export function idProvenance(c: ListingCreation): IdVerdict {
  const def = c.body;

  // ── The template form, which is how all 17 committed creations are written ────────────────────
  const like = /\blike\s+(?:public\.)?"?([a-z0-9_]+)"?\s*((?:including|excluding)\s+[a-z]+(?:\s+(?:including|excluding)\s+[a-z]+)*)?/i
    .exec(def);
  if (like) {
    const template = like[1].toLowerCase();
    const options = (like[2] ?? '').toLowerCase();
    if (!LISTING_TABLE_NAME.test(template)) {
      return { shared: false, reason: `LIKE ${template} — not a fleet listing table, so its id default is unknown` };
    }
    if (/excluding\s+(all|defaults)\b/.test(options)) {
      return { shared: false, reason: `LIKE ${template} ${options.trim()} — the id DEFAULT is explicitly excluded` };
    }
    if (!/including\s+(all|defaults)\b/.test(options)) {
      return {
        shared: false,
        reason: `LIKE ${template}${options ? ` ${options.trim()}` : ''} — no INCLUDING ALL/DEFAULTS, so the id`
          + ` column is copied WITHOUT nextval('${FLEET_SEQUENCE}')`,
      };
    }
    return { shared: true, reason: `LIKE ${template} ${options.trim()} — inherits nextval('${FLEET_SEQUENCE}')` };
  }

  // ── An explicit id column ─────────────────────────────────────────────────────────────────────
  const idCol = /(?:^|,)\s*"?id"?\s+([^,]*)/i.exec(def);
  if (!idCol) {
    return { shared: false, reason: 'no LIKE clause and no id column this reader can locate' };
  }
  const spec = idCol[1].toLowerCase();
  if (/\bgenerated\s+(?:always|by\s+default)\s+as\s+identity/.test(spec)) {
    return { shared: false, reason: 'id is an IDENTITY column — identity mints a PRIVATE sequence, it never shares' };
  }
  if (/\b(?:big|small)?serial\b/.test(spec)) {
    return { shared: false, reason: 'id is a serial — serial mints a PRIVATE sequence per table' };
  }
  const seq = /nextval\(\s*'(?:public\.)?([a-z0-9_]+)'/.exec(spec);
  if (seq) {
    return seq[1] === FLEET_SEQUENCE
      ? { shared: true, reason: `id defaults to nextval('${FLEET_SEQUENCE}') explicitly` }
      : { shared: false, reason: `id draws from '${seq[1]}', not the fleet sequence '${FLEET_SEQUENCE}'` };
  }
  return { shared: false, reason: `id spec "${idCol[1].trim()}" names no sequence this reader can resolve` };
}

export type Redefinition = { table: string; what: string };

/** Statements that would move an EXISTING fleet listing table off the shared sequence — including
 *  the template itself, which is the fleet-wide one. */
export function idProvenanceRedefinitions(sql: string): Redefinition[] {
  const body = stripSqlCommentsStrict(sql);
  const out: Redefinition[] = [];

  const re = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([%A-Za-z_][%A-Za-z0-9_."]*)([\s\S]{0,400}?);/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const raw = m[1].replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
    const dynamic = /%[isl]/i.test(raw);
    if (!LISTING_TABLE_NAME.test(raw) && !(dynamic && buildsListingNames(body))) continue;
    const table = dynamic ? '<dynamic>' : raw;
    const tail = m[2].toLowerCase();

    if (/alter\s+(?:column\s+)?"?id"?\s+add\s+generated\b/.test(tail)) {
      out.push({ table, what: 'converts id to an IDENTITY column — every FUTURE `LIKE … INCLUDING ALL` clone then gets its OWN sequence' });
    }
    const setDefault = /alter\s+(?:column\s+)?"?id"?\s+set\s+default\s+([\s\S]*)$/.exec(tail);
    if (setDefault) {
      const seq = /nextval\(\s*'(?:public\.)?([a-z0-9_]+)'/.exec(setDefault[1]);
      if (!seq || seq[1] !== FLEET_SEQUENCE) {
        out.push({ table, what: `re-points the id default away from nextval('${FLEET_SEQUENCE}')` });
      }
    }
    if (/alter\s+(?:column\s+)?"?id"?\s+drop\s+default\b/.test(tail)) {
      out.push({ table, what: 'drops the id default — inserts stop drawing from the fleet sequence' });
    }
  }
  return out;
}
