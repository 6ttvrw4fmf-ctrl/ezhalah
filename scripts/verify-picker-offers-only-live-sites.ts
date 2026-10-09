// THE SITE PICKER NEVER OFFERS A SITE THAT CANNOT ANSWER (owner 2026-10-09: «the websites that are down
// we need to hide them — very important»). Before this, «بحث عميق» listed every brand except logo-only
// ones — sadin, toor, nafithh, dwelleo, aqaralsaudia (dormant/retired) and alhumaidan (active, 0
// listings) each sat there reading «بيانات نطاق العقارات غير متاحة حالياً», and picking one could only
// ever return nothing.
//
// The rule (src/data/pickerLivePlatforms.ts): offer a site only if loader_strip_platforms_ar() — sites
// with ≥1 searchable listing that are not dormant/retired — names it; until that list lands, never
// offer one the down-status list (hiddenPlatformNames) names.
//
// EXECUTED: the real pickerMayOffer is lifted and run; the wiring is checked in agent.tsx and the
// loader; mutation proofs run the broken predicate / the unwired source through the same checks.
//   node --experimental-strip-types scripts/verify-picker-offers-only-live-sites.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const LIB = join(ROOT, 'src/data/pickerLivePlatforms.ts');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
const LIB_SRC = readFileSync(LIB, 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type May = (name: string, live: Set<string> | null, down: Set<string> | null) => boolean;
const lift = async (file: string): Promise<May> =>
  (await liftSymbols(file, [{ header: 'export function pickerMayOffer(' }], ['pickerMayOffer'])).pickerMayOffer as May;

// Production on 2026-10-09: live = strip list, down = dormant/retired statuses.
const LIVE = new Set(['Aqar', 'Wasalt', 'Sanadak']);
const DOWN = new Set(['Toor', 'Sadin']);
const problems = (may: May): string[] => {
  const out: string[] = [];
  if (may('Al Humaidan', LIVE, DOWN)) out.push('an «active» site with ZERO listings (alhumaidan) was offered');
  if (may('Toor', LIVE, DOWN)) out.push('a retired site (toor) was offered');
  if (!may('Aqar', LIVE, DOWN)) out.push('a live site (aqar) was hidden');
  if (may('Toor', null, DOWN)) out.push('before the live list lands, a DOWN site (toor) was offered');
  if (!may('Aqar', null, DOWN)) out.push('before the live list lands, a healthy site was hidden');
  if (!may('Aqar', null, null)) out.push('with nothing known yet, the picker went empty');
  return out;
};

const real = problems(await lift(LIB));
check('a down or empty site is never offered; a live one always is', real.length === 0, real.join('\n      '));

const memo = windowBetween(AGENT, 'const pickerPlatforms = useMemo(', '}, [platformPickerSearch, t, pickerLiveTick]);', 'agent.tsx');
const wired = (memoSrc: string, libSrc: string) =>
  /if \(!pickerMayOffer\(platform\.name, liveNames, downNames\)\) continue;/.test(memoSrc)
  && /const liveNames = livePickerNames\(\);/.test(memoSrc) && /const downNames = hiddenPlatformNames\(\);/.test(memoSrc)
  && /supabase\.rpc\('loader_strip_platforms_ar'\)/.test(libSrc);
check('the picker list filters through pickerMayOffer with the live + down lists', wired(memo, LIB_SRC));
check('the list re-filters when the live list lands (pickerLiveTick)', /void loadLivePickerNames\(\)\.then\(\(\) => \{ if \(alive\) setPickerLiveTick/.test(AGENT));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = async (what: string, from: string, to: string) => {
  if (!LIB_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'picker-live-')), 'pickerLivePlatforms.ts');
  writeFileSync(file, LIB_SRC.replace(from, to));
  const caught = problems(await lift(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatch('offering every site again', 'return liveNames ? liveNames.has(name) : !downNames?.has(name);', 'return true;');
await mustCatch('ignoring the down list before the live list lands', 'return liveNames ? liveNames.has(name) : !downNames?.has(name);', 'return liveNames ? liveNames.has(name) : true;');
const unwiredCaught = !wired(memo.replace('if (!pickerMayOffer(platform.name, liveNames, downNames)) continue;', ''), LIB_SRC);
if (!unwiredCaught) failed++;
console.log(`${unwiredCaught ? 'PASS' : 'FAIL'}  (mutation) catches the picker list no longer filtering`);

console.log(failed === 0 ? '\n✅ the site picker offers only sites that can answer.\n' : `\n❌ ${failed} check(s) failed — a down or empty site can be picked.\n`);
process.exit(failed === 0 ? 0 : 1);
