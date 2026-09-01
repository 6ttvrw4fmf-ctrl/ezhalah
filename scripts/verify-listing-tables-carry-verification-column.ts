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
const offenders: string[] = [];
for (const f of files) {
  const version = f.slice(0, 14);
  if (!/^\d{14}$/.test(version) || version < BASELINE) continue;
  const src = readFileSync(join(MIGRATIONS, f), 'utf8');

  // `create table [if not exists] [public.]<platform>_{residential,commercial}_listings ( … )`
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+_(?:residential|commercial)_listings)"?\s*\(/gi;
  for (const m of src.matchAll(re)) {
    const table = m[1];
    // Look at the statement body from the CREATE onward; the column may also be added by a
    // follow-up ALTER in the same migration, which is equally fine.
    const body = src.slice(m.index ?? 0);
    const hasInline = /last_verified_alive_at/i.test(body.slice(0, body.indexOf(';') + 1 || undefined));
    const hasAlter = new RegExp(
      `alter\\s+table\\s+(?:public\\.)?"?${table}"?[\\s\\S]{0,400}?last_verified_alive_at`, 'i',
    ).test(src);
    if (!hasInline && !hasAlter) offenders.push(`${f} → ${table}`);
  }
}

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
process.exit(failures === 0 ? 0 : 1);
