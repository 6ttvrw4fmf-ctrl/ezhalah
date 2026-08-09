// TRIPWIRE: the rental PERIOD must come only from the source — never calculated, never guessed,
// never manufactured from the platform name.
//
// OWNER PERMANENT RULE (2026-08-09):
//   source monthly → Monthly · source annual → Annual · annual + instalments/RNPL → ANNUAL
//   daily/weekly only → not Monthly · source silent → Unknown
//   Never calculate or guess the rental period. Never use the platform name to manufacture it.
//
// WHY THIS EXISTS — three real defects found in the 2026-08-09 Monthly audit:
//
//  1. PLATFORM NAME DECIDED THE PERIOD. sync_payment_monthly() carried
//     `or s.platform in ('gathern','aqarmonthly')`, making every row from those platforms Monthly
//     regardless of what the source said. It happened to be redundant (all their rows already
//     carried شهري) — but the day a scrape fails to record a period, it FABRICATES one.
//
//  2. THE RNPL EXCLUSION ONLY COVERED AQAR RESIDENTIAL. "Annual rent payable in monthly
//     instalments" is an ANNUAL contract. The old body joined aqar_residential_listings for the
//     flag, and joined aqar_commercial_listings but never read it — so aqar's own commercial RNPL
//     row was unguarded, and alhoshan (which also publishes RNPL) was covered only by accident.
//
//  3. souq24 WROTE A MONTHLY PRICE INTO THE ANNUAL COLUMN. price_annual is divided by 12 for the
//     card, so «5,000 شهري» rendered as 417/mo. Live-verified on ads 1106/1117/1208.
//     price_annual = monthly×12 is a STORAGE UNIT CONVERSION, not derivation — the displayed
//     number must equal the source's number exactly.
//
// Offline + static: replays the repo's migrations exactly as Supabase would and reads the scraper
// source. No DB, no network.
//
//   node --experimental-strip-types scripts/verify-rental-period-is-source-truth.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── the EFFECTIVE sync_payment_monthly(): the LAST migration that defines it wins on replay ──────
const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const defining = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.sync_payment_monthly/i
    .test(readFileSync(join(MIGRATIONS, f), 'utf8')));

check('sync_payment_monthly() is defined by at least one migration in the repo', defining.length > 0,
  'if this fails the drift gate or a lost mirror is the real problem');

