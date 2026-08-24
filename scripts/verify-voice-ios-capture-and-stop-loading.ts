// Voice-input iOS capture path + ChatGPT-style stop-loading barrier (owner report, 2026-08-24 —
// real iPhone: "Ezhalah would like to access the microphone" → tap Allow → immediate "microphone
// isn't available" failure, while other apps/sites on the SAME phone use the mic fine; plus a
// follow-up request: the composer should show a brief loading beat after Stop, like ChatGPT, before
// the transcript lands, instead of an instant cut).
//
// PART A — iOS capture path: iOS Safari's audio-session model is stricter than desktop browsers'
// about a page holding two independent audio captures at once. Our own code held TWO: a
// getUserMedia-driven AnalyserNode (for the real waveform) PLUS SpeechRecognition's own internal
// capture. On genuine iOS Safari (iPhone/iPad's OWN browser — iPadOS masquerades as "Macintosh" in
// its User-Agent but is touch-capable, unlike any real Mac) we skip our own getUserMedia/AnalyserNode
// entirely and let the recognizer own the ONE capture session outright. isVoiceInputSupported() itself
// is UNTOUCHED — the mic still shows exactly where it already correctly does; only how the stream is
// ACQUIRED changes.
//
// NARROWED to Safari alone, not "any iOS WebKit browser" (owner report, 2026-08-24, SAME iPhone):
// the first version of this fix applied to every iOS browser, including Chrome-for-iOS — but
// real-device evidence showed Chrome does NOT share Safari's contention (recognition worked there),
// so forcing the waveform-less fallback onto it was an unnecessary, user-visible regression (the
// owner explicitly noticed the missing waveform on Chrome). Every third-party iOS browser carries its
// own UA token specifically so it CAN be told apart from Safari despite sharing WebKit: Chrome uses
// 'CriOS', Firefox 'FxiOS', Edge 'EdgiOS', Opera 'OPiOS'.
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
  'the getUserMedia + AnalyserNode block is skipped entirely on genuine iOS Safari only — guarded by if (!isIOSSafariEngine())',
  /if \(!isIOSSafariEngine\(\)\) \{[\s\S]{0,200}navigator\.mediaDevices\.getUserMedia/.test(voice),
);
check(
  "isVoiceInputSupported() is UNTOUCHED by the Safari branch — support detection stays a pure capability check, never gated on isIOSSafariEngine() (the owner's explicit rule: don't hide the mic as a workaround)",
  !/isVoiceInputSupported\(\)[\s\S]{0,50}isIOSSafariEngine/.test(voice) &&
    /export function isVoiceInputSupported\(\): boolean \{\s*\n\s*if \(Platform\.OS !== 'web' \|\| typeof window === 'undefined'\) return false;\s*\n\s*const w = window as any;\s*\n\s*return !!\(w\.SpeechRecognition \|\| w\.webkitSpeechRecognition\) && !!navigator\.mediaDevices\?\.getUserMedia;/.test(voice),
);
check(
  'the recognizer (step 3) is reached unconditionally regardless of the Safari branch — every platform still gets a working recognizer, just without the extra getUserMedia/analyser capture on Safari specifically',
  /\}\s*\n\s*\n\s*\/\/ 3\. The recognizer/.test(voice),
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

check('iPhone Safari UA → genuine Safari (true) — the platform this fix is FOR', isIOSSafariEngineReplica({ userAgent: UA_IPHONE_SAFARI }) === true);
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
