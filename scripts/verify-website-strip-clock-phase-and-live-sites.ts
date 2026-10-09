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
  const advance = ((phase(T + 3000, CYCLE) - phase(T, CYCLE)) % CYCLE + CYCLE) % CYCLE;
  if (Math.abs(advance - 108) > 1e-6) out.push(`3 s on the clock moved the strip ${advance.toFixed(3)}px, not one 108px slot (36 px/s)`);
  if (Math.floor(phase(T, CYCLE) / 108) === Math.floor(phase(T + 3000, CYCLE) / 108)) out.push('two loads 3 s apart open on the same logo');
  if (phase(T, 0) !== 0) out.push('an empty site list breaks the phase (NaN)');
  return out;
};

const real = problems(await lift(SHARED));
check('the strip phase is the wall clock at 36 px/s: same instant ⇒ same place, 3 s ⇒ one slot', real.length === 0, real.join('\n      '));

const filtered = (src: string) =>
  /ALL_NAMES\.filter\(\(name\) => pickerMayOffer\(name, liveNames, downNames\)\)/.test(src)
  && /const liveNames = livePickerNames\(\);/.test(src) && /const downNames = hiddenPlatformNames\(\);/.test(src);
check('the strip names go through pickerMayOffer with the live + down lists (the picker\'s rule)', filtered(SHARED_SRC));
check('the strip re-filters when the live list lands', /void loadLivePickerNames\(\)\.then\(\(\) => \{ if \(alive\) setLiveTick/.test(SHARED_SRC));
check('the web strip takes its names and phase from the shared contract (animation-delay = −phase/speed)',
  /useStripNames\(\)/.test(WEB) && /stripPhase\(Date\.now\(\), cycleWidth\)/.test(WEB) && /animationDelay: `\$\{-phase \/ STRIP_SPEED\}s`/.test(WEB));
check('the web strip stays invisible until the client knows the phase (no first-logos flash on a static page)', /opacity: phase === null \? 0 : 1/.test(WEB));
check('the web strip under reduced motion is static AT the phase', /animation: 'none', transform: `translateX\(\$\{-phase\}px\)`/.test(WEB));
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
