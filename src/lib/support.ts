// The in-app «تواصل معنا» form's network call (owner request, 2026-09-02).
//
// The rules live in lib/supportDraft.ts (pure, import-free, executed directly by the barrier); this
// file is only the single call out. It never throws: every failure is a returned reason, so the
// form can offer «حاول مرة أخرى» instead of dying inside a render.
//
// No secret of any kind lives here. The browser holds the publishable key and nothing else; the
// service-role key and any future mail-provider key exist only inside the edge function.
import { supabase } from '@/lib/supabase';
import { validateSupportMessage, type SupportDraft } from '@/lib/supportDraft';

export {
  MESSAGE_MAX, MESSAGE_MIN, SUBJECT_MAX, SUBJECT_MIN, validateSupportMessage,
  forgetSupportDraft, recallSupportDraft, rememberSupportDraft,
} from '@/lib/supportDraft';
export type { SupportDraft, SupportField } from '@/lib/supportDraft';

export type SupportSendResult = { ok: true } | { ok: false; reason: 'invalid' | 'rate_limited' | 'failed' };

export async function sendSupportMessage(d: SupportDraft, locale: 'ar' | 'en'): Promise<SupportSendResult> {
  if (validateSupportMessage(d)) return { ok: false, reason: 'invalid' };
  try {
    if (!supabase) return { ok: false, reason: 'failed' };
    const { data, error } = await supabase.functions.invoke('support-message', {
      body: {
        subject: d.subject.trim(),
        message: d.message.trim(),
        email: d.email.trim(),
        locale,
        website: '', // honeypot — a real send always leaves it empty
      },
    });
    // supabase-js surfaces a non-2xx as `error` with the body unread; 429 is the one status the
    // form words differently, so dig it out of the response when it is there.
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      return { ok: false, reason: status === 429 ? 'rate_limited' : 'failed' };
    }
    return (data as { ok?: boolean } | null)?.ok ? { ok: true } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
