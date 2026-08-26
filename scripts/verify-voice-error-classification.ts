// Voice-input error-classification barrier (owner report, 2026-08-24 — real iPhone Safari: mic
// button showed, tap produced "نحتاج إذن المايكروفون للإدخال الصوتي. فعّله من إعدادات المتصفح."
// i.e. the PERMISSION-DENIED message). Root cause: rec.onerror only ever recognized two codes —
// 'not-allowed' and 'service-not-allowed' — and mapped BOTH straight to 'denied' ("enable it in
// your settings"). But 'service-not-allowed' means the recognition SERVICE refused/throttled the
// request (nothing to do with permission), and 'audio-capture' (the mic hardware/session couldn't
// be captured — a real, documented iOS Safari failure mode when a second concurrent audio capture
// races the recognizer's own internal one) wasn't handled AT ALL: it silently did nothing, leaving
// the composer stuck in "recording" mode forever with zero feedback. Both are real bugs, independent
// of which one actually fired on the owner's phone.
//
// The fix: 'not-allowed' is the ONLY code that means "the user/OS refused permission" → 'denied'.
// EVERY other code (service-not-allowed, audio-capture, network, or anything else) now falls
// through to a new 'blocked' kind with its own honest "couldn't reach it, try again" message —
// never the settings-check text, which would be wrong advice for a non-permission failure. A
// second change awaits the AudioContext resume before starting the recognizer (previously
// fire-and-forget), removing a race between two audio-session operations that is a documented
// source of spurious recognizer failures on iOS Safari specifically.
//
//   node --experimental-strip-types scripts/verify-voice-error-classification.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const voice = readFileSync(new URL('../src/lib/voiceInput.ts', import.meta.url).pathname, 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url).pathname, 'utf8');
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url).pathname, 'utf8');

console.log('\nVoice-input error-classification barrier (owner report 2026-08-24)\n');

