// Server side of chat persistence (owner 2026-08-25 — ChatGPT-grade: conversations survive
// refresh, browser close, and logging back in on any device). Thin, typed CRUD over the
// `user_chats` table; store.tsx owns WHEN to call these (load-merge on sign-in, debounced
// write-through on change, delete propagation). All calls ride the signed-in Supabase session, and
// RLS pins every row to auth.uid() — there is no cross-user read or write path to defend here.
import { supabase } from '@/lib/supabase';
import type { PersistedChat } from '@/lib/chatTranscript';

// The sidebar-list envelope stored in `meta` — the HistoryItem minus its heavyweight fields
// (snapshot and transcript never ride in meta; transcript has its own column, snapshots are a
// local-cache concern only).
export type ChatMeta = Record<string, unknown> & { id: string; ts: number };

export type ServerChatRow = { id: string; meta: ChatMeta; updated_at: string };

const ready = () => !!supabase;

// Sidebar list load: metas only (small), newest first, same 50-entry bound the sidebar keeps.
export async function loadChatMetas(): Promise<ServerChatRow[] | null> {
  if (!ready()) return null;
  const { data, error } = await supabase!
    .from('user_chats')
    .select('id, meta, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return null;
  return data.filter((r) => r && typeof r.id === 'string' && r.meta && typeof r.meta === 'object') as ServerChatRow[];
}

// Lazy transcript hydration for one opened chat.
export async function fetchChatTranscript(id: string): Promise<PersistedChat | null> {
  if (!ready()) return null;
  const { data, error } = await supabase!.from('user_chats').select('transcript').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return (data.transcript as PersistedChat) ?? null;
}

// Write-through for changed chats. `transcript` is written only when the caller holds one locally —
// undefined leaves the server's stored transcript untouched (an entry whose local transcript was
// pruned for space must never null the server copy that outlives it).
export async function upsertChat(id: string, meta: ChatMeta, transcript: PersistedChat | undefined): Promise<boolean> {
  if (!ready()) return false;
  const row: Record<string, unknown> = { id, meta, updated_at: new Date().toISOString() };
  if (transcript !== undefined) row.transcript = transcript;
  const { error } = await supabase!.from('user_chats').upsert(row, { onConflict: 'id' });
  return !error;
}

export async function deleteChats(ids: string[]): Promise<boolean> {
  if (!ready() || ids.length === 0) return true;
  const { error } = await supabase!.from('user_chats').delete().in('id', ids);
  return !error;
}

export async function deleteAllChats(): Promise<boolean> {
  if (!ready()) return true;
  // RLS scopes the delete to the caller's own rows; no explicit user filter needed or possible
  // (the client does not know its auth UUID).
  const { error } = await supabase!.from('user_chats').delete().neq('id', '');
  return !error;
}
