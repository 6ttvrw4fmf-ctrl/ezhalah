// PERMANENT BARRIER — a listing table that mints its own ids breaks the only thing the card-open
// path and every card-evidence check have to hold a card to its row (2026-09-24, routine-10-barrier,
// ops_incident #660).
//
// The full statement of what is asserted and why, including the two silent ways to lose it, lives in
// scripts/lib/listingIdSequence.ts. In one paragraph: `src/data/remote.ts`'s LISTING_CACHE is a
// `Map<number, Listing>` keyed on a PER-TABLE primary key, and `ResultCard.tsx` gives each card the
// DOM identity `card-listing-${listing.id}` from that same number. Across 143 listing tables those
// numbers only fail to collide because every table in the tree is cloned with
// `LIKE <sibling> INCLUDING ALL`, which copies the template's `nextval('aqar_residential_listings_id_seq')`
// default verbatim. Measured on production 2026-09-24: 143 of 143 tables carry exactly that default,
// attidentity is empty on all of them, and 233,815 production_ready rows hold 233,815 distinct ids.
//
// THIS IS MISSING COVERAGE, NOT A LIVE DEFECT, and it is reported as such. The invariant holds. What
// did not exist, before this file, was anything that would notice the day it stopped: a grep of
// scripts/ for the shared sequence or for the uniqueness property returned zero barriers. The first
// symptom would have been a user opening card A and being shown listing B from a different platform.
//
// WHAT IS JUDGED: COMMITTED MIGRATIONS. Two rules, and the second is the one a reviewer would not
// think to write:
//   1. every CREATE of a fleet listing table draws its id from the fleet sequence;
//   2. NOTHING re-points, drops or identity-ifies the id default on a fleet listing table —
//      INCLUDING the template `aqar_residential_listings` itself, because `INCLUDING ALL` implies
//      `INCLUDING IDENTITY` and INCLUDING IDENTITY mints a PRIVATE sequence. A "modernise serial →
//      identity" migration aimed at the template alone would leave all 143 existing tables correct
//      and quietly privatise every future clone.
//
//   node --experimental-strip-types scripts/verify-listing-ids-draw-from-one-sequence.ts
//   (auto-discovered into `npm test` by scripts/lib/testRegistry.ts)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executedSql } from './lib/repairClassifier.ts';
import {
  FLEET_SEQUENCE, LISTING_TABLE_NAME, listingTableCreations, idProvenance,
  idProvenanceRedefinitions, stripSqlCommentsStrict, type ListingCreation,
} from './lib/listingIdSequence.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

// A FLOOR on discovery, not a list. If a future refactor of the reader stops recognising the
// template form, this goes red instead of quietly finding nothing to judge — the failure direction
// this repo has been burned by (nine dark detectors reading as a clean bill of health).
//
// 19 is the measured population on 2026-09-24 and it counts STATEMENTS, not tables: eight literal
// creations (amlakalahsa, aqaralsaudia, suwar, rakez — two tables each) plus eleven dynamic
// `EXECUTE format('CREATE TABLE %I (LIKE aqar_residential_listings INCLUDING ALL)')` loops, one of
// which alone builds 22 tables. The two 20260714 files create `…_listings_backup_20260714`
// snapshots `AS SELECT` and correctly contribute nothing. Raise this when a platform lands; it may
// only go up.
const MIN_CREATIONS = 19;

// Nothing is waived. The map exists so that the honest way to accept a future exception is to write
// down why, in the file, where a reviewer sees it — never by loosening the predicate.
const WAIVED: Record<string, string> = {};

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

let creations = 0;
let redefs = 0;
for (const f of files) {
  const raw = readFileSync(join(MIGRATIONS, f), 'utf8');
  const body = executedSql(raw);

  for (const c of listingTableCreations(body)) {
    creations++;
    const v = idProvenance(c);
    if (v.shared) continue;
    if (WAIVED[f]) { ok(`${f}: ${c.target} waived — ${WAIVED[f]}`); continue; }
    fail(
      `${f}: CREATE of ${c.target} does not draw its id from the fleet sequence.\n`
      + `      ${v.reason}\n`
      + `      A private id counter collides with ids already issued fleet-wide. LISTING_CACHE\n`
      + `      (src/data/remote.ts) and card-listing-<id> (src/components/ResultCard.tsx) key on\n`
      + `      that number alone, so the first symptom is a card showing another platform's listing.\n`
      + `      Fix: CREATE TABLE <t> (LIKE aqar_residential_listings INCLUDING ALL), as all 17\n`
      + `      committed platform migrations do.`,
    );
  }

  for (const r of idProvenanceRedefinitions(body)) {
    redefs++;
    fail(
      `${f}: ALTER on ${r.table} ${r.what}.\n`
      + `      Fleet listing ids must keep drawing from nextval('${FLEET_SEQUENCE}').`,
    );
  }
}

