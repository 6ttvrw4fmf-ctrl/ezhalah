// Voice-input composer contract (owner brief 2026-08-23 — ChatGPT-style recording composer).
// Permanent frontend barrier: pins the 16 behaviors the owner named for the voice composer, so no
// refactor can silently drift them. Sources: src/lib/voiceInput.ts (capture/transcription),
// src/components/VoiceWaveform.tsx (live level rendering), src/app/agent.tsx (the composer state
// machine + recording UI), src/i18n.tsx (Arabic strings).
//
//   node --experimental-strip-types scripts/verify-voice-composer-contract.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};
// A barrier nobody watched fail is a comment that runs: `mustCatch` applies a check's OWN predicate
// to a deliberately broken input and asserts it rejects it (repo ratchet,
// scripts/verify-new-barriers-are-mutation-proven.ts).
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${caught ? 'catches' : 'BLIND to'} ${label}`);
};

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../src/lib/voiceInput.ts', import.meta.url), 'utf8');
const wave = readFileSync(new URL('../src/components/VoiceWaveform.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
const readAloud = readFileSync(new URL('../src/lib/readAloud.ts', import.meta.url), 'utf8');

console.log('\nVoice-input composer contract (owner brief 2026-08-23)\n');

// CODE-only view (comments stripped): the module's own header COMMENT rightly names the banned
// providers ("NEVER add ElevenLabs/Whisper/...") — the ban applies to code, not to its docs.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const voiceCode = stripComments(voice);

// ── 0. FREE/NATIVE ONLY + ARABIC ONLY (owner absolutes) ─────────────────────────────────────────
check(
  '0a. voiceInput.ts uses ONLY built-in browser APIs — no fetch/XHR/WebSocket, no paid provider',
  !/fetch\s*\(|XMLHttpRequest|WebSocket|elevenlabs|whisper|openai|azure|assemblyai|deepgram/i.test(voiceCode),
  'a network call or paid-provider reference appeared in the capture module CODE',
);
check(
  '0b. recognizer is pinned Arabic-only (ar-SA), no language picker path',
  /AR_LANG = 'ar-SA'/.test(voice) && /rec\.lang = AR_LANG/.test(voice),
);

// ── 1. Recording UI lives INSIDE the composer — an overlay on the same surface, never a modal ───
const composerOpen = agent.indexOf('s.composer, COMPOSER_EASE');
const voiceRowAt = agent.indexOf('testID="voice-recording-row"');
check(
  '1. recording row is rendered inside the composer surface as an absolute overlay (no modal/sheet)',
  composerOpen !== -1 && voiceRowAt > composerOpen &&
    /voiceRow: \{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0/.test(agent) &&
    !/Modal[^a-zA-Z][^\n]*voice/i.test(agent),
);

// ── Placement (owner spatial hierarchy): X far left → waveform → Stop → Send far right, LTR-pinned
const iCancel = agent.indexOf('testID="voice-cancel"');
const iWave = agent.indexOf('testID="voice-waveform"');
const iStop = agent.indexOf('testID="voice-stop"');
const iSend = agent.indexOf('testID="voice-send"');
check(
  '9a. control order is X → waveform → Stop → Send (Stop immediately left of Send, Send far right)',
  iCancel !== -1 && iCancel < iWave && iWave < iStop && iStop < iSend,
);
check(
  "9b/13. the row is PHYSICALLY pinned direction:'ltr' so the page's RTL can never mirror it",
  /testID="voice-recording-row"[\s\S]{0,600}s\.voiceRow, \{ direction: 'ltr' \} as any/.test(agent),
);

// ── 2. X discards completely — nothing sent, transcript dropped, composer text untouched ────────
const cancelBody = agent.match(/const cancelVoice = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  '2. cancelVoice discards via cancelVoiceInput() and never sends or rewrites the composer text',
  /cancelVoiceInput\(\)/.test(cancelBody) && !/\bsend\(|setTyped\(/.test(cancelBody) &&
    /setVoiceState\('idle'\)/.test(cancelBody),
);

// ── 3. Stop terminates capture and lands the transcript in the normal composer (no submit) ──────
const stopBody = agent.match(/const stopVoice = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  '3. stopVoice stops capture (stopVoiceInput) and places the transcript into the input — never send()',
  /stopVoiceInput\(\)/.test(stopBody) && /setTyped\(merged\)/.test(stopBody) && !/void send\(/.test(stopBody),
);

// ── 4/5. Send finalizes + submits AT MOST ONCE — reentrancy latch + one-shot transcript hand-off ─
const sendBody = agent.match(/const sendVoice = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  '4. sendVoice is guarded by the voiceFinalizingRef reentrancy latch as its FIRST statement',
  /const sendVoice = \(\) => \{\s*\n\s*if \(voiceFinalizingRef\.current \|\| !voiceActiveRef\.current\) return;/.test(agent),
);
check(
  '5a. sendVoice submits via the one existing send() path, exactly once, after synchronous teardown',
  (sendBody.match(/void send\(/g) ?? []).length === 1 && /stopVoiceInput\(\)/.test(sendBody),
);
// 5b. LIFECYCLE INVARIANT, not a literal shape. This check used to assert that the source contained
// `if (!active) return '';` as stopVoiceInput's first statement — i.e. it PINNED THE DEFECT AS
// CORRECT. `active` only turns true AFTER getUserMedia resolves, so that early return made Stop and
// Send the two exit paths that left recording mode WITHOUT calling teardown() while the permission
// prompt was still up. teardown()'s `generation++` is the only thing an in-flight start checks, so
// the grant arrived for a session the UI had already left and the mic came up hidden, capturing
// forever (ops_incident hunt-2026-09-04:voice:05; X was never affected — cancelVoiceInput tears down
// unconditionally). The invariant the module states for itself at voiceInput.ts:19-23 is what is
// asserted now: on EVERY exit path of a leave-recording-mode API, teardown() has already run.
const fnBody = (src: string, name: string) =>
  src.match(new RegExp(`export function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
