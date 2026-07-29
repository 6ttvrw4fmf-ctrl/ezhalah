// Automated guard — the phone/ID-shaped-price detector must survive in mon_detect_field_integrity.
//
// THE BUG THIS PINS (2026-07-28 P0)
// scrapers/aqar/enrich_residential.py's fallback price pattern `(\d{6,9})\s*[§ر﷼]` treats a BARE «ر»
// (a super-common Arabic letter) as currency, so it captured broker PHONES (05x -> 5xxxxxxxx) and
// REGA/ID artifacts (~100.2M) as Buy prices — 259 active aqar rows displayed e.g. 560,076,490 SAR for
// a plot. Fixed at source (trg_aqar_parse guard) AND watched at runtime: mon_detect_field_integrity()
// raises a P1 `field_integrity_phone_price:<table>` alert if ANY active listing on ANY platform has a
// price in a phone/ID band again.
//
// WHY A MIGRATION-TEXT TEST
// The detector lives only in the live database; a future "full-body-replace" of the function (the
// documented hazard) could paste a stale body back and silently delete the guard. This verifier replays
// the migration directory the way Postgres would — last CREATE OR REPLACE of the function wins — and
// fails if the winning body no longer contains the phone/ID-band check + its P1 raise. Offline (reads
// only the repo's own migration files), matching the other verifiers chained in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-nonprice-price-monitor.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

// Last CREATE OR REPLACE FUNCTION mon_detect_field_integrity across all migrations owns the live body.
function lastBodyOf(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const header = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) {
      const rest = sql.slice(m.index);
      const close = rest.match(/\$function\$\s*;/i);
      found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };
    }
  }
  return found;
}

const def = lastBodyOf('mon_detect_field_integrity');
ok('mon_detect_field_integrity has a committed migration definition', def !== null);

if (def) {
  const b = def.body;
  // The phone/ID artifact bands must be checked (05x mobile [500M,600M] + REGA/ID [100.0M,101.0M]).
  ok('winning body checks the phone-band [500000000,599999999]', /between\s+500000000\s+and\s+599999999/.test(b), def.file);
  ok('winning body checks the ID artifact band [100000000,101000000]', /between\s+100000000\s+and\s+101000000/.test(b), def.file);
  // It must actually RAISE an alert on the phone-price dedup key (not just compute a count).
  ok('winning body raises the field_integrity_phone_price alert', /field_integrity_phone_price:/.test(b), def.file);
  // Both price columns are covered (Buy total + annual rent).
  ok('covers both price_total and price_annual', /price_total\s+between/.test(b) && /price_annual\s+between/.test(b), def.file);
}

console.log(failed === 0 ? '\n✓ non-price (phone/ID) price monitor is present in migrations'
                         : `\n✗ ${failed} check(s) FAILED — the phone/ID-price guard was dropped`);
process.exit(failed === 0 ? 0 : 1);