if (defining.length) {
  const last = defining[defining.length - 1];
  const full = readFileSync(join(MIGRATIONS, last), 'utf8');
  // body only — the file's own explanatory comments name the retired patterns on purpose
  const body = full.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  console.log(`      (effective definition: ${last})`);

  check('1. PLATFORM NAME never decides the period — no `platform in (...)` in the body',
    !/s\.platform\s+in\s*\(/i.test(body),
    'a platform-name clause fabricates a period for any row whose scrape recorded none');
  check('1b. …and no platform is named at all in the body',
    !/'(gathern|aqarmonthly|aqar|wasalt|dealapp|sanadak|souq24|mustqr)'/i.test(body));

  check('2. the period comes from the row\'s OWN recorded rent_period_ar',
    /s\.rent_period_ar\s*=\s*'شهري'/.test(body));
  check('2b. RNPL is excluded from the row itself (fleet-wide), not via a per-platform join',
    /not\s+coalesce\(\s*s\.rent_now_pay_later\s*,\s*false\s*\)/i.test(body),
    'reading a single platform\'s table leaves every other platform unguarded');
  check('2c. no single-platform join is used to source the RNPL flag',
    !/join\s+aqar_(residential|commercial)_listings/i.test(body));
  check('2d. Monthly still requires a RENTAL (deal = إيجار)',
    /s\.deal_ar\s*=\s*'إيجار'/.test(body));
}

// ── 2e. THE TRIGGER — the writer that actually has the last word ─────────────────────────────────
// enforce_price_size_sanity() is a BEFORE trigger on search_listings_ar. It used to carry an
// UNCONDITIONAL `if rent_period_ar='شهري' then payment_monthly := true`, which ignored RNPL and
// silently overrode sync_payment_monthly() on the very UPDATE that tried to correct a row — the
// sweep even reported "1 row corrected" while nothing changed. Fixing the sweep alone was NOT
// enough. Both writers must carry the SAME predicate or the guard is inverted by whichever runs
// last. (Caught behaviourally 2026-08-09 on aqar id 23235.)
{
  const trigFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /create\s+or\s+replace\s+function\s+public\.enforce_price_size_sanity/i
      .test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  check('2e. enforce_price_size_sanity() is defined by a migration in the repo', trigFiles.length > 0);
  if (trigFiles.length) {
    const t = readFileSync(join(MIGRATIONS, trigFiles[trigFiles.length - 1]), 'utf8')
      .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    check('2f. the trigger NEVER force-sets payment_monthly := true unconditionally',
      !/rent_period_ar\s*=\s*'شهري'\s*then\s*\n?\s*NEW\.payment_monthly\s*:=\s*true\s*;/i.test(t),
      'an unconditional force here silently defeats the RNPL exclusion on every write');
    check('2g. the trigger applies the SAME RNPL predicate as sync_payment_monthly()',
      /NEW\.payment_monthly\s*:=\s*not\s+coalesce\(\s*NEW\.rent_now_pay_later\s*,\s*false\s*\)/i.test(t));
    check('2h. the trigger still maps سنوي → not monthly',
      /rent_period_ar\s*=\s*'سنوي'[\s\S]{0,80}?payment_monthly\s*:=\s*false/i.test(t));
  }
}

// ── 3. the ×12 storage convention, per scraper that stores a monthly-labelled price ──────────────
const scraperSrc = (p: string) => readFileSync(join(import.meta.dirname, '..', 'scrapers', p), 'utf8');
{
  const s = scraperSrc('souq24/run.py');
  const code = s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  check('3. souq24 converts a source MONTHLY price to the annual storage unit (×12)',
    /src_rent_period\s*==\s*"monthly"[\s\S]{0,120}?price\s*\*\s*12/.test(code),
    'without it the card shows one twelfth of the published monthly rent');
  check('3b. souq24 stores an ANNUAL source price unchanged',
    /src_rent_period\s*==\s*"annual"[\s\S]{0,80}?=\s*price\b/.test(code));
  check('3c. souq24 no longer writes the raw price straight into price_annual',
    !/"price_annual":\s*price if is_rent else None/.test(code));
  check('3d. daily/weekly are NOT annualised (no ×365 / ×52 invention)',
    !/\*\s*365\b/.test(code) && !/\*\s*52\b/.test(code));
}
{
  // the platforms that already had the convention must keep it
  for (const [file, label] of [['gathern/run.py', 'gathern'], ['aqarmonthly/run.py', 'aqarmonthly']] as const) {
    const code = scraperSrc(file).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    check(`3e. ${label} keeps the monthly×12 storage convention`,
      /\*\s*12\b/.test(code));
  }
}

// ── 4. the search layer still buckets Monthly on payment_monthly, not on a platform ──────────────
{
  const rpcFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /create\s+or\s+replace\s+function\s+public\.location_search_candidates_ar/i
      .test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  if (rpcFiles.length) {
    const body = readFileSync(join(MIGRATIONS, rpcFiles[rpcFiles.length - 1]), 'utf8')
      .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    check('4. the search RPC buckets شهري on s.payment_monthly (the audited flag)',
      /p_rent_period\s*=\s*'شهري'\s+and\s+s\.payment_monthly\s*=\s*true/i.test(body));
    check('4b. the search RPC never buckets a rent period by platform name',
      !/p_rent_period[\s\S]{0,200}?s\.platform\s+in\s*\(/i.test(body));
  }
}

console.log(failures === 0
  ? '\n✓ rental period = source truth — no platform-name manufacture, RNPL excluded fleet-wide, ×12 is storage-only\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
