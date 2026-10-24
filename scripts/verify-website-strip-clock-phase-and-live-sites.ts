// THE WEBSITE STRIP RUNS ON THE WALL CLOCK AND SHOWS ONLY SITES THAT CAN ANSWER (owner 2026-10-09 r3).
//
// «when I refresh, Aqar shows — not nice; it should always have that rotation» · «when the user changes
// to الوسيط الذكي it should feel like a smooth transition — a continuation of the animation».
// Before this the track always started at translateX 0, so every refresh opened on the same first
// logos, and the AI landing had no strip at all. Now the loop's position is a pure function of the
// clock (src/components/homeWebsiteStripShared.ts): a refresh lands mid-rotation, and the Filter home
// and the AI landing — mounted at the same moment — show the same logos in the same place, so the mode
// switch reads as one strip that never stopped. The strip also filters its names through the picker's
// own rule (pickerMayOffer): a down or empty site never scrolls past.
//
// EXECUTED: the real stripPhase is lifted and run against the clock; the wiring (filter, re-filter when
// the live list lands, both strip variants on the clock, the AI landing gated like its title) is checked
// in the sources; mutation proofs run a broken phase / an unfiltered strip / an ungated landing through
// the same checks.
//   node --experimental-strip-types scripts/verify-website-strip-clock-phase-and-live-sites.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const SHARED = join(ROOT, 'src/components/homeWebsiteStripShared.ts');
const SHARED_SRC = readFileSync(SHARED, 'utf8');
const WEB = readFileSync(join(ROOT, 'src/components/HomeWebsiteStrip.web.tsx'), 'utf8');
const NATIVE = readFileSync(join(ROOT, 'src/components/HomeWebsiteStrip.tsx'), 'utf8');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
const HOME = readFileSync(join(ROOT, 'src/app/index.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type Phase = (nowMs: number, cycleWidth: number) => number;
const lift = async (file: string): Promise<Phase> =>
  (await liftSymbols(file, [{ header: 'export const STRIP_SPEED', endsWith: /;$/ }, { header: 'export function stripPhase(' }], ['stripPhase'])).stripPhase as Phase;

// 143 sites × 108px on 2026-10-09; the clock value is a real Date.now() of that day.
const CYCLE = 143 * 108;
const T = 1791234567890;
const problems = (phase: Phase): string[] => {
  const out: string[] = [];
  if (phase(T, CYCLE) !== phase(T, CYCLE)) out.push('two mounts at the same instant disagree (the Filter home and the AI landing would jump)');
  for (const t of [T, T + 1, T + 999, T + 86_400_000]) {
    const p = phase(t, CYCLE);
    if (!(p >= 0 && p < CYCLE)) out.push(`phase ${p} is outside one cycle at t=${t}`);
  }
  const advance = ((phase(T + 9000, CYCLE) - phase(T, CYCLE)) % CYCLE + CYCLE) % CYCLE;
  if (Math.abs(advance - 108) > 1e-6) out.push(`9 s on the clock moved the strip ${advance.toFixed(3)}px, not one 108px slot (12 px/s)`);
  if (Math.floor(phase(T, CYCLE) / 108) === Math.floor(phase(T + 9000, CYCLE) / 108)) out.push('two loads 9 s apart open on the same logo');
  if (phase(T, 0) !== 0) out.push('an empty site list breaks the phase (NaN)');
  return out;
};

const real = problems(await lift(SHARED));
check('the strip phase is the wall clock at 12 px/s: same instant ⇒ same place, 9 s ⇒ one slot', real.length === 0, real.join('\n      '));

const filtered = (src: string) =>
  /ALL_NAMES\.filter\(\(name\) => pickerMayOffer\(name, liveNames, downNames\)\)/.test(src)
  && /const liveNames = livePickerNames\(\);/.test(src) && /const downNames = hiddenPlatformNames\(\);/.test(src);
check('the strip names go through pickerMayOffer with the live + down lists (the picker\'s rule)', filtered(SHARED_SRC));
check('the strip re-filters when the live list lands', /void loadLivePickerNames\(\)\.then\(\(\) => \{ if \(alive\) setLiveTick/.test(SHARED_SRC));
check('the web strip takes its names and its every-frame position from the shared clock contract',
  /useStripNames\(\)/.test(WEB) && /stripWindow\(stripPhase\(Date\.now\(\), cycleWidth\), n\)/.test(WEB));
// SMALL WINDOW (owner iPhone screenshot 2026-10-22: lower half of Home painted white). The track must mount
// only STRIP_WINDOW logos, never every logo twice (a ~32,000 px will-change layer iOS Safari drops tiles for).
// EXECUTED: the window's start × slot + offset must equal the clock phase, so the strip is where the clock says.
{
  const lifted = await liftSymbols(join(ROOT, 'src/components/HomeWebsiteStrip.web.tsx'),
    [{ header: 'export function stripWindow(' }], ['stripWindow'], 'const STRIP_SLOT = 108;');
  const win = lifted.stripWindow as (p: number, n: number) => { start: number; offset: number };
  const n = 149, cyc = n * 108;
  const places = [0, 1, 107.9, 108, 5000.5, cyc - 0.5].every((p) => { const w = win(p, n); return Math.abs(w.start * 108 + w.offset - p) < 1e-6 && w.offset >= 0 && w.offset < 108 && w.start < n; });
  check('the window sits exactly where the clock phase says (start × slot + offset = phase)', places);
  check('a missing list is a still, empty strip — never NaN', JSON.stringify(win(NaN, n)) === '{"start":0,"offset":0}' && JSON.stringify(win(500, 0)) === '{"start":0,"offset":0}');
  const smallTrack = (src: string) => /Array\.from\(\{ length: STRIP_WINDOW \}/.test(src) && !/\[0, 1\]\.map\(copy =>/.test(src);
  check('the web track mounts only STRIP_WINDOW logos, not the whole loop twice', smallTrack(WEB));
  check('(mutation) catches the 32,000 px two-copy track coming back', !smallTrack(`${WEB}\n{[0, 1].map(copy => names.map(...))}`));
}
check('the web strip stays invisible until the client knows the phase (no first-logos flash on a static page)', /opacity: phase === null \? 0 : 1/.test(WEB));
check('the web strip under reduced motion is static AT the phase (no frame loop; the slide is set once)',
  /if \(phase === null \|\| reduced \|\| !n\) return;/.test(WEB) && /offsetRef\.current = w\.offset;\s*setPhase\(p\);/.test(WEB));
check('the native strip takes its names and phase from the shared contract', /useStripNames\(\)/.test(NATIVE) && /motion\.setValue\(-phase\)/.test(NATIVE) && /stripPhase\(Date\.now\(\), cycleWidth\)/.test(NATIVE));
const landingGated = (src: string) => /\{introLanding \? <View style=\{s\.landingStrip\}><HomeWebsiteStrip \/><\/View> : null\}/.test(src) && /if \(!introLanding\) return null;/.test(src);
check('the AI landing renders the same strip, gated by the landing-title flag (introLanding)', landingGated(AGENT));
check('the Filter home still renders the strip', /<HomeWebsiteStrip \/>/.test(HOME));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = async (what: string, from: string, to: string) => {
  if (!SHARED_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'strip-phase-')), 'homeWebsiteStripShared.ts');
  writeFileSync(file, SHARED_SRC.replace(from, to));
  const caught = problems(await lift(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
const FORMULA = 'return cycleWidth > 0 ? ((nowMs / 1000) * STRIP_SPEED) % cycleWidth : 0;';
await mustCatch('a strip that always starts at the first logos again', FORMULA, 'return 0;');
await mustCatch('a per-mount start (two screens would disagree)', FORMULA, 'return cycleWidth > 0 ? ((nowMs / 1000) * STRIP_SPEED + performance.now() * 1e6) % cycleWidth : 0;');
await mustCatch('the wrong speed', FORMULA, 'return cycleWidth > 0 ? ((nowMs / 1000) * 24) % cycleWidth : 0;');
const unfilteredCaught = !filtered(SHARED_SRC.replace('ALL_NAMES.filter((name) => pickerMayOffer(name, liveNames, downNames))', 'ALL_NAMES'));
if (!unfilteredCaught) failed++;
console.log(`${unfilteredCaught ? 'PASS' : 'FAIL'}  (mutation) catches the strip showing every site again`);
const ungatedCaught = !landingGated(AGENT.replace('{introLanding ? <View style={s.landingStrip}><HomeWebsiteStrip /></View> : null}', '<View style={s.landingStrip}><HomeWebsiteStrip /></View>'));
if (!ungatedCaught) failed++;
console.log(`${ungatedCaught ? 'PASS' : 'FAIL'}  (mutation) catches the strip staying on a conversation with results`);

console.log(failed === 0 ? '\n✅ the website strip runs on the clock, on both screens, and shows only sites that can answer.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