// ── SOURCE: the onerror body ─────────────────────────────────────────────────────────────────────
const onerrorBody = voice.match(/rec\.onerror = \(ev: any\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  "'no-speech'/'aborted' still short-circuit BEFORE teardown — routine silence/hiccup, covered by onend's keep-alive restart, never surfaced as a failure",
  /if \(code === 'no-speech' \|\| code === 'aborted'\) return;/.test(onerrorBody),
);
check(
  "every OTHER code reaches teardown() + handlers.onFailure(...) — no code can silently do nothing (the exact 'audio-capture' bug: previously ANY code besides not-allowed/service-not-allowed produced zero feedback and left the composer stuck in recording mode forever)",
  /if \(code === 'no-speech' \|\| code === 'aborted'\) return;\s*\n\s*teardown\(\);\s*\n[\s\S]{0,700}handlers\.onFailure\(code === 'not-allowed' \? 'denied' : 'blocked', code \|\| 'unknown-error'\);/.test(onerrorBody),
);
check(
  "'not-allowed' is the ONLY code mapped to 'denied' — service-not-allowed/audio-capture/network/anything else fall through to 'blocked', never the permission message",
  /handlers\.onFailure\(code === 'not-allowed' \? 'denied' : 'blocked', code \|\| 'unknown-error'\)/.test(onerrorBody),
);
check(
  "getUserMedia's own catch block is untouched — NotAllowedError/SecurityError still map to 'denied', everything else to 'unavailable' (that classification was already correct; only the RECOGNIZER's error mapping was the bug)",
  /name === 'NotAllowedError' \|\| name === 'SecurityError' \? 'denied' : 'unavailable'/.test(voice),
);

// ── SOURCE: 'blocked' is a real, typed kind — not a stringly-typed afterthought ─────────────────
check(
  "VoiceHandlers.onFailure's kind union includes 'blocked' alongside denied/unavailable/error",
  /onFailure: \(kind: 'denied' \| 'unavailable' \| 'blocked' \| 'error', detail\?: string\) => void;/.test(voice),
);

// ── SOURCE: the resume() race fix ────────────────────────────────────────────────────────────────
check(
  'audioCtx.resume() is AWAITED (not fire-and-forget) before the recognizer starts — removes the race between two audio-session operations that is a documented iOS Safari failure source',
  /await audioCtx!\.resume\?\.\(\)\.catch\(\(\) => \{\}\);/.test(voice) &&
    !/void audioCtx!\.resume\?\./.test(voice),
);
check(
  'a cancellation during that resume-await is still honored (gen check immediately after) — lifecycle safety is not weakened by the new await point',
  /await audioCtx!\.resume\?\.\(\)\.catch\(\(\) => \{\}\);\s*\n\s*if \(gen !== generation\) return false;/.test(voice),
);

// ── SOURCE: agent.tsx surfaces THREE distinct messages, not two — 'blocked' never reuses the
//    settings-check text, and never silently reuses the plain "not available" text either ────────
const onFailureBody = agent.match(/onFailure: \(kind, detail\) => \{[\s\S]*?\n      \},/)?.[0] ?? '';
check(
  "agent.tsx's onFailure handler branches on kind === 'blocked' with its OWN t() string, distinct from both the 'denied' settings-check text and the generic 'not available' fallback",
  /kind === 'blocked'\s*\n\s*\? t\("The microphone couldn't be reached\. Please try again\."\)/.test(onFailureBody),
);
check(
  "the 'denied' branch (settings-check text) is evaluated FIRST and only for kind === 'denied' — 'blocked' can never fall into it",
  /const msg = kind === 'denied'\s*\n\s*\? t\('Microphone access is needed[^']*'\)\s*\n\s*: detail === 'service-not-allowed'/.test(onFailureBody),
);
check(
  "'service-not-allowed' gets its own actionable message ahead of the generic 'blocked' text — Apple's on-device speech service refusing (Dictation off / no on-device Arabic model) is real, distinct, and fixable by the USER via one iOS setting, unlike a generic service hiccup (owner report, 2026-08-24: this exact code fired on a real iPhone after mic permission was already granted)",
  /: detail === 'service-not-allowed'\s*\n\s*\? t\('Speech recognition is turned off on your device\. Make sure Siri and Dictation are both enabled in your iPhone Settings, then try again\.'\)\s*\n\s*: kind === 'blocked'/.test(onFailureBody),
);

// ── i18n: both new Arabic strings exist, are non-empty, and carry no Latin leak ──────────────────
const arEntry = i18n.match(/"The microphone couldn't be reached\. Please try again\.": '([^']+)'/)?.[1] ?? '';
check(
  "the 'blocked' message has a real Arabic dictionary entry",
  arEntry.length > 0,
);
check(
  'that Arabic entry contains no Latin-letter leak',
  arEntry.length > 0 && !/[a-zA-Z]/.test(arEntry),
);
const serviceArEntry = i18n.match(/'Speech recognition is turned off on your device\. Make sure Siri and Dictation are both enabled in your iPhone Settings, then try again\.': '([^']+)'/)?.[1] ?? '';
check(
  "the 'service-not-allowed' message has a real Arabic dictionary entry",
  serviceArEntry.length > 0,
);
check(
  'that Arabic entry ALSO carries no Latin-letter leak (iPhone renders as the already-established آيفون, not the Latin word — matches the existing i18n entry for "iPhone")',
  serviceArEntry.length > 0 && !/[a-zA-Z]/.test(serviceArEntry),
);

// ── EXECUTED: a faithful replica of the onerror classification, run against every code that
//    matters — proves the fix behaviorally, not just by source shape. ───────────────────────────
function classifyRecognizerError(code: string): { failed: boolean; kind?: string } {
  if (code === 'no-speech' || code === 'aborted') return { failed: false };
  return { failed: true, kind: code === 'not-allowed' ? 'denied' : 'blocked' };
}

check('no-speech is routine — never surfaced as a failure', classifyRecognizerError('no-speech').failed === false);
check('aborted is routine — never surfaced as a failure', classifyRecognizerError('aborted').failed === false);
check("not-allowed → 'denied' (the one true permission-refusal code)", classifyRecognizerError('not-allowed').kind === 'denied');
check(
  "service-not-allowed → 'blocked', NOT 'denied' — this is the exact owner-reported bug: a service-level refusal must never claim permission was the problem",
  classifyRecognizerError('service-not-allowed').kind === 'blocked',
);
check(
  "audio-capture → 'blocked' (previously: nothing at all — the composer hung silently in recording mode)",
  classifyRecognizerError('audio-capture').kind === 'blocked',
);
check("network → 'blocked'", classifyRecognizerError('network').kind === 'blocked');
check(
  "an unrecognized/future code (e.g. bad-grammar) still resolves gracefully to 'blocked' — never silently swallowed",
  classifyRecognizerError('bad-grammar').failed === true && classifyRecognizerError('bad-grammar').kind === 'blocked',
);

