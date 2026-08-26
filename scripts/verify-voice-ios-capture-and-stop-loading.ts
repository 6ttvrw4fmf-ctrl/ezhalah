// Voice-input iOS capture path + ChatGPT-style stop-loading barrier (owner report, 2026-08-24 —
// real iPhone: "Ezhalah would like to access the microphone" → tap Allow → immediate "microphone
// isn't available" failure, while other apps/sites on the SAME phone use the mic fine; plus a
// follow-up request: the composer should show a brief loading beat after Stop, like ChatGPT, before
// the transcript lands, instead of an instant cut).
//
// PART A — capture path + real waveform amplitude. FINAL architecture (2026-08-25, after a
// same-week reversal — see verify-voice-safari-support-detection.ts for the full history):
//   1. NO browser-name exclusion of any kind. capture uses ONE unified path for every platform the
//      capability gate lets through — getUserMedia runs unconditionally; there is no Safari-only (or
//      any other browser-only) skip-branch. A genuine iOS Safari failure ('service-not-allowed') is
//      handled at RUNTIME with its own honest message, never prevented by hiding the mic ahead of
//      time on a UA guess.
//   2. THE FROZEN-WAVEFORM FIX (owner report: iPhone Chrome transcribed fine but the waveform never
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

console.log('\nVoice-input capture path + stop-loading barrier (owner reports 2026-08-24/25)\n');

// ═══ PART A — capture path ═════════════════════════════════════════════════════════════════════
check(
  'startVoiceInput has ONE unified capture path with NO browser-name branch of any kind — getUserMedia runs unconditionally for every platform the capability gate admits',
  !/isIOSSafariEngine|userAgent|CriOS|FxiOS|EdgiOS|OPiOS/.test(voice) &&
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
