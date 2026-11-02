// EVERY ACTIVE PLATFORM DECLARES WHERE ITS MAP PIN LIVES — or the build is red (owner 2026-10-30:
// «this needs serious investigation, fix, and never ever happen again»).
//
// THE INCIDENT CLASS. rakez served 3,660 ads with 0 pins for six weeks. Its project page draws no map, so the
// scraper never looked further — but the site's map page calls a JSON feed naming every project's lat/lng. Nothing
// failed anywhere: a pinless row is valid at every layer, exactly the image-coverage shape (verify-image-coverage-
// ratchet.ts). The only honest guard is a DECLARATION made at onboarding, after looking in all four places (the ad
// page, its embedded JSON / data attributes / network calls, a site-wide map or list feed, the parent project page),
// held to a floor the served index is measured against every hour (mon_detect_pin_coverage_below_floor()).
//
// THE THREE RULES (all offline, no network — this file is in `npm test`):
//   1. COMPLETE — every platform in scripts/image-coverage-baseline.json (the fleet's own declared list, which the live
//      image half keeps equal to production every 6 h) has a row in data/pin-sources.json. Launch checklist box 10.
//   2. HONEST — pin_source ∈ {ad-page, page-json, feed, project-page, partial, none}; a proof URL (the page that shows
//      the pin, or the page proven silent) and the date it was looked at; `none` ⇒ floor 0; every other source ⇒
//      floor ≥ 1 (a site that publishes pins may never be declared at 0 — that IS the rakez shape); `partial` names
//      the share seen in its note.
//   3. ENFORCEABLE — each row's (platform, pin_source, floor) appears as a literal in a committed migration, so the
//      detector's table ops_pin_source_declared cannot disagree with the repo (the same one-direction rule as
//      verify-mirror-md5-is-registered.ts). Raising a floor is a reviewed migration, never a dashboard edit.
//
//   node --experimental-strip-types scripts/verify-pin-capture-declared.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
export const PIN_SOURCES = ['ad-page', 'page-json', 'feed', 'project-page', 'partial', 'none'] as const;
export type PinRow = { pin_source: string; floor_pct: number; proof_url: string; proven_on: string; note?: string };
export type PinDecl = { platforms: Record<string, PinRow> };

export function problems(decl: PinDecl, fleet: string[], migrationText: string): string[] {
  const out: string[] = [];
  const rows = decl?.platforms ?? {};
  for (const p of fleet) if (!rows[p]) out.push(`${p}: active platform with NO pin declaration (look in all 4 places, then declare)`);
  for (const [p, r] of Object.entries(rows)) {
    if (!(PIN_SOURCES as readonly string[]).includes(r.pin_source)) out.push(`${p}: pin_source «${r.pin_source}» is not one of ${PIN_SOURCES.join('|')}`);
    if (!Number.isInteger(r.floor_pct) || r.floor_pct < 0 || r.floor_pct > 100) out.push(`${p}: floor_pct must be an integer 0..100`);
    if (!/^https?:\/\/\S+$/.test(r.proof_url ?? '')) out.push(`${p}: proof_url must be the page that proves the verdict`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.proven_on ?? '')) out.push(`${p}: proven_on must be a YYYY-MM-DD date`);
    if (r.pin_source === 'none' && r.floor_pct !== 0) out.push(`${p}: a proven-silent site has floor 0, not ${r.floor_pct}`);
    if (r.pin_source !== 'none' && r.floor_pct < 1) out.push(`${p}: ${r.pin_source} with floor 0 is the rakez shape — a site that publishes pins needs a floor ≥ 1`);
    if (r.pin_source === 'partial' && !/\d/.test(r.note ?? '')) out.push(`${p}: partial needs the share seen in its note`);
    const literal = `('${p}', '${r.pin_source}', ${r.floor_pct}`;
    if (!migrationText.includes(literal)) out.push(`${p}: ${literal} …) is in no committed migration — the detector's table would disagree with the repo`);
  }
  return out;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const decl: PinDecl = JSON.parse(readFileSync(join(ROOT, 'data', 'pin-sources.json'), 'utf8'));
  const fleet = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts', 'image-coverage-baseline.json'), 'utf8')).platforms);
  const migDir = join(ROOT, 'supabase', 'migrations');
  const migrations = readdirSync(migDir).filter((f) => /_pin_source/.test(f)).map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');

  let failed = 0;
  const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`); };
  const mustCatch = (label: string, mutate: (d: PinDecl) => PinDecl, fleetOf: (f: string[]) => string[] = (f) => f, mig = migrations) => {
    const m = mutate(structuredClone(decl));
    check(`mutant caught: ${label}`, problems(m, fleetOf(fleet), mig).length > 0);
  };

  const live = problems(decl, fleet, migrations);
  check(`every one of ${fleet.length} active platforms declares its pin source honestly, and each row is in a migration`, live.length === 0, live.join('\n      '));
  check('the declaration covers the published-pin sources, not only «none»', Object.values(decl.platforms).some((r) => r.pin_source !== 'none'));
  const first = Object.keys(decl.platforms)[0];
  const pub = Object.entries(decl.platforms).find(([, r]) => r.pin_source !== 'none' && r.pin_source !== 'partial')?.[0] ?? first;
  const silent = Object.entries(decl.platforms).find(([, r]) => r.pin_source === 'none')?.[0];
  mustCatch('an active platform with no row', (d) => { delete d.platforms[first]; return d; });
  mustCatch('a platform launched outside the declaration', (d) => d, (f) => [...f, 'brand-new-site']);
  mustCatch('an unknown pin_source word', (d) => { d.platforms[first].pin_source = 'somewhere'; return d; });
  mustCatch('a publishing site declared at floor 0 (the rakez shape)', (d) => { d.platforms[pub].floor_pct = 0; return d; });
  if (silent) mustCatch('a proven-silent site with a non-zero floor', (d) => { d.platforms[silent].floor_pct = 5; return d; });
  mustCatch('a row with no proof URL', (d) => { d.platforms[first].proof_url = ''; return d; });
  mustCatch('a row with no date', (d) => { d.platforms[first].proven_on = 'yesterday'; return d; });
  mustCatch('partial without the share seen', (d) => { d.platforms[first].pin_source = 'partial'; d.platforms[first].note = 'some'; return d; });
  mustCatch('a floor raised in the repo but in no migration', (d) => { d.platforms[pub].floor_pct = 100; return d; });
  mustCatch('the seed migration deleted', (d) => d, (f) => f, '');
  console.log(failed === 0 ? 'OK: every active platform declares where its map pin lives, and the detector table cannot drift from it' : `${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}