const tearsDownBeforeEveryReturn = (body: string) => {
  const firstTeardown = body.indexOf('teardown()');
  if (firstTeardown === -1) return false; // no teardown at all — the mic outlives the UI
  return [...body.matchAll(/\breturn\b/g)].every((m) => (m.index ?? 0) > firstTeardown);
};
const stopFn = fnBody(voice, 'stopVoiceInput');
const cancelFn = fnBody(voice, 'cancelVoiceInput');
check(
  '5b. every exit path tears down BEFORE it can return (Stop/Send cancel an in-flight start, like X), ' +
    'and the transcript is still handed out at most once',
  tearsDownBeforeEveryReturn(stopFn) && tearsDownBeforeEveryReturn(cancelFn) && /\bactive\b/.test(stopFn),
  'stopVoiceInput()/cancelVoiceInput() must reach teardown() on every path — a return that jumps over it ' +
    'leaves a start still awaiting the permission prompt uncancelled, and the granted mic captures with no UI. ' +
    'stopVoiceInput must also keep gating the transcript on `active` so it is consumed exactly once.',
);
// MUTATION PROOF for 5b — the predicate is fed the defect it replaced, plus the shapes a fake fix
// would take, and must reject every one while still accepting the real code.
mustCatch(
  "the shipped defect: `if (!active) return '';` returning before teardown()",
  !tearsDownBeforeEveryReturn("export function stopVoiceInput(): string {\n  if (!active) return '';\n  const text = t();\n  teardown();\n  return text;\n}"),
);
mustCatch(
  'a guard that returns early anywhere in the body, before teardown()',
  !tearsDownBeforeEveryReturn("export function stopVoiceInput(): string {\n  if (!recognizer) return '';\n  teardown();\n  return '';\n}"),
);
mustCatch(
  'teardown() dropped from the function entirely',
  !tearsDownBeforeEveryReturn("export function cancelVoiceInput(): void {\n  active = false;\n}"),
);
mustCatch(
  'the real fixed shape still PASSING (the predicate is not vacuously red)',
  tearsDownBeforeEveryReturn("export function stopVoiceInput(): string {\n  const text = active ? f() : '';\n  teardown();\n  return text;\n}"),
);
mustCatch(
  'a valid refactor that tears down first and then returns early (not flagged)',
  tearsDownBeforeEveryReturn("export function stopVoiceInput(): string {\n  if (!active) { teardown(); return ''; }\n  teardown();\n  return f();\n}"),
);
check(
  '5c. Enter-while-recording routes to the SAME guarded voice send, never a raw send()',
  /if \(voiceActiveRef\.current\) sendVoiceRef\.current\(\);\s*\n\s*else sendRef\.current\(\);/.test(agent),
);

