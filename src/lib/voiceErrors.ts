// How a SpeechRecognition error code becomes something a person can act on, with NO imports on
// purpose (routine #6, 2026-09-03) — so a barrier can EXECUTE this decision instead of grepping for
// it. `lib/voiceInput.ts` imports react-native and touches `window`, so the rule it applied lived
// inside an `onerror` closure that no Node check could ever run; `verify-voice-error-classification`
// asserted on the SHAPE OF THE SOURCE TEXT instead. That passes a refactor that changes behaviour
// and fails a rename that changes nothing — the wrong sensitivity in both directions.
//
// THE RULE, AND WHY EACH BRANCH EXISTS (owner report, 2026-08-24, real iPhone Safari):
//
//   'no-speech' | 'aborted'  → IGNORE. Routine: silence, or an engine hiccup. onend's keep-alive
//                              restarts the recognizer. Silence must never auto-submit and never
//                              end the session (owner brief §6).
//   'not-allowed'            → DENIED. The ONE code that means the user or the OS genuinely refused
//                              microphone permission, and therefore the ONLY one that may show the
//                              "enable it in your browser settings" message.
//   anything else            → BLOCKED. A real failure that is NOT a permission problem:
//                              'service-not-allowed' (the recognition service refused or throttled
//                              — on iOS this is the documented signature of Lockdown Mode or a
//                              Screen Time "Speech Recognition & Dictation" restriction, neither
//                              detectable from JavaScript), 'audio-capture' (the mic session could
//                              not be captured), 'network', or any future code nobody has seen yet.
//
// The original bug had two halves and this shape fixes both: 'service-not-allowed' was mapped to
// DENIED, telling people to fix a permission that was already granted; and every other code was
// swallowed with no feedback at all, leaving the composer stuck in recording mode forever. The
// catch-all is the load-bearing part — an unknown code must resolve gracefully, never silently.
export type VoiceErrorVerdict =
  | { action: 'ignore' }
  | { action: 'fail'; kind: 'denied' | 'blocked'; detail: string };

/** Codes the session survives: the recognizer restarts itself and the user is told nothing. */
export const ROUTINE_RECOGNITION_CODES = ['no-speech', 'aborted'] as const;

/** The only code that means "permission was refused" — everything else is a non-permission failure. */
export const PERMISSION_DENIED_CODE = 'not-allowed';

export function classifyRecognitionError(rawCode: unknown): VoiceErrorVerdict {
  const code = String(rawCode ?? '');
  if ((ROUTINE_RECOGNITION_CODES as readonly string[]).includes(code)) return { action: 'ignore' };
  return {
    action: 'fail',
    kind: code === PERMISSION_DENIED_CODE ? 'denied' : 'blocked',
    // An empty code still has to say something: 'unknown-error' is what reaches the user's
    // diagnostic tag (PR #1053's instrumentation), and an empty parenthesis there tells a retester
    // nothing — the exact gap that instrumentation exists to close.
    detail: code || 'unknown-error',
  };
}

/**
 * getUserMedia's rejection, which is a DIFFERENT signal from the recognizer's.
 *
 * This one is the reliable cross-browser denial: our own mic request owns the permission prompt, so
 * its `NotAllowedError` / `SecurityError` genuinely means refused. Everything else there
 * ('NotFoundError', 'NotReadableError', 'OverconstrainedError', an abort) is a device or state
 * problem, not a permission one, and must not send someone into their browser settings.
 */
export function classifyMicCaptureError(errName: unknown): { kind: 'denied' | 'unavailable'; detail: string } {
  const name = String(errName ?? '') || 'unknown';
  return { kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable', detail: name };
}
