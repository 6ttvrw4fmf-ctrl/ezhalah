// A 🔊 TAP AGAINST A VOICE THE BROWSER NO LONGER HOLDS SAYS SO OUT LOUD — IT IS NEVER A DEAD CONTROL.
//
//   node --experimental-strip-types scripts/verify-read-aloud-stale-voice-refuses-out-loud.ts   (npm test)
//
// ops_incident #856, discriminated by the journey sweep of 2026-11-09 (run 42624835985, chromium desktop1440):
// the engine reported 0 voices BEFORE and AFTER the tap, the app was never in the speaking state (sampled every
// 50 ms), and no refusal sentence appeared. That is the «stale cached voice» candidate the earlier barrier
// (verify-read-aloud-control-cannot-be-dead.ts) named and left open: bestArabicVoice was confirmed earlier,
// speakReadAloud() returned true, speakUnitText() found no live voice object and ended the session at once — so
// FeedbackRow (which only shows a refusal when the call returns false) showed nothing.
//
// The REAL speakReadAloud, readAloudRefusal and liveVoicePresent are lifted from src/lib/readAloud.ts and the real
// verdict + message from src/lib/readAloudVoice.ts; only the playback plumbing they call is stubbed, and a stub
// that is reached records it (a «started» session is visible). Mutation-proven both ways.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

type Voice = { identifier: string; language: string; name: string };

const voiceLib = await liftSymbols('src/lib/readAloudVoice.ts',
  [{ header: 'export function readAloudRefusalVerdict(' }, { header: 'export function readAloudRefusalMessageKey(' }],
  ['readAloudRefusalVerdict', 'readAloudRefusalMessageKey'],
  "type ReadAloudRefusal = 'none' | 'still-resolving' | 'no-voice-on-device';\n");
(globalThis as any).__verdict = voiceLib.readAloudRefusalVerdict;
const messageKey = voiceLib.readAloudRefusalMessageKey as (r: string) => string | null;

const PRELUDE = `
type Voice = { identifier: string; language: string; name: string };
type ReadAloudRefusal = 'none' | 'still-resolving' | 'no-voice-on-device';
type ReadAloudSegment = { text: string; pauseAfterMs?: number };
type Unit = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number };
const readAloudRefusalVerdict = (globalThis as any).__verdict;
let bestArabicVoice: Voice | null = null, bestEnglishVoice: Voice | null = null, voiceCheckExhausted = false;
let sessionVoice: Voice | null = null, sessionLanguage = 'ar-SA', sessionId: string | null = null;
let sessionUnits: Unit[] = [], unitIndex = 0, elapsedMs = 0, state = 'idle';
const AR_LANG = 'ar-SA';
function isWeb() { return true; }
function stopReadAloud() {}
function buildUnits(s: ReadAloudSegment[]): Unit[] { return s.filter((x) => x.text.trim()).map((x) => ({ kind: 'speak', text: x.text })); }
function notifyId() {} function startTicking() {} function notifyPlayback() {}
function playCurrentUnit() { (globalThis as any).__played = ((globalThis as any).__played || 0) + 1; }
function __setVoices(a: Voice | null, exhausted: boolean) { bestArabicVoice = a; voiceCheckExhausted = exhausted; }
`;

async function lift(src: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ra-stale-'));
  const f = join(dir, 'readAloud.ts');
  writeFileSync(f, src);
  return liftSymbols(f, [{ header: 'function liveVoicePresent(' }, { header: 'export function speakReadAloud(' },
    { header: 'export function readAloudRefusal(' }], ['speakReadAloud', 'readAloudRefusal', '__setVoices'], PRELUDE);
}

const REAL = readFileSync('src/lib/readAloud.ts', 'utf8');
const AR: Voice = { identifier: 'urn:ar-maged', language: 'ar-SA', name: 'Maged' };
const setLive = (voices: { voiceURI: string }[]) => {
  (globalThis as any).window = { speechSynthesis: { getVoices: () => voices } };
};

// A user's tap, as FeedbackRow handles it: speak, and on refusal show readAloudRefusal()'s sentence.
function tap(m: Record<string, unknown>): { started: boolean; message: string | null } {
  const started = (m.speakReadAloud as Function)('k', [{ text: 'طلع لنا 12 نتيجة' }], 'ar') as boolean;
  const why = started ? 'none' : (m.readAloudRefusal as Function)('ar') as string;
  return { started, message: started ? null : messageKey(why) };
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED — the checks above are blind to the defect this file exists to catch');

async function verdicts(src: string) {
  const m = await lift(src);
  const set = m.__setVoices as (v: Voice | null, e: boolean) => void;
  const out: Record<string, { started: boolean; message: string | null; played: number }> = {};
  for (const [name, voice, live, exhausted] of [
    ['stale', AR, [], false], ['stale-exhausted', AR, [], true],
    ['healthy', AR, [{ voiceURI: AR.identifier }], true], ['never-had-one', null, [], true],
  ] as const) {
    (globalThis as any).__played = 0;
    set(voice, exhausted); setLive(live as any);
    const r = tap(m);
    out[name] = { ...r, played: (globalThis as any).__played };
  }
  return out;
}

const real = await verdicts(REAL);
check('a voice confirmed earlier but absent from the live list now: the tap is refused, not «started»',
  !real.stale.started && real.stale.played === 0, JSON.stringify(real.stale));
check('… and the refusal is said out loud («still preparing the voice»), never nothing',
  real.stale.message === 'Still preparing the voice — tap again in a moment', JSON.stringify(real.stale));
check('… even after the voice check is exhausted (it WAS available: never «not available on this device»)',
  real['stale-exhausted'].message === 'Still preparing the voice — tap again in a moment', JSON.stringify(real['stale-exhausted']));
check('a voice the browser holds now: the tap speaks', real.healthy.started && real.healthy.played === 1, JSON.stringify(real.healthy));
check('no voice ever, check exhausted: «not available on this device» (unchanged)',
  real['never-had-one'].message === "Listening isn't available on this device", JSON.stringify(real['never-had-one']));

// MUTATIONS — the shapes this barrier exists to catch.
const m1 = REAL.replace(/\n  if \(!liveVoicePresent\(sessionVoice\)\) return false;/, '');
const m2 = REAL.replace(/\n  if \(best && !liveVoicePresent\(best\)\) return 'still-resolving';/, '');
check('(mutation) the mutants really differ from the source', m1 !== REAL && m2 !== REAL);
const v1 = await verdicts(m1);
mustCatch('speakReadAloud «starting» on a stale voice (the #856 dead control)', v1.stale.started === true);
const v2 = await verdicts(m2);
mustCatch('a stale-voice refusal that says nothing', v2.stale.message === null);

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a 🔊 tap against a stale voice refuses out loud');
