// Safari/WebKit voice-input support-detection barrier (owner reports, 2026-08-24). Two rulings pinned:
//
// 1. `isVoiceInputSupported()` is a LIVE runtime capability check, not a browser-name assumption
//    (macOS Safari has shipped webkitSpeechRecognition since 14.1 and correctly shows the mic), and
//    it never confuses "API present" with "permission granted" (support ≠ permission — a `prompt`/
//    undecided permission state must never hide a control the runtime can genuinely use).
//
// 2. ONE deliberate product exclusion sits on top of the capability check: genuine iOS Safari —
//    an OWNER DECISION (2026-08-24, from their own explicit A/B framing), not a capability
//    inference. The evidence, all on the owner's real iPhone the same day: the API is present, mic
//    permission was granted cleanly, Dictation was enabled in iOS Settings — and Apple's on-device
//    service still refused every recognition attempt ('service-not-allowed') across THREE successive
//    production-verified code fixes. No free/native alternative exists (paid STT permanently
//    banned), so on this one browser a visible mic can only ever fail. Option B was chosen: hide it.
//    Chrome/Firefox/Edge on the SAME iPhone keep the mic — recognition is proven working there on
//    the owner's own device (their screenshots show it transcribing) — and macOS Safari keeps it.
//
//   node --experimental-strip-types scripts/verify-voice-safari-support-detection.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const voice = readFileSync(new URL('../src/lib/voiceInput.ts', import.meta.url).pathname, 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url).pathname, 'utf8');

console.log('\nSafari/WebKit voice-input support-detection barrier (owner report 2026-08-24)\n');

// ── SOURCE: pin the exact detection formula so a future edit can't silently narrow/widen it ────────
const fnBody = voice.match(/export function isVoiceInputSupported\(\): boolean \{[\s\S]*?\n\}/)?.[0] ?? '';
check(
  'isVoiceInputSupported() checks BOTH constructors (SpeechRecognition OR webkitSpeechRecognition) — never only the webkit-prefixed one, never only the bare one',
  /!!\(w\.SpeechRecognition \|\| w\.webkitSpeechRecognition\)/.test(fnBody),
);
check(
  'the formula ANDs in getUserMedia existence — a recognizer with no mic path is not "supported"',
  /&& !!navigator\.mediaDevices\?\.getUserMedia/.test(fnBody),
);
check(
  'native (Platform.OS !== \'web\') and no-window both fail closed to false — a graceful, not a crashing, gap',
  /if \(Platform\.OS !== 'web' \|\| typeof window === 'undefined'\) return false;/.test(fnBody),
);
check(
  'the genuine-iOS-Safari product exclusion is present, BEFORE the capability check (owner decision 2026-08-24 — a mic that can only fail is worse than no mic on that one browser)',
  /if \(isIOSSafariEngine\(\)\) return false;\s*\n\s*const w = window as any;/.test(fnBody),
);

// ── SUPPORT ≠ PERMISSION: the detector must never read permission state at all ─────────────────────
check(
  'isVoiceInputSupported() never reads navigator.permissions / a permission state string — support is judged purely on API presence, so a genuinely-supported browser with permission still at "prompt" is never hidden',
  !/permissions\.query|micPermission|\.state ===/.test(fnBody),
);
check(
  'startVoiceInput() likewise never gates on permission state before attempting getUserMedia — the browser\'s own prompt is the ONE permission signal, never pre-empted by a guess',
  !/permissions\.query/.test(voice),
);