// ── Diagnostic detail threading (owner report, 2026-08-24 — two blind fixes both missed on a real
//    iPhone; without seeing the actual API code, further fixes are guesses). Every onFailure call
//    site now passes the short, standardized code that caused it, and the UI appends it as a
//    parenthetical tag — never a raw Error message/stack, never silently dropped. ─────────────────
check(
  "onFailure's detail param threads from getUserMedia's own catch (the error's .name, e.g. 'NotReadableError')",
  /handlers\.onFailure\(name === 'NotAllowedError' \|\| name === 'SecurityError' \? 'denied' : 'unavailable', name\)/.test(voice),
);
check(
  "the unsupported early-return and the two rec.start() throw sites all pass a non-empty detail too — no onFailure call site is silently detail-less",
  /handlers\.onFailure\('unavailable', 'unsupported'\)/.test(voice) &&
    /handlers\.onFailure\('error', `restart-threw:\$\{String\(err\?\.name \?\? err\?\.message \?\? 'unknown'\)\}`\)/.test(voice) &&
    /handlers\.onFailure\('unavailable', `start-threw:\$\{String\(err\?\.name \?\? err\?\.message \?\? 'unknown'\)\}`\)/.test(voice),
);
check(
  'agent.tsx appends the detail as a parenthetical ONLY when present — a call with no detail shows the plain human message, never "(undefined)"',
  /showVoiceNotice\(detail \? `\$\{msg\} \(\$\{detail\}\)` : msg\)/.test(agent),
);

{
  // EXECUTED: a faithful replica of agent.tsx's full message-selection ternary chain, proving
  // 'service-not-allowed' picks its own actionable text while every other blocked/denied/unavailable
  // case is unaffected (owner report, 2026-08-24: real iPhone hit exactly this code after mic
  // permission was already granted — "try again" is useless advice when the real fix is one
  // specific iOS toggle, so this code alone gets pulled out of the generic 'blocked' bucket).
  const DENIED_MSG = 'settings-check-text';
  const SERVICE_MSG = 'enable-dictation-text';
  const BLOCKED_MSG = 'try-again-text';
  const UNAVAILABLE_MSG = 'not-available-text';
  const selectMessage = (kind: string, detail?: string) =>
    kind === 'denied' ? DENIED_MSG
    : detail === 'service-not-allowed' ? SERVICE_MSG
    : kind === 'blocked' ? BLOCKED_MSG
    : UNAVAILABLE_MSG;
  check("kind='denied' always wins, regardless of detail", selectMessage('denied', 'service-not-allowed') === DENIED_MSG);
  check("kind='blocked' + detail='service-not-allowed' → the specific Dictation message, not the generic 'try again'", selectMessage('blocked', 'service-not-allowed') === SERVICE_MSG);
  check("kind='blocked' + any OTHER detail (e.g. 'audio-capture') → the generic 'try again' text, unaffected by the new branch", selectMessage('blocked', 'audio-capture') === BLOCKED_MSG);
  check("kind='blocked' with NO detail → still the generic 'try again' text", selectMessage('blocked', undefined) === BLOCKED_MSG);
  check("kind='unavailable' → the plain 'not available' fallback, untouched", selectMessage('unavailable', undefined) === UNAVAILABLE_MSG);
  check("kind='error' → the plain 'not available' fallback (no dedicated 'error' text exists)", selectMessage('error', undefined) === UNAVAILABLE_MSG);
}

{
  // EXECUTED: the exact message-composition line, proving both branches concretely.
  const compose = (msg: string, detail?: string) => (detail ? `${msg} (${detail})` : msg);
  check(
    'with a detail present, the composed notice is "<message> (<code>)" — exactly what a real-device report needs to be traceable',
    compose('غير متاح حالياً.', 'NotReadableError') === 'غير متاح حالياً. (NotReadableError)',
  );
  check(
    'with no detail, the composed notice is the plain message — no stray parenthesis ever appears',
    compose('غير متاح حالياً.', undefined) === 'غير متاح حالياً.',
  );
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
check(
  'this barrier is wired into `npm test`',
  /verify-voice-error-classification\.ts/.test(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8')),
);

console.log('');
if (failed) {
  console.error(`voice error-classification barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('voice error-classification barrier: all checks passed');
