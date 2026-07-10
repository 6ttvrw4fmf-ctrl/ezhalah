#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// GATHERN-IS-RENT-ONLY TRIPWIRE — OFFLINE (compliance invariant #3, build-time half)
//
// Runs before every production build (`npm run verify` → vercel.json buildCommand). Deterministic and
// fully OFFLINE — it inspects the CODE being deployed, so it can only fail on a real regression, never on
// live-data drift or a Supabase blip.
//
// HARD REQUIREMENT (CLAUDE.md / PRD §7): "Gathern is rent-only — it must never appear in Buy results."
// Aqar Monthly is the same (monthly-only). The BINDING guarantee is in the code: gathern/aqarmonthly are
// never in the search table set on a Buy search, so the RPC is never even asked for them. That is exactly
// what this guards. (The complementary DATA-hygiene check — "zero gathern/aqarmonthly rows tagged
// deal_ar='بيع'" — is a property of live data, not of a deploy, so it runs in the daily cron alarm
// detect_novel_property_types(); see docs/ARCHITECTURE.md §19.1.)
//
// CHECKS (all offline, against src/data/remote.ts):
//   1. The always-on base sets RES_TABLES / COM_TABLES contain no gathern/aqarmonthly table.
//   2. resTables() adds them ONLY under the monthly-rent gate (deal==='Rent' && rentPeriod==='monthly').
//   3. tablesFor() (which builds the RPC's p_tables) sources residential tables via resTables() and never
//      splices a monthly-only table in directly — so the gate is the single chokepoint.
// (The by-id deep-link lookup fetchListingById() legitimately scans every table incl. gathern; it runs NO
//  deal filter and returns one known listing, so it can't leak a Buy result and is intentionally out of scope.)
// ─────────────────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOTE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/remote.ts');

const fail = (msg: string): never => {
  console.error(`\n❌ GATHERN-RENT-ONLY TRIPWIRE FAILED: ${msg}\n   Deployment blocked until fixed.`);
  process.exit(1);
};

function main() {
  const src = readFileSync(REMOTE_PATH, 'utf8');

  // 1) The always-on base table sets must NOT contain any monthly-only table.
  for (const name of ['RES_TABLES', 'COM_TABLES']) {
    const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) fail(`could not locate the ${name} array in remote.ts — guard cannot verify (refactor?)`);
    if (/gathern|aqarmonthly/.test(m[1]))
      fail(`${name} (always read on Buy searches) contains a gathern/aqarmonthly table — it would surface in Buy results`);
  }

  const fnBody = (name: string): string => {
    const m = src.match(new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`));
    if (!m) fail(`could not locate ${name}() in remote.ts — guard cannot verify (refactor?)`);
    return m[0];
  };

  // 2) resTables() may add the monthly-only tables, but ONLY behind the monthly-rent gate.
  const resBody = fnBody('resTables');
  const gated = /deal\s*===\s*'Rent'/.test(resBody) && /rentPeriod\s*===\s*'monthly'/.test(resBody);
  const addsMonthly = /gathern_residential_listings/.test(resBody) && /aqarmonthly_residential_listings/.test(resBody);
  if (addsMonthly && !gated)
    fail(`resTables() adds gathern/aqarmonthly tables but no longer gates them behind (deal==='Rent' && rentPeriod==='monthly') — Buy could now include rent-only sources`);

  // 3) tablesFor() builds the RPC's p_tables. Residential tables MUST come from the gated resTables(q),
  //    and it must not splice in a monthly-only table directly (which would bypass the gate).
  const forBody = fnBody('tablesFor');
  if (!/resTables\s*\(/.test(forBody))
    fail(`tablesFor() no longer sources residential tables from resTables(q) — the monthly-rent gate is bypassed, Buy could include gathern/aqarmonthly`);
  if (/'(?:gathern|aqarmonthly)_[a-z_]*listings'/.test(forBody))
    fail(`tablesFor() references a gathern/aqarmonthly table literal directly (bypassing the resTables() gate)`);

  console.log('✓ code: RES_TABLES/COM_TABLES exclude gathern/aqarmonthly; resTables() gates them behind monthly-rent; tablesFor() sources res tables via resTables()');
  console.log('\n✅ Gathern-rent-only tripwire passed (offline) — no code path can feed a Gathern/Aqar-Monthly table into a Buy search.');
}

main();