// ── 6. Mic can NEVER stay active after leaving: teardown stops tracks; unmount/blur/New Chat all cancel
// Matched against teardown()'s OWN body — a track.stop() elsewhere (e.g. the permission-race
// path) must not satisfy this (mutation-proof finding: it did, before this was scoped).
const teardownBody = voice.match(/function teardown\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
check(
  '6a. teardown() invalidates continuations, stops every mic track, aborts recognizer, closes audio',
  /generation\+\+/.test(teardownBody) && /track\.stop\(\)/.test(teardownBody) &&
    /\.abort\(\)/.test(teardownBody) && /audioCtx\.close\(\)/.test(teardownBody),
);
check(
  '6b. capture is cancelled on unmount AND on navigation blur AND on New Chat',
  /useEffect\(\(\) => \(\) => \{[^\n]{0,60}cancelVoiceInput\(\); \}, \[\]\)/.test(agent) &&
    /useFocusEffect\(useCallback\(\(\) => \(\) => \{[^\n]{0,160}cancelVoiceInput\(\);/.test(agent) &&
    /greetTimerRef\.current\);[\s\S]{0,600}cancelVoiceInput\(\);/.test(agent),
);
check(
  '6c. a cancel during the permission prompt still stops the late-granted stream (generation guard)',
  /if \(gen !== generation\) \{[\s\S]{0,400}track\.stop\(\)/.test(voice),
);

// ── 7. Permission denial restores the normal composer with a graceful Arabic notice ─────────────
check(
  '7. onFailure restores voiceState to idle and shows a t()-translated notice (no raw browser text)',
  // Window widened past 300 (owner, 2026-08-24): the 'service-not-allowed' branch's explanatory
  // comment sits between setVoiceState('idle') and the kind==='denied' check it documents — a
  // comment-length change, not a shape change; the same invariant still holds.
  /onFailure: \(kind, detail\) => \{[\s\S]{0,300}setVoiceState\('idle'\);[\s\S]{0,1500}kind === 'denied'/.test(agent),
);

// ── 18. On platforms where voice input can never work (owner report, phone mic "doesn't work" —
//        iOS Safari/Chrome-iOS: WebKit has never implemented SpeechRecognition), the mic button is
//        hidden entirely rather than offered as a control that can only flash a toast and revert.
check(
  '18. the mic button only renders when isVoiceInputSupported() is true',
  /\{isVoiceInputSupported\(\) \? \(\s*<Pressable\s*\n\s*testID="voice-mic"/.test(agent),
);

// ── 8/10. Waveform owns ONLY the flexible middle: overflow-clipped flex:1, fixed-size controls ──
check(
  '8/10. waveform wrapper is flex:1 + overflow hidden; canvas absolutely pinned; controls fixed 34px',
  /voiceWaveWrap: \{ flex: 1, alignSelf: 'stretch', minHeight: 34, overflow: 'hidden' \}/.test(agent) &&
    /position: 'absolute', inset: 0/.test(wave) &&
    /voiceRoundBtn: \{ width: 34, height: 34/.test(agent),
);

// ── Real mic-reactive waveform — actual analyser data, never a fake random animation ────────────
check(
  '4b. waveform is driven by real AnalyserNode RMS samples (no Math.random anywhere in the path)',
  /getByteTimeDomainData/.test(voice) && /getVoiceLevelHistory/.test(wave) &&
    !/Math\.random/.test(voice) && !/Math\.random/.test(wave),
);
check(
  '4c. level sampling rides a plain interval, not rAF (hidden-tab freeze — repo rule PR #341/#346)',
  /setInterval\(\(\) => \{\s*\n\s*analyser\.getByteTimeDomainData/.test(voice),
);

// ── 11/12. Arabic accessibility labels + zero English leaks ─────────────────────────────────────
check(
  '11. all four controls carry t() accessibility labels with the owner-specified Arabic values',
  /accessibilityLabel=\{t\('Cancel recording'\)\}/.test(agent) &&
    /accessibilityLabel=\{t\('Stop recording'\)\}/.test(agent) &&
    /accessibilityLabel=\{t\('Send'\)\}/.test(agent) &&
    /accessibilityLabel=\{t\('Voice input'\)\}/.test(agent) &&
    /'Cancel recording': 'إلغاء التسجيل'/.test(i18n) &&
    /'Stop recording': 'إيقاف التسجيل'/.test(i18n) &&
    /'Send': 'إرسال'/.test(i18n),
);
check(
  '12. every user-visible voice string has an Arabic dictionary entry (English leaks = 0)',
  /'Voice input': '/.test(i18n) &&
    /'Voice input is not supported on this browser': '/.test(i18n) &&
    /'Microphone access is needed for voice input\. Enable it in your browser settings\.': '/.test(i18n) &&
    /'Voice input is not available right now\.': '/.test(i18n) &&
    /showVoiceNotice\(t\(/.test(agent) && !/showVoiceNotice\((['"`])/.test(agent),
);

// ── 13 (motion). Reduced motion: morph collapses to a plain state change ────────────────────────
check(
  '13m. the morph transition is gated on useReducedMotion() (opacity-only state change when reduced)',
  /const VOICE_EASE = IS_WEB && !reducedMotion/.test(agent),
);

// ── 14. Voice-input state is fully isolated from Read Aloud (and they never fight over audio) ───
check(
  '14a. voiceInput.ts and readAloud.ts import NOTHING from each other (zero shared state)',
  !/from ['"]@?\.?\/?.*readAloud['"]/.test(voiceCode) && !/from ['"]@?\.?\/?.*voiceInput['"]/.test(readAloud),
);
check(
  '14b. starting voice input stops Read Aloud, and read-aloud starting mid-recording is stopped too',
  /const startVoice = async \(\) => \{[\s\S]{0,400}stopReadAloud\(\);/.test(agent) &&
    /subscribeReadAloud\(\(id\) => \{ if \(id\) stopReadAloud\(\); \}\)/.test(agent),
);

// ── 15/16. Pre-recording text survives; composer restores after Cancel AND after Send ───────────
check(
  '15. text typed before recording is captured (voiceBaseRef) and merged — never destroyed',
  /voiceBaseRef\.current = typed;/.test(agent) &&
    (agent.match(/\[voiceBaseRef\.current\.trim\(\), transcript\]\.filter\(Boolean\)\.join\(' '\)/g) ?? []).length === 2,
);
check(
  "16. every exit path (cancel/stop/send/failure) returns voiceState to 'idle'",
  (agent.match(/setVoiceState\('idle'\)/g) ?? []).length >= 5,
);

// ── 17. Rapid-tap safety: voiceActiveRef is SYNCHRONOUS truth, flipped inside every transition ──
// (found in journey E: a render-assigned mirror stays stale for the rest of the tick, letting a
// same-tick Stop→Send pass both guards and submit the base text without the transcript.)
check(
  '17. every transition flips voiceActiveRef synchronously; the ref is never render-derived',
  /const stopVoice = \(\) => \{[\s\S]{0,150}voiceActiveRef\.current = false;/.test(agent) &&
    /const cancelVoice = \(\) => \{[\s\S]{0,150}voiceActiveRef\.current = false;/.test(agent) &&
    /voiceFinalizingRef\.current = true;\s*\n\s*voiceActiveRef\.current = false;/.test(agent) &&
    /voiceActiveRef\.current = true; \/\/ synchronous latch/.test(agent) &&
    !/voiceActiveRef\.current = voiceState ===/.test(agent),
);

// ── Wiring: this barrier itself must be in npm test, or it is decoration ────────────────────────
check(
  'W. verify-voice-composer-contract.ts is wired into `npm test`',
  npmTestRuns(REPO_ROOT, 'verify-voice-composer-contract'),
);

console.log('');
if (failed) {
  console.error(`voice-composer contract: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('voice-composer contract: all checks passed');
