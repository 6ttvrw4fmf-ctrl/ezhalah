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
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { classifyMicCaptureError, classifyRecognitionError } from '../src/lib/voiceErrors.ts';

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
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url).pathname, 'utf8');

console.log('\nVoice-input error-classification barrier (owner report 2026-08-24)\n');

// ── EXECUTED: the REAL classifier, not the shape of its source text ─────────────────────────────
//
// These four assertions used to be regexes over the `rec.onerror` closure — the only option, since
// voiceInput.ts imports react-native and touches `window`, so no Node check could reach the rule.
// Source-text assertions have the wrong sensitivity in BOTH directions: they pass a refactor that
// changes behaviour (rewrite the ternary as an if/else with the branches swapped and every regex
// above still matched) and fail a rename that changes nothing. The rule now lives in the
// import-free `src/lib/voiceErrors.ts`, so what runs here is what runs on the device.
check(
  "'no-speech' is IGNORED — routine silence, covered by onend's keep-alive restart, never surfaced",
  classifyRecognitionError('no-speech').action === 'ignore',
);
check(
  "'aborted' is IGNORED — an engine hiccup is not a failure the user is told about",
  classifyRecognitionError('aborted').action === 'ignore',
);
check(
  "'not-allowed' is the ONLY code that means DENIED — the one case where 'enable it in your settings' is correct advice",
  (() => { const r = classifyRecognitionError('not-allowed'); return r.action === 'fail' && r.kind === 'denied'; })(),
);
// The 2026-08-24 bug in both of its halves: 'service-not-allowed' was called a permission problem,
// and everything unlisted was swallowed with no feedback at all.
for (const code of ['service-not-allowed', 'audio-capture', 'network', 'bad-grammar', 'language-not-supported']) {
  const r = classifyRecognitionError(code);
  check(
    `'${code}' fails as BLOCKED, never denied — it is a real failure but not a permission problem`,
    r.action === 'fail' && r.kind === 'blocked' && r.detail === code,
  );
}
// The catch-all is the load-bearing part: a code nobody has seen yet must still resolve gracefully,
// or the composer stays stuck in recording mode forever — the original silent-swallow bug.
for (const weird of ['a-code-from-2030', '', null, undefined, 0]) {
  const r = classifyRecognitionError(weird);
  check(
    `an unknown/empty code (${JSON.stringify(weird)}) still FAILS gracefully as blocked, never silently`,
    r.action === 'fail' && r.kind === 'blocked' && !!r.detail,
  );
}
check(
  "an empty code still carries a non-empty detail ('unknown-error') — an empty parenthesis in the diagnostic tag tells a retester nothing, which is the gap that instrumentation exists to close",
  classifyRecognitionError('').detail === 'unknown-error',
);
// getUserMedia's rejection is a DIFFERENT signal and was already correct; pin it so a future edit
// cannot quietly merge the two classifications.
check(
  "getUserMedia's NotAllowedError/SecurityError map to 'denied' — our own mic request owns the prompt, so its rejection IS the reliable cross-browser denial",
  classifyMicCaptureError('NotAllowedError').kind === 'denied' && classifyMicCaptureError('SecurityError').kind === 'denied',
);
for (const name of ['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError', '']) {
  check(
    `getUserMedia's ${name || '(empty)'} maps to 'unavailable' — a device/state problem must not send someone into their browser settings`,
    classifyMicCaptureError(name).kind === 'unavailable',
  );
}
check('an empty getUserMedia error name still reports a detail', classifyMicCaptureError('').detail === 'unknown');

