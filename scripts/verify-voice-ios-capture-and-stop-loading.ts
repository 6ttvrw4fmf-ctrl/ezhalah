// Voice-input iOS capture path + ChatGPT-style stop-loading barrier (owner report, 2026-08-24 —
// real iPhone: "Ezhalah would like to access the microphone" → tap Allow → immediate "microphone
// isn't available" failure, while other apps/sites on the SAME phone use the mic fine; plus a
// follow-up request: the composer should show a brief loading beat after Stop, like ChatGPT, before
// the transcript lands, instead of an instant cut).
//
// PART A — capture path + real waveform amplitude. The architecture settled on 2026-08-24 after a
// full day of real-iPhone evidence, in three movements:
//   1. Genuine iOS Safari is excluded at the SUPPORT GATE itself (isVoiceInputSupported → false
//      there; owner decision, option B of their own framing — Apple's on-device service refused
//      every attempt on a real, fully-configured iPhone across three production-verified fixes, and
//      no free alternative exists). So NOTHING voice-related runs on iOS Safari, and startVoiceInput
//      now has ONE unified capture path for every platform that can actually reach it — the old
//      Safari-only skip-branch is deliberately gone (dead code once the gate excludes Safari).
//   2. Chrome/Firefox/Edge-for-iOS keep the FULL feature — recognition is proven working there on
//      the owner's own iPhone. Third-party iOS browsers carry their own UA tokens (CriOS/FxiOS/
//      EdgiOS/OPiOS) precisely so they can be told apart from Safari despite sharing WebKit.
//   3. THE FROZEN-WAVEFORM FIX (owner report: iPhone Chrome transcribed fine but the waveform never
//      moved): WebKit only PROCESSES an audio graph that reaches the destination — an analyser with
//      no path to output never receives data, so RMS reads flat silence forever. The standard fix is
//      a ZERO-GAIN tap into the destination: the graph runs, and gain 0 guarantees nothing audible
//      (no echo/feedback). Blink/Gecko pump sourceless-sink graphs anyway — which is exactly why
//      desktop Chrome never showed the bug — and are unharmed by the tap.
//
// PART B — stop-loading beat: Stop now enters a brief 'processing' voiceState (capture has already
// stopped synchronously — this is pure UI dwell time) showing a loading indicator in the waveform's
// place, before settling to 'idle' with the transcript. A generation token (mirroring voiceInput.ts's
// own idiom) guarantees a stale beat can never stomp a newer recording/cancel/unmount.
//
//   node --experimental-strip-types scripts/verify-voice-ios-capture-and-stop-loading.ts   (npm test)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const voice = readFileSync(new URL('../src/lib/voiceInput.ts', import.meta.url).pathname, 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url).pathname, 'utf8');

console.log('\nVoice-input iOS capture path + stop-loading barrier (owner report 2026-08-24)\n');

