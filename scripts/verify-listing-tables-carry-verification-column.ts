// A new listing table may not omit `last_verified_alive_at` (owner-approved, 2026-08-30).
//
// THE GAP THIS CLOSES. Migration 20260830183939 added the column to all 67 existing listing tables
// and proved coverage inside its own DO block. But that proof was a point-in-time assertion about
// the fleet as it stood. The 68th table — a new platform onboarded next month by whoever, human or
// agent — inherits nothing from it. Without this check, that table quietly ships with no way to
// distinguish "the crawler saw it" from "the source proved it alive", which is the exact blind
// spot the column was added to remove, reintroduced one platform at a time.
//
// WHY IT READS MIGRATIONS RATHER THAN THE LIVE DATABASE. `npm test` is a required check on every
// PR and has no production credentials; a live check here would either fail closed on every
// unrelated PR or need secrets in the JS suite. The repo already settled this shape for
// verify-migration-drift-vs-production.ts, which is deliberately kept OUT of npm test for the same
// reason. So this barrier catches the defect where it is introduced — in the migration that
// creates the table — at PR time, before it ever reaches production.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-listing-tables-carry-verification-column: a new listing table must be able to');
console.log('  say "the source proved this alive", not only "the crawler saw it".');

// The migration that established the column fleet-wide. Tables created BEFORE it are covered by
// its own loop; only migrations at or after it must carry the column inline.
const BASELINE = '20260830183939';

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
check('migrations directory is readable', files.length > 0, `${files.length} files`);

const establishing = files.find((f) => f.startsWith(BASELINE));
check('the establishing migration is mirrored in the repo', Boolean(establishing),
  establishing ?? `no file starting ${BASELINE} — the fleet-wide add is missing from git`);

if (establishing) {
  const src = readFileSync(join(MIGRATIONS, establishing), 'utf8');
  check('it adds the column to every listing table by iterating the fleet',
    /add column if not exists last_verified_alive_at timestamptz/i.test(src)
    && /_\(residential\|commercial\)_listings\$/.test(src));
  check('it proves coverage instead of assuming it (raises when incomplete)',
    /coverage INCOMPLETE/.test(src) && /raise exception/i.test(src));
  check('it refuses to ship a backfill',
    /was BACKFILLED/.test(src),
    'a value copied from last_seen_at is a verification that never happened');
}