if (creations < MIN_CREATIONS) {
  fail(
    `only ${creations} listing-table creation(s) discovered, floor is ${MIN_CREATIONS} — `
    + `the reader has gone blind, not the tree clean`,
  );
} else {
  ok(`${creations} committed listing-table creation(s) judged, all drawing from nextval('${FLEET_SEQUENCE}')`);
}
if (redefs === 0) ok('no committed migration re-points, drops or identity-ifies a fleet listing id default');

// ── MUTATION PROOFS — the predicates are EXECUTED against deliberately broken input ─────────────
// Every input below is the REAL shipped shape with one thing changed, never a shape invented here.

const REAL = readFileSync(join(MIGRATIONS, '20260914070651_suwar_tables_with_rls.sql'), 'utf8');
const REAL_DYNAMIC = readFileSync(join(MIGRATIONS, '20260921185629_eleven_platforms_tables.sql'), 'utf8');

const mustCatch = (what: string, run: () => boolean) => {
  if (run()) ok(`mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

const allShared = (sql: string) =>
  listingTableCreations(executedSql(sql)).every((c) => idProvenance(c).shared);
const someCreation = (sql: string) => listingTableCreations(executedSql(sql)).length > 0;

// The negative control comes FIRST: a predicate that is red for everything proves nothing.
if (allShared(REAL) && someCreation(REAL)) {
  ok('negative control: the REAL suwar migration is not flagged (and is not vacuously unread)');
} else {
  fail('the shipped suwar migration is flagged or unread — the predicate is over-broad or blind');
}
if (allShared(REAL_DYNAMIC) && someCreation(REAL_DYNAMIC)) {
  ok('negative control: the REAL eleven-platform dynamic migration is not flagged');
} else {
  fail('the shipped eleven-platform migration is flagged or unread');
}

mustCatch('a new platform table declared with its own bigserial', () => !allShared(
  REAL.replace(
    /CREATE TABLE public\.suwar_residential_listings \(LIKE[^)]*\);/,
    'CREATE TABLE public.suwar_residential_listings (id bigserial primary key, ad_number text);',
  ),
));

mustCatch('a new platform table declared GENERATED ALWAYS AS IDENTITY', () => !allShared(
  REAL.replace(
    /CREATE TABLE public\.suwar_residential_listings \(LIKE[^)]*\);/,
    'CREATE TABLE public.suwar_residential_listings (id bigint generated always as identity, ad_number text);',
  ),
));

mustCatch("a new platform table pointed at its OWN nextval('suwar_..._id_seq')", () => !allShared(
  REAL.replace(
    /CREATE TABLE public\.suwar_residential_listings \(LIKE[^)]*\);/,
    "CREATE TABLE public.suwar_residential_listings (id bigint not null default nextval('suwar_residential_listings_id_seq'::regclass), ad_number text);",
  ),
));

mustCatch('LIKE without INCLUDING DEFAULTS — the shape copied but not the sequence', () => !allShared(
  REAL.replace(/INCLUDING ALL\)/g, 'INCLUDING CONSTRAINTS INCLUDING INDEXES)'),
));

mustCatch('LIKE … EXCLUDING DEFAULTS', () => !allShared(
  REAL.replace(/INCLUDING ALL\)/g, 'INCLUDING ALL EXCLUDING DEFAULTS)'),
));

mustCatch('the DYNAMIC shape: format(\'CREATE TABLE %I (id bigserial …)\')', () => !allShared(
  REAL_DYNAMIC.replace(
    /\(LIKE aqar_residential_listings INCLUDING ALL\)/,
    '(id bigserial primary key, ad_number text)',
  ),
));

mustCatch('a LIKE whose template is NOT a fleet listing table', () => !allShared(
  REAL.replace(/LIKE public\.abwbna_residential_listings/g, 'LIKE public.some_staging_scratch'),
));

mustCatch('a decoy: the LIKE clause surviving only in a trailing -- comment', () => !allShared(
  REAL.replace(
    /CREATE TABLE public\.suwar_residential_listings \(LIKE[^)]*\);/,
    'CREATE TABLE public.suwar_residential_listings (id bigserial primary key, ad_number text);'
    + '  -- was: (LIKE public.abwbna_residential_listings INCLUDING ALL)',
  ),
));

mustCatch('a decoy: the LIKE clause surviving only in a /* block */ comment', () => !allShared(
  REAL.replace(
    /CREATE TABLE public\.suwar_residential_listings \(LIKE[^)]*\);/,
    '/* CREATE TABLE public.suwar_residential_listings (LIKE public.abwbna_residential_listings INCLUDING ALL); */'
    + ' CREATE TABLE public.suwar_residential_listings (id bigserial primary key, ad_number text);',
  ),
));

// ── The second rule: an ALTER that privatises an EXISTING table, template included ──────────────
const redefsIn = (sql: string) => idProvenanceRedefinitions(executedSql(sql)).length > 0;

mustCatch(
  'the delayed fleet-wide one: converting the TEMPLATE to an identity column',
  () => redefsIn("ALTER TABLE public.aqar_residential_listings ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;"),
);
mustCatch('re-pointing one table\'s id default at its own sequence', () =>
  redefsIn("ALTER TABLE suwar_residential_listings ALTER COLUMN id SET DEFAULT nextval('suwar_id_seq'::regclass);"));
mustCatch('dropping a listing table\'s id default', () =>
  redefsIn('ALTER TABLE suwar_commercial_listings ALTER COLUMN id DROP DEFAULT;'));
mustCatch('the dynamic ALTER shape inside a listings migration', () =>
  redefsIn("DO $$ BEGIN EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY', p || '_residential_listings'); END $$;"));

// …and the redefinition reader is not vacuously red, twice over.
if (!redefsIn("ALTER TABLE suwar_residential_listings ALTER COLUMN id SET DEFAULT nextval('aqar_residential_listings_id_seq'::regclass);")) {
  ok('negative control: re-stating the FLEET sequence as the default is not flagged');
} else {
  fail('setting the id default to the fleet sequence is flagged — the reader is over-broad');
}
if (!redefsIn('ALTER TABLE suwar_residential_listings ALTER COLUMN price SET DEFAULT 0;')) {
  ok('negative control: an ALTER on a non-id column is not flagged');
} else {
  fail('an unrelated column ALTER is flagged — the reader is over-broad');
}
if (!redefsIn("ALTER TABLE ops_incident ALTER COLUMN id SET DEFAULT nextval('other_seq'::regclass);")) {
  ok('negative control: a NON-listing table\'s id is none of this barrier\'s business');
} else {
  fail('a non-listing table is flagged — the reader is over-broad');
}

// A definition the reader cannot parse must read as UNKNOWN → not shared, never as healthy.
{
  const unreadable: ListingCreation = { target: 'x_residential_listings', body: 'ad_number text', dynamic: false };
  if (!idProvenance(unreadable).shared) ok('fail-closed: a creation with no id and no LIKE reads as NOT shared');
  else fail('a definition the reader cannot resolve reads as healthy — unknown→NO');
}
// And the anchors hold: a backup snapshot table is not swept in, a real one is.
if (!LISTING_TABLE_NAME.test('toor_residential_listings_backup_20260714')
    && LISTING_TABLE_NAME.test('suwar_commercial_listings')) {
  ok('the table anchor admits suwar_commercial_listings and refuses the _backup_ snapshot');
} else {
  fail('LISTING_TABLE_NAME does not distinguish a served table from a backup snapshot');
}
// The strict strip really removes a trailing comment (the polarity that matters here).
if (!/INCLUDING ALL/.test(stripSqlCommentsStrict('CREATE TABLE x (id bigserial); -- LIKE y INCLUDING ALL'))) {
  ok('stripSqlCommentsStrict removes a TRAILING -- comment, so a decoy cannot rescue a creation');
} else {
  fail('a trailing -- comment survives the strip');
}

console.log(
  failures === 0
    ? `\n✅ verify-listing-ids-draw-from-one-sequence: ${creations} creation(s) judged, all on nextval('${FLEET_SEQUENCE}')`
    : `\n❌ verify-listing-ids-draw-from-one-sequence: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