// ── SOURCE: production really routes through the executed rule ──────────────────────────────────
// An extracted classifier nothing calls is decoration; these two keep the executed checks connected
// to the code path a user actually hits.
const onerrorBody = voice.match(/rec\.onerror = \(ev: any\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
check(
  'the recognizer error path calls classifyRecognitionError and acts on its verdict — no second copy of the rule inline',
  /classifyRecognitionError\(ev\?\.error\)/.test(onerrorBody)
    && /verdict\.action === 'ignore'/.test(onerrorBody)
    && /handlers\.onFailure\(verdict\.kind, verdict\.detail\)/.test(onerrorBody)
    && !/'not-allowed' \? 'denied'/.test(onerrorBody),
);
check(
  "getUserMedia's catch routes through classifyMicCaptureError rather than re-inlining the name check",
  /classifyMicCaptureError\(err\?\.name\)/.test(voice) && !/name === 'NotAllowedError' \|\| name === 'SecurityError'/.test(voice),
);
check(
  'voiceErrors.ts stays import-free, so this barrier can keep EXECUTING it',
  !/^\s*import\s/m.test(readFileSync(new URL('../src/lib/voiceErrors.ts', import.meta.url).pathname, 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')),
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
  "'service-not-allowed' resolves to the plain 'not supported' text (the SAME key isVoiceInputSupported's own gate uses) — owner ruling 2026-08-25: on the owner's real iPhone every checkable iOS setting (Lockdown Mode off, Screen Time restriction allowed, Siri on) was already correct and it still failed, only in Safari; with no configurable cause left, this reuses the existing 'not supported' string rather than a Safari-specific troubleshooting text that had already proven unhelpful",
  /: detail === 'service-not-allowed'\s*\n\s*\? t\('Voice input is not supported on this browser'\)\s*\n\s*: kind === 'blocked'/.test(onFailureBody),
);
const msgTernary = onFailureBody.match(/const msg = kind === 'denied'[\s\S]*?: t\('Voice input is not available right now\.'\);/)?.[0] ?? '';
check(
  'no Safari-specific settings-troubleshooting STRING (Lockdown Mode / Screen Time / Siri+Dictation) survives in the message-selection ternary itself — the whole approach was retired, not merely reworded (a surrounding explanatory comment naming the investigation history is fine; the user-facing string is what matters here)',
  msgTernary.length > 0 && !/Lockdown Mode|Screen Time|Siri and Dictation/.test(msgTernary),
);

// ── i18n: the 'blocked' Arabic string exists, is non-empty, and carries no Latin leak ────────────
const arEntry = i18n.match(/"The microphone couldn't be reached\. Please try again\.": '([^']+)'/)?.[1] ?? '';
check(
  "the 'blocked' message has a real Arabic dictionary entry",
  arEntry.length > 0,
);
check(
  'that Arabic entry contains no Latin-letter leak',
  arEntry.length > 0 && !/[a-zA-Z]/.test(arEntry),
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
  "onFailure's detail param threads from getUserMedia's own catch (the error's .name, e.g. 'NotReadableError') — retargeted 2026-09-03 to the executed classifier, which now carries the name through as `detail`",
  /handlers\.onFailure\(mic\.kind, mic\.detail\)/.test(voice)
    && classifyMicCaptureError('NotReadableError').detail === 'NotReadableError',
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
  // 'service-not-allowed' resolves to the plain 'not supported' text — reusing the SAME string
  // isVoiceInputSupported's own capability gate uses — while every other blocked/denied/unavailable
  // case is unaffected. Owner ruling, 2026-08-25: a Safari-specific troubleshooting message (naming
  // Lockdown Mode/Screen Time/Siri/Dictation) was tried and shown to be unhelpful on the owner's real
  // device — every one of those settings was already correct and it still failed, only in Safari —
  // so the message was simplified rather than iterated on further.
  const DENIED_MSG = 'settings-check-text';
  const NOT_SUPPORTED_MSG = 'not-supported-text';
  const BLOCKED_MSG = 'try-again-text';
  const UNAVAILABLE_MSG = 'not-available-text';
  const selectMessage = (kind: string, detail?: string) =>
    kind === 'denied' ? DENIED_MSG
    : detail === 'service-not-allowed' ? NOT_SUPPORTED_MSG
    : kind === 'blocked' ? BLOCKED_MSG
    : UNAVAILABLE_MSG;
  check("kind='denied' always wins, regardless of detail", selectMessage('denied', 'service-not-allowed') === DENIED_MSG);
  check("kind='blocked' + detail='service-not-allowed' → the plain 'not supported' text, not the generic 'try again'", selectMessage('blocked', 'service-not-allowed') === NOT_SUPPORTED_MSG);
  check("kind='blocked' + any OTHER detail (e.g. 'audio-capture') → the generic 'try again' text, unaffected by the service-not-allowed branch", selectMessage('blocked', 'audio-capture') === BLOCKED_MSG);
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
  npmTestRuns(REPO_ROOT, 'verify-voice-error-classification'),
);

console.log('');
if (failed) {
  console.error(`voice error-classification barrier: ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('voice error-classification barrier: all checks passed');
