// The support form's rules, with NO imports on purpose (owner 2026-09-02).
//
// It lives apart from lib/support.ts — which reaches the network — so a barrier can import and
// EXECUTE the real validator instead of testing a copy of it. The same bounds are enforced again,
// independently, inside supabase/functions/support-message/index.ts: that copy is the authority,
// because anything can POST there. This one exists so the Send button can say what is missing
// without a round trip.
export const SUBJECT_MIN = 3, SUBJECT_MAX = 120;
export const MESSAGE_MIN = 10, MESSAGE_MAX = 4000;

export type SupportDraft = { subject: string; message: string; email: string };
export type SupportField = 'subject' | 'message' | 'email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The first field that is not yet sendable, or null when the draft is complete. */
export function validateSupportMessage(d: SupportDraft): SupportField | null {
  if (d.subject.trim().length < SUBJECT_MIN) return 'subject';
  if (d.message.trim().length < MESSAGE_MIN) return 'message';
  if (!EMAIL_RE.test(d.email.trim())) return 'email';
  return null;
}

// ── THE DRAFT SURVIVES THE DIALOG (routine #6, 2026-09-03) ──────────────────────────────────────
//
// This form's own design note says it plainly: "losing someone's typed problem report is the one
// outcome this form must never produce." That was honoured on the FAILED-SEND path — the error state
// keeps the draft on screen so «حاول مرة أخرى» resends what was typed — and nowhere else. The far
// likelier accident was unprotected: the form lives inside InfoModal's dialog, whose backdrop is a
// full-viewport Pressable that closes on tap, and closing UNMOUNTS SupportForm. All state is local
// `useState`, so a stray click a few pixels outside the card silently destroyed everything typed,
// with no confirmation, no undo, and nothing to reopen to.
//
// Measured against production, 2/2 in fresh desktop contexts (2026-09-03): a 126-character message
// plus subject and email, one click on the backdrop at x=12, reopen → all three fields empty. The X
// button does the same. Someone describing a bug in detail loses the description, at the exact
// moment they were already frustrated enough to write to support.
//
// THE FIX IS MEMORY, NOT DISK, AND THAT IS DELIBERATE. `store.tsx` records the standing rule for
// this app — "guests: session-only, nothing on disk" — because retaining an anonymous visitor's
// content on the device is what the owner ruled against. A support draft is a person's problem
// report and their email address; writing it to localStorage would be new at-rest retention on a
// PDPL surface, decided by a test engineer, to fix an accidental dismissal. The session-scoped cache
// below fixes exactly the reported loss (close → reopen) and adds no at-rest data at all. A refresh
// or a closed tab still clears it, which is the honest boundary — not an oversight.
//
// Sign-out and account deletion call `forgetSupportDraft()` alongside their other in-memory clears,
// so a freshly logged-out guest can never find the previous account's typed message waiting.
let cached: SupportDraft | null = null;

/** Hold the in-progress draft for the rest of this app session. An empty draft is nothing to keep. */
export function rememberSupportDraft(d: SupportDraft): void {
  cached = d.subject.trim() || d.message.trim() ? { ...d } : null;
}

/** The held draft, or null. A COPY — the caller owns its own state and must not alias the cache. */
export function recallSupportDraft(): SupportDraft | null {
  return cached ? { ...cached } : null;
}

/** Drop it: the message was sent, or the session it belonged to ended. */
export function forgetSupportDraft(): void {
  cached = null;
}