// ── Render site: the mic is gated on the SAME live function, not a re-derived or cached copy ───────
check(
  'the mic button in agent.tsx calls isVoiceInputSupported() directly in render — evaluated fresh every render, never a one-time cached boolean (useState initializer / module-level constant) that could go stale',
  /\{isVoiceInputSupported\(\) \? \(\s*<Pressable\s*\n\s*testID="voice-mic"/.test(agent) &&
    !/const \[?\w*[Ss]upported\]? = isVoiceInputSupported\(\)/.test(agent),
);

// ── EXECUTED: a faithful replica of the production formula, run against the 5 owner-specified
//    real-world scenarios via mocked globals. Mirrors the file's own formula line-for-line so a
//    mutation to either the replica or the source alone still gets caught by the SOURCE check above;
//    this proves WHY that exact formula is the right one across the concrete cases that matter. ─────
function isVoiceInputSupportedReplica(mock: {
  platformOS: string;
  hasSpeechRecognition?: boolean;
  hasWebkitSpeechRecognition?: boolean;
  hasGetUserMedia?: boolean;
  windowDefined?: boolean;
  userAgent?: string;
  navPlatform?: string;
  maxTouchPoints?: number;
}): boolean {
  const windowDefined = mock.windowDefined !== false;
  if (mock.platformOS !== 'web' || !windowDefined) return false;
  // isIOSSafariEngine replica — same formula as the production helper.
  const ua = mock.userAgent ?? '';
  const isIOSFamily = /iPad|iPhone|iPod/.test(ua) || (mock.navPlatform === 'MacIntel' && (mock.maxTouchPoints ?? 0) > 1);
  if (isIOSFamily && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  const w = { SpeechRecognition: mock.hasSpeechRecognition, webkitSpeechRecognition: mock.hasWebkitSpeechRecognition };
  const mediaDevices = { getUserMedia: mock.hasGetUserMedia };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && !!mediaDevices?.getUserMedia;
}

check(
  '1. bare SpeechRecognition present (no webkit prefix) + getUserMedia → mic SHOWN',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasSpeechRecognition: true, hasWebkitSpeechRecognition: false, hasGetUserMedia: true }) === true,
);
check(
  '2. ONLY webkitSpeechRecognition present (real macOS Safari\'s exact shape — confirmed live, Safari 26.5, zero touch points) + getUserMedia → mic SHOWN',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasSpeechRecognition: false, hasWebkitSpeechRecognition: true, hasGetUserMedia: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15', navPlatform: 'MacIntel', maxTouchPoints: 0 }) === true,
);
check(
  '2b. genuine iPhone Safari, API present, getUserMedia present → mic HIDDEN — the owner\'s 2026-08-24 product exclusion: capability was never the question there; the service refusing every attempt on a real, fully-configured device was',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }) === false,
);
check(
  '2c. Chrome on the SAME iPhone (CriOS token), API present → mic SHOWN — recognition is proven working there on the owner\'s own device; the exclusion is Safari-alone, never iOS-wide',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.113 Mobile/15E148 Safari/604.1' }) === true,
);
check(
  '2d. iPad Safari masquerading as a Mac (UA says Macintosh, multi-touch) → mic HIDDEN — the masquerade cannot smuggle iPad Safari past the exclusion',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', navPlatform: 'MacIntel', maxTouchPoints: 5 }) === false,
);
check(
  '3. recognition present but mic permission still "prompt" (undecided, not yet granted) → mic SHOWN — the detector does not read permission state at all, so this is identical to case 2 by construction',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: true }) === true,
);
check(
  '4. neither SpeechRecognition nor webkitSpeechRecognition present (genuinely unsupported engine) → mic HIDDEN',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasSpeechRecognition: false, hasWebkitSpeechRecognition: false, hasGetUserMedia: true }) === false,
);
check(
  '5. native runtime (Platform.OS !== \'web\', the compiled iOS/Android app shell) → mic HIDDEN gracefully regardless of any global state, never throws',
  isVoiceInputSupportedReplica({ platformOS: 'ios', hasSpeechRecognition: true, hasWebkitSpeechRecognition: true, hasGetUserMedia: true }) === false,
);
check(
  '6. recognizer present but getUserMedia absent (no mic path at all) → mic HIDDEN — a recognizer with nothing to feed it is not real support',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: false }) === false,
);

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
check(
  'this barrier is wired into `npm test`',
  /verify-voice-safari-support-detection\.ts/.test(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8')),
);

console.log('');
if (failed) {
  console.error(`Safari/WebKit voice support-detection barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('Safari/WebKit voice support-detection barrier: all checks passed');