// Any migration at/after the baseline that CREATES a listing table must give it the column.
//
// Extracted as a pure function of (filename, content, baseline) so the mutation proofs below can
// feed it CONSTRUCTED migration text — the real repo's migrations are already clean (checked above),
// so proving this detector actually WORKS requires a deliberately broken input, not the real fleet.
export function findOffenders(
  files: { name: string; src: string }[],
  baseline: string,
): string[] {
  const offenders: string[] = [];
  for (const { name: f, src } of files) {
    const version = f.slice(0, 14);
    if (!/^\d{14}$/.test(version) || version < baseline) continue;

    // `create table [if not exists] [public.]<platform>_{residential,commercial}_listings ( … )`
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+_(?:residential|commercial)_listings)"?\s*\(/gi;
    for (const m of src.matchAll(re)) {
      const table = m[1];
      // Look at the statement body from the CREATE onward; the column may also be added by a
      // follow-up ALTER in the same migration, which is equally fine.
      const body = src.slice(m.index ?? 0);
      const stmt = body.slice(0, body.indexOf(';') + 1 || undefined);
      const hasInline = /last_verified_alive_at/i.test(stmt);
      const hasAlter = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?"?${table}"?[\\s\\S]{0,400}?last_verified_alive_at`, 'i',
      ).test(src);
      // `LIKE <another listing table> INCLUDING ALL` inherits every column the source table has,
      // last_verified_alive_at included (confirmed live 2026-09-12: amlakalahsa_residential_listings
      // carries it via this exact clause). This repo's own newest-platform onboarding pattern does
      // the same clone dynamically (format('… LIKE %I INCLUDING ALL', …) in
      // 20260906155543_add_1_green_platform_tables_abwbna.sql and its siblings) — invisible to this
      // regex entirely, so a LITERAL LIKE clause (visible) is held to no stricter a standard than
      // the dynamic one already is. This does NOT verify the SOURCE table itself carries the column
      // — a text-only check has no way to without a live query (see file header) — so a future
      // migration that LIKEs a source genuinely missing it would slip past this one check; that
      // narrower gap needs a live schema audit, not this offline barrier.
      const hasLike = /like\s+(?:public\.)?"?[a-z0-9_]+_(?:residential|commercial)_listings"?\s+including\s+all/i.test(stmt);
      if (!hasInline && !hasAlter && !hasLike) offenders.push(`${f} → ${table}`);
    }
  }
  return offenders;
}

const offenders = findOffenders(files.map((f) => ({ name: f, src: readFileSync(join(MIGRATIONS, f), 'utf8') })), BASELINE);

check('every listing table created since the baseline carries last_verified_alive_at',
  offenders.length === 0,
  offenders.length
    ? `MISSING COLUMN: ${offenders.join('; ')} — add ` +
      '`last_verified_alive_at timestamptz` to the table. Without it the platform cannot tell ' +
      'crawler presence from proven liveness, which is the blind spot 20260830183939 removed.'
    : 'none created since the baseline');

// The contract's write-gate must still exist, or the column would be writable from anywhere.
const contract = readFileSync(join(ROOT, 'scrapers', 'common', 'liveness_contract.py'), 'utf8');
check('the contract still gates the column behind proven-alive evidence',
  /def verification_patch\(/.test(contract) && /if decision\.verified_alive else \{\}/.test(contract));
check('crawler presence still cannot stamp it unless a platform declares it',
  /def presence_patch\(/.test(contract) && /if policy\.presence_is_positive_evidence else \{\}/.test(contract));

console.log(
  failures === 0
    ? '\n✅ verify-listing-tables-carry-verification-column: all checks passed.'
    : `\n❌ verify-listing-tables-carry-verification-column: ${failures} check(s) failed.`,
);
if (failures > 0) process.exit(1);

// ═══ MUTATION PROOFS ════════════════════════════════════════════════════════════════════════════
// The real fleet is already clean (checked above), so proving findOffenders() actually works needs
// a DELIBERATELY constructed migration — the 68th table the header warns about, reintroduced here
// as input rather than waited for in production.
console.log('\n── mutation proofs — a new table onboarded without the column ─────────────────────');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const AFTER = '20260901000000';   // any version string > BASELINE

// ── the exact defect this barrier exists for: a new table, no column, no alter ────────────────────
mustCatch('a new platform table created after the baseline with NO last_verified_alive_at at all',
  findOffenders([{
    name: `${AFTER}_onboard_newplatform.sql`,
    src: `create table if not exists public.newplatform_residential_listings (\n  id bigint,\n  price_total numeric\n);`,
  }], BASELINE).length === 1);

// ── negative control: the inline column present ────────────────────────────────────────────────
mustCatch('…while a table WITH the inline column is NOT flagged (negative control)',
  findOffenders([{
    name: `${AFTER}_onboard_newplatform.sql`,
    src: `create table if not exists public.newplatform_residential_listings (\n  id bigint,\n  last_verified_alive_at timestamptz\n);`,
  }], BASELINE).length === 0);

// ── negative control: a follow-up ALTER in the same migration is equally fine ──────────────────────
mustCatch('…and a table given the column via a follow-up ALTER in the same migration is NOT flagged (negative control)',
  findOffenders([{
    name: `${AFTER}_onboard_newplatform.sql`,
    src: `create table if not exists public.newplatform_residential_listings (\n  id bigint\n);\n` +
      `alter table public.newplatform_residential_listings add column last_verified_alive_at timestamptz;`,
  }], BASELINE).length === 0);

// ── negative control: pre-baseline tables are grandfathered (the fleet-wide migration covers them) ──
mustCatch('…and a table created BEFORE the baseline with no column is NOT flagged — the fleet-wide add covers it (negative control)',
  findOffenders([{
    name: '20260101000000_ancient_platform.sql',
    src: `create table if not exists public.ancient_residential_listings (\n  id bigint\n);`,
  }], BASELINE).length === 0);

// ── two tables, one clean one not — only the offender is named ────────────────────────────────────
const mixed = findOffenders([{
  name: `${AFTER}_onboard_two_platforms.sql`,
  src: `create table if not exists public.clean_residential_listings (\n  id bigint,\n  last_verified_alive_at timestamptz\n);\n` +
    `create table if not exists public.dirty_residential_listings (\n  id bigint\n);`,
}], BASELINE);
mustCatch('two tables in one migration, only the one missing the column is flagged',
  mixed.length === 1 && mixed[0].includes('dirty_residential_listings'));
mustCatch('…and the clean table in the SAME migration is not swept up by association (negative control)',
  !mixed.some((o) => o.includes('clean_residential_listings')));

// ── commercial tables are covered by the same pattern, not just residential ───────────────────────
mustCatch('a commercial listings table is covered by the same detector, not just residential',
  findOffenders([{
    name: `${AFTER}_onboard_commercial.sql`,
    src: `create table if not exists public.newplatform_commercial_listings (\n  id bigint\n);`,
  }], BASELINE).length === 1);

// ── the real defect this session hit: a literal LIKE-of-a-listing-table clone (no inline mention,
//    no follow-up ALTER) must NOT be flagged — it inherits the column from the source ────────────
mustCatch('…and a table cloned via `LIKE <another listing table> INCLUDING ALL` is NOT flagged (negative control — it inherits the column)',
  findOffenders([{
    name: `${AFTER}_onboard_cloned_platform.sql`,
    src: `create table public.newplatform_residential_listings (like public.abwbna_residential_listings including all);`,
  }], BASELINE).length === 0);

// ── the LIKE exemption must stay SCOPED to listing-table sources, not any LIKE clause at all ──────
mustCatch('…but a table cloned via LIKE of something that is NOT itself a listing table is STILL flagged (the exemption is scoped, not a blanket LIKE pass)',
  findOffenders([{
    name: `${AFTER}_onboard_bad_clone.sql`,
    src: `create table public.newplatform_residential_listings (like public.some_unrelated_config_table including all);`,
  }], BASELINE).length === 1);

console.log('');
if (mutFail) { console.error(`✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log('✓ the offender detector was watched to fail against the defect it exists to catch\n');
