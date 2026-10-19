// SHARED CHAT — the database half of «مشاركة» for a signed-in user (owner 2026-10-17). Three bounded RPCs
// over public.shared_chat (migration 20261018031834):
//   createSharedChat  saves a COPY of the conversation, returns its 8-character code (null = not saved)
//   fetchSharedChat   the whole copy for a signed-in recipient; PROBE_FAILED when the read failed, null
//                     when the server answered and there is no such chat — never conflated (afProbe.ts)
//   fetchSharedChatCard  the anon-readable card facts (name, locale, query) for the landing card
import { supabase } from './supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { PROBE_FAILED } from './afProbe';
import { isShareCode, sharedChatCardFrom, type SharedChatCard } from './shareSearch';
import { restoreChat, type PersistedChat } from './chatTranscript';
import type { SearchQuery } from '@/data/search';

const SHARE_RPC_MS = 8000;

export async function createSharedChat(name: string, locale: 'ar' | 'en', q: SearchQuery | null, transcript: PersistedChat): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<string>(
    supabase.rpc('create_shared_chat', { p_sender_name: name, p_locale: locale, p_query: q ?? {}, p_transcript: transcript }) as never,
    SHARE_RPC_MS,
  );
  return !error && typeof data === 'string' && isShareCode(data) ? data : null;
}

export type SharedChat = SharedChatCard & { transcript: PersistedChat };

export async function fetchSharedChat(code: string): Promise<SharedChat | null | typeof PROBE_FAILED> {
  if (!supabase || !isShareCode(code)) return null;
  const { data, error } = await boundedRpc<unknown[]>(supabase.rpc('get_shared_chat', { p_code: code }) as never, SHARE_RPC_MS);
  if (error) return PROBE_FAILED;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  const card = sharedChatCardFrom(row);
  const transcript = (row as { transcript?: unknown }).transcript as PersistedChat | undefined;
  if (!card || !transcript || !restoreChat(transcript)) return null;
  return { ...card, transcript };
}

export async function fetchSharedChatCard(code: string): Promise<SharedChatCard | null | typeof PROBE_FAILED> {
  if (!supabase || !isShareCode(code)) return null;
  const { data, error } = await boundedRpc<unknown[]>(supabase.rpc('shared_chat_card', { p_code: code }) as never, SHARE_RPC_MS);
  if (error) return PROBE_FAILED;
  return sharedChatCardFrom(Array.isArray(data) ? data[0] : null);
}
