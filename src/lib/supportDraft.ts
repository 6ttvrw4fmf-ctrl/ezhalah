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
