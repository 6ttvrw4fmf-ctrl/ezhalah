// Safari/WebKit voice-input support-detection barrier. This has flip-flopped once already, so this
// barrier pins the FINAL, current ruling explicitly (owner reports, 2026-08-24 → 2026-08-25):
//
// 1. `isVoiceInputSupported()` is a LIVE runtime capability check, not a browser-name assumption
//    (macOS Safari has shipped webkitSpeechRecognition since 14.1 and correctly shows the mic), and
//    it never confuses "API present" with "permission granted" (support ≠ permission — a `prompt`/
//    undecided permission state must never hide a control the runtime can genuinely use).
//
// 2. NO browser-name/UA exclusion of ANY kind (owner ruling, 2026-08-25 — reverses a same-week
//    2026-08-24 decision that had hidden the mic on genuine iOS Safari specifically). The 08-24
//    decision was made after 'service-not-allowed' survived three code-level fixes on a real
//    iPhone; the 08-25 reversal came after further investigation surfaced the actual documented
//    cause — iOS Lockdown Mode disables the Web Speech Recognition API specifically (Dictation/Siri
//    keep working fine at the OS level, unexposed to websites, which is why enabling Dictation alone
//    never helped), and/or an iOS Screen Time "Speech Recognition & Dictation" content restriction.
//    Both are real, CONFIGURATION-DEPENDENT states — not a permanent platform gap — so hiding the
//    mic ahead of time on a browser-name guess was the wrong call: capability detection must stay
//    pure, and a genuine runtime failure gets its own honest, specific message instead (see
//    voiceInput.ts's own comment on startVoiceInput for the full trail).
//
//   node --experimental-strip-types scripts/verify-voice-safari-support-detection.ts   (wired into `npm test`)

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

const voice = readFileSync(new URL('../src/lib/voiceInput.ts', import.meta.url).pathname, 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url).pathname, 'utf8');

console.log('\nSafari/WebKit voice-input support-detection barrier (capability-only, 2026-08-25 ruling)\n');

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
  'NO browser-name/UA check of any kind survives inside the function body — capability-only, permanently (regression guard for the 2026-08-24 exclusion this barrier now forbids from ever coming back)',
  !/userAgent|navigator\.platform|maxTouchPoints|isIOSSafariEngine|CriOS|FxiOS|EdgiOS|OPiOS/.test(fnBody),
);
check(
  'the ONLY two statements in the function are the early platform/window guard and the capability return — nothing sits between them',
  /export function isVoiceInputSupported\(\): boolean \{\s*\n\s*if \(Platform\.OS !== 'web' \|\| typeof window === 'undefined'\) return false;\s*\n\s*const w = window as any;\s*\n\s*return !!\(w\.SpeechRecognition \|\| w\.webkitSpeechRecognition\) && !!navigator\.mediaDevices\?\.getUserMedia;\s*\n\}/.test(voice),
);
check(
  'the isIOSSafariEngine() helper itself is gone from the module entirely, not merely unused — nothing to accidentally re-wire it to',
  !/function isIOSSafariEngine/.test(voice) && !/isIOSSafariEngine\(\)/.test(voice),
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

// ── EXECUTED: a faithful replica of the production formula (now PURELY capability-based — no UA
//    input at all), run against the owner-specified real-world scenarios via mocked globals. Mirrors
//    the file's own formula line-for-line so a mutation to either the replica or the source alone
//    still gets caught by the SOURCE check above. ───────────────────────────────────────────────────
function isVoiceInputSupportedReplica(mock: {
  platformOS: string;
  hasSpeechRecognition?: boolean;
  hasWebkitSpeechRecognition?: boolean;
  hasGetUserMedia?: boolean;
  windowDefined?: boolean;
}): boolean {
  const windowDefined = mock.windowDefined !== false;
  if (mock.platformOS !== 'web' || !windowDefined) return false;
  const w = { SpeechRecognition: mock.hasSpeechRecognition, webkitSpeechRecognition: mock.hasWebkitSpeechRecognition };
  const mediaDevices = { getUserMedia: mock.hasGetUserMedia };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && !!mediaDevices?.getUserMedia;
}

check(
  '1. bare SpeechRecognition present (no webkit prefix) + getUserMedia → mic SHOWN',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasSpeechRecognition: true, hasWebkitSpeechRecognition: false, hasGetUserMedia: true }) === true,
);
check(
  '2. ONLY webkitSpeechRecognition present (real macOS Safari\'s exact shape — confirmed live, Safari 26.5) + getUserMedia → mic SHOWN',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasSpeechRecognition: false, hasWebkitSpeechRecognition: true, hasGetUserMedia: true }) === true,
);
check(
  '2b. genuine iPhone Safari — capability present, getUserMedia present → mic SHOWN (2026-08-25 ruling: capability detection is browser-name-blind; a genuine iPhone Safari failure is handled at RUNTIME via onFailure, never hidden ahead of time)',
  isVoiceInputSupportedReplica({ platformOS: 'web', hasWebkitSpeechRecognition: true, hasGetUserMedia: true }) === true,
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
  npmTestRuns(REPO_ROOT, 'verify-voice-safari-support-detection'),
);

console.log('');
if (failed) {
  console.error(`Safari/WebKit voice support-detection barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('Safari/WebKit voice support-detection barrier: all checks passed');