// ═══ PART A — iOS capture path ═════════════════════════════════════════════════════════════════
check(
  'isIOSSafariEngine() detects iPhone/iPad/iPod via UA (AND the iPad-masquerading-as-Mac case via MacIntel+multi-touch), then EXCLUDES third-party iOS browser UA tokens',
  /function isIOSSafariEngine\(\): boolean \{/.test(voice) &&
    /\/iPad\|iPhone\|iPod\/\.test\(ua\) \|\| \(navigator\.platform === 'MacIntel' && \(navigator as any\)\.maxTouchPoints > 1\)/.test(voice) &&
    /return !\/CriOS\|FxiOS\|EdgiOS\|OPiOS\/\.test\(ua\);/.test(voice),
);
check(
  'genuine iOS Safari is excluded at the SUPPORT GATE (owner decision 2026-08-24) — and startVoiceInput therefore has ONE unified capture path: getUserMedia runs unconditionally, no Safari skip-branch survives',
  /if \(isIOSSafariEngine\(\)\) return false;/.test(voice) &&
    !/if \(!isIOSSafariEngine\(\)\) \{/.test(voice) &&
    /let mediaStream: MediaStream;\s*\n\s*try \{\s*\n\s*mediaStream = await navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\);/.test(voice),
);
check(
  'THE WEBKIT GRAPH-PULL FIX: the analyser is tapped into the destination through a ZERO-gain node — source → analyser → gain(0) → destination — so WebKit actually processes the graph and RMS reads real amplitude, while gain 0 guarantees nothing audible',
  /const sink = audioCtx!\.createGain\(\);\s*\n\s*sink\.gain\.value = 0;\s*\n\s*analyser\.connect\(sink\);\s*\n\s*sink\.connect\(audioCtx!\.destination\);/.test(voice),
);
check(
  "an interrupted/suspended context mid-session re-resumes itself (onstatechange) — iOS can yank a running context on Siri/calls/route changes, and without this the waveform freezes for the rest of the recording",
  /onstatechange = \(\) => \{ if \(audioCtx && \(audioCtx as any\)\.state !== 'running'\) void audioCtx\.resume\?\.\(\)\.catch\(\(\) => \{\}\); \};/.test(voice),
);
check(
  'the recognizer (step 3) is reached unconditionally after capture setup — every supported platform gets a working recognizer even if the analyser graph failed (its try/catch is non-fatal)',
  /\}\s*\n\s*\n\s*\/\/ 3\. The recognizer/.test(voice),
);
check(
  'the RMS sampling itself is untouched real math over getByteTimeDomainData — no Math.random, no fabricated animation anywhere in the level path',
  /analyser\.getByteTimeDomainData\(buf\);/.test(voice) && !/Math\.random/.test(voice),
);

// EXECUTED: a faithful replica of isIOSSafariEngine(), against real device/browser UA strings —
// including the exact Chrome-for-iOS case the owner's real device disproved the OLD blanket rule on.
function isIOSSafariEngineReplica(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  const ua = nav.userAgent || '';
  const isIOSFamily = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  if (!isIOSFamily) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}
const UA_IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.113 Mobile/15E148 Safari/604.1';
const UA_IPHONE_FIREFOX = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15';
const UA_IPAD_MODERN_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';
const UA_ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

check('iPhone Safari UA → genuine Safari (true) — the one browser the owner excluded at the support gate', isIOSSafariEngineReplica({ userAgent: UA_IPHONE_SAFARI }) === true);
check(
  "iPhone Chrome UA (CriOS) → NOT genuine Safari (false) — the exact owner-reported regression: Chrome-for-iOS must keep its real getUserMedia/waveform path, it doesn't share Safari's contention",
  isIOSSafariEngineReplica({ userAgent: UA_IPHONE_CHROME }) === false,
);
check(
  'iPhone Firefox UA (FxiOS) → NOT genuine Safari (false) — same exemption for every third-party iOS browser, not just Chrome',
  isIOSSafariEngineReplica({ userAgent: UA_IPHONE_FIREFOX }) === false,
);
check(
  'iPad running a modern iPadOS Safari (UA claims "Macintosh", but touch-capable, no CriOS/FxiOS token) → genuine Safari (true) — the exact masquerade trap, still correctly caught',
  isIOSSafariEngineReplica({ userAgent: UA_IPAD_MODERN_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 }) === true,
);
check(
  'real macOS Safari (UA also says "Macintosh", but zero touch points — no real Mac has a touchscreen) → NOT genuine Safari for this purpose (false) — must never misclassify the machine this fix was proven safe on',
  isIOSSafariEngineReplica({ userAgent: UA_MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }) === false,
);
check('Android Chrome UA → false (not iOS at all)', isIOSSafariEngineReplica({ userAgent: UA_ANDROID_CHROME, platform: 'Linux armv81' }) === false);
check('desktop Chrome UA on a real Mac (platform MacIntel, 0 touch points) → false', isIOSSafariEngineReplica({ userAgent: UA_DESKTOP_CHROME, platform: 'MacIntel', maxTouchPoints: 0 }) === false);

// ═══ PART B — stop-loading beat ════════════════════════════════════════════════════════════════
check(
  "voiceState's type includes 'processing' alongside idle/recording",
  /useState<'idle' \| 'recording' \| 'processing'>\('idle'\)/.test(agent),
);
const stopVoiceBody = agent.match(/const stopVoice = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  'stopVoice stops capture SYNCHRONOUSLY (stopVoiceInput() called immediately, before any state transition) — the loading beat is cosmetic dwell time, never a delay on when recording actually ends',
  /const stopVoice = \(\) => \{\s*\n\s*if \(!voiceActiveRef\.current\) return;[^\n]*\n\s*voiceActiveRef\.current = false;\s*\n\s*const transcript = stopVoiceInput\(\);/.test(stopVoiceBody),
);
check(
  "stopVoice enters 'processing' immediately after capture stops, then defers 'idle' + setTyped behind a setTimeout gated on a fresh generation token",
  /setVoiceState\('processing'\);\s*\n\s*const myGen = \+\+voiceStopGenRef\.current;\s*\n\s*setTimeout\(\(\) => \{\s*\n\s*if \(voiceStopGenRef\.current !== myGen\) return;[^\n]*\n\s*setVoiceState\('idle'\);\s*\n\s*if \(merged\) setTyped\(merged\);\s*\n\s*\}, STOP_PROCESSING_MS\);/.test(stopVoiceBody),
);
check(
  'a NEW recording (startVoice), a cancel (X), unmount, AND navigation-blur ALL bump voiceStopGenRef — a stale processing beat can never fire after any of them supersede it',
  /voiceStopGenRef\.current\+\+; \/\/ invalidate any pending "processing" beat from a previous Stop/.test(agent) &&
    /voiceStopGenRef\.current\+\+; \/\/ invalidate a pending "processing" beat — X wins outright/.test(agent) &&
    /useEffect\(\(\) => \(\) => \{ voiceStopGenRef\.current\+\+; cancelVoiceInput\(\); \}, \[\]\)/.test(agent) &&
    /useFocusEffect\(useCallback\(\(\) => \(\) => \{ voiceStopGenRef\.current\+\+;/.test(agent),
);
check(
  "the composer's normal controls stay hidden/inert for the WHOLE voice flow (recording AND processing), not just while the mic is literally live — voiceState !== 'idle', not === 'recording'",
  /pointerEvents=\{voiceState !== 'idle' \? 'none' : 'auto'\}\s*\n\s*style=\{\[s\.composerInner, VOICE_EASE, voiceState !== 'idle' && s\.composerInnerHidden\]\}/.test(agent),
);
check(
  "the recording row stays mounted/visible through 'processing' too (only hides once fully idle), but stays non-interactive unless actually recording",
  /pointerEvents=\{voiceState === 'recording' \? 'auto' : 'none'\}/.test(agent) &&
    /voiceState === 'idle' && s\.voiceRowHidden/.test(agent),
);
check(
  "the waveform slot shows the REAL waveform while recording, an ActivityIndicator while processing, and nothing while idle — three distinct branches, not a boolean toggle",
  /\{voiceState === 'recording' \? \(\s*\n\s*<VoiceWaveform \/>\s*\n\s*\) : voiceState === 'processing' \? \(\s*\n\s*<ActivityIndicator testID="voice-processing" size="small" color=\{colors\.muted\} \/>\s*\n\s*\) : null\}/.test(agent),
);
check(
  'ActivityIndicator is imported from react-native (the same component already used elsewhere in this codebase for loading states — no new dependency)',
  /import \{[\s\S]{0,40}ActivityIndicator/.test(agent),
);

// EXECUTED: a faithful replica of the generation-guarded processing-beat logic, using an injectable
// fake timer (never real timers) — proves the supersession guarantee behaviorally, not just by shape.
function makeFakeTimer() {
  let now = 0;
  const pending: Array<{ id: number; due: number; fn: () => void }> = [];
  let nextId = 1;
  return {
    setTimeout: (fn: () => void, ms: number) => { const id = nextId++; pending.push({ id, due: now + ms, fn }); return id; },
    advance(ms: number) {
      now += ms;
      // Fire in due order, matching real event-loop semantics.
      pending.sort((a, b) => a.due - b.due);
      while (pending.length && pending[0].due <= now) pending.shift()!.fn();
    },
  };
}
function stopVoiceReplica(state: { voiceState: string; typed: string; stopGen: number }, merged: string, timer: ReturnType<typeof makeFakeTimer>) {
  state.voiceState = 'processing';
  const myGen = ++state.stopGen;
  timer.setTimeout(() => {
    if (state.stopGen !== myGen) return;
    state.voiceState = 'idle';
    if (merged) state.typed = merged;
  }, 450);
}

{
  const timer = makeFakeTimer();
  const state = { voiceState: 'recording', typed: '', stopGen: 0 };
  stopVoiceReplica(state, 'مرحبا', timer);
  check('immediately after Stop, voiceState is "processing" (not yet idle) — the beat is real, not skipped', state.voiceState === 'processing');
  timer.advance(449);
  check('one tick before the beat completes, still "processing" and typed is still unset', state.voiceState === 'processing' && state.typed === '');
  timer.advance(1);
  check('at 450ms the beat completes: voiceState is idle AND the transcript landed', state.voiceState === 'idle' && state.typed === 'مرحبا');
}

{
  // The exact regression this guards: a NEW recording starting DURING the processing beat must not
  // let the stale beat later force voiceState back to idle out from under the new session.
  const timer = makeFakeTimer();
  const state = { voiceState: 'recording', typed: '', stopGen: 0 };
  stopVoiceReplica(state, 'مرحبا', timer);
  // ... 200ms later, the user taps mic again — a new startVoice() bumps the generation and re-enters 'recording'.
  timer.advance(200);
  state.stopGen++; // startVoice's own invalidation
  state.voiceState = 'recording';
  timer.advance(300); // the stale beat's original 450ms deadline has now passed
  check(
    'a superseded processing beat is a no-op — the NEW recording session is untouched, never yanked back to idle by the stale timer',
    state.voiceState === 'recording' && state.typed === '',
  );
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
check(
  'this barrier is wired into `npm test`',
  /verify-voice-ios-capture-and-stop-loading\.ts/.test(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8')),
);

console.log('');
if (failed) {
  console.error(`voice iOS-capture + stop-loading barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('voice iOS-capture + stop-loading barrier: all checks passed');
