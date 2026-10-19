// Server side of chat persistence (owner 2026-08-25 — ChatGPT-grade: conversations survive
// refresh, browser close, and logging back in on any device). Thin, typed CRUD over the
// `user_chats` table; store.tsx owns WHEN to call these (load-merge on sign-in, debounced
// write-through on change, delete propagation). All calls ride the signed-in Supabase session, and
// RLS pins every row to auth.uid() — there is no cross-user read or write path to defend here.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER (AGENTS.md, owner 2026-09-04) — enforced here, in the read
// path. supabase-js NEVER THROWS: a network/RLS failure resolves as `{ data: null, error }`, which is
// byte-identical to "the server holds nothing" at every call site downstream. `fetchChatTranscript`
// collapsed both into `null`, and that single conflation disarmed the `txStale` guard in
// src/lib/chatMerge.ts — the one mechanism standing between a stale cached transcript and the newer
// server copy it would be pushed over (ops_incident #272). The distinction is now carried in the
// return type, using the repo's existing sentinel rather than a second one invented here.
import { supabase } from '@/lib/supabase';
import { PROBE_FAILED, type ProbeFailed } from '@/lib/afProbe';
import type { PersistedChat } from '@/lib/chatTranscript';

// A read that never settles is not an empty answer either — it wedges the chat open forever. Every
// read below bounds its own await, the `.abortSignal()` mechanism src/data/locations.ts already uses.
const READ_TIMEOUT_MS = 15000;

// The sidebar-list envelope stored in `meta` — the HistoryItem minus its heavyweight fields
// (snapshot and transcript never ride in meta; transcript has its own column, snapshots are a
// local-cache concern only).
export type ChatMeta = Record<string, unknown> & { id: string; ts: number };

export type ServerChatRow = { id: string; meta: ChatMeta; updated_at: string };

const ready = () => !!supabase;

// Sidebar list load: metas only (small), newest first, same 50-entry bound the sidebar keeps.
//
// Already two-valued and stays that way: an account with no chats resolves as `[]` (an array), so
// `null` here means ONLY "the load failed" and never "you have no history". The caller must not
// treat it as an empty account — see the retry in store.tsx's pull effect.
export async function loadChatMetas(): Promise<ServerChatRow[] | null> {
  if (!ready()) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
  let data: unknown = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase!
      .from('user_chats')
      .select('id, meta, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50)
      .abortSignal(ac.signal));
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  if (error || !Array.isArray(data)) return null;
  return data.filter((r) => r && typeof r.id === 'string' && r.meta && typeof r.meta === 'object') as ServerChatRow[];
}

// Lazy transcript hydration for one opened chat.
//
// THREE-VALUED, deliberately:
//   PersistedChat  the server holds this conversation
//   null           the server ANSWERED and holds no transcript for this chat (legacy row, or a row
//                  whose transcript column is null) — a settled fact the caller may act on
//   PROBE_FAILED   we never learned what the server holds (network, RLS, timeout) — NOT a fact
//
// Returning `null` for the third case is what let an unverified local copy be marked fresh and
// pushed over the server's newer one. `null` now means only what it says.
export async function fetchChatTranscript(id: string): Promise<PersistedChat | null | ProbeFailed> {
  if (!ready()) return PROBE_FAILED;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
  let data: { transcript?: unknown } | null = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase!
      .from('user_chats').select('transcript').eq('id', id).abortSignal(ac.signal).maybeSingle());
  } catch (e) {
    error = e;                    // an aborted read rejects rather than resolving — still a failure
  } finally {
    clearTimeout(timer);
  }
  if (error) return PROBE_FAILED;
  if (!data) return null;         // maybeSingle(): no row at all — the server answered "none"
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

/**
 * Which chats may the push effect DELETE from the server this cycle, and which requests may it
 * forget? (ops_incident #297.)
 *
 * THE DIFFERENCE WAS NEVER THE ORACLE. The push effect used to derive deletions as
 * `baseline \ currentlyDisplayed`. That reads "this chat is not on screen" as "the user deleted
 * this chat", and those are different claims the moment anything other than a deletion can take a
 * chat off screen — which the sidebar's 50-entry DISPLAY cap does routinely:
 *
 *   · hold 50 synced chats and start a 51st — `[next, ...rest].slice(0, 50)` drops the oldest id;
 *   · sign in where local ∪ server exceeds 50 — the merge slices the union;
 *   · a server row whose meta the merge skips as malformed — the id never enters the list at all.
 *
 * In every one of those the row was still in the baseline, so the diff called it deleted and the
 * server copy went permanently, on every device, with no user action. A display cap performed a
 * data deletion.
 *
 * So deletion is INTENT-DRIVEN here: `requested` contains only ids that `deleteHistory()` or
 * `clearHistory()` put there. `displayed` is deliberately NOT a parameter — there is no argument
 * this function could take it for, and leaving it out is what makes "eviction cannot delete" true
 * by construction rather than by a condition someone can later relax.
 *
 * `forget` is the bookkeeping half: an id the server is not known to hold needs no delete and must
 * not be retried forever. An id that IS held stays queued until its delete actually succeeds.
 *
 * Pure, so scripts/verify-chat-eviction-is-not-a-deletion.ts can execute it.
 */
export function chatsToDelete(
  serverHolds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  requested: Iterable<string>,
): { toDelete: string[]; forget: string[] } {
  const holds = (id: string) => (serverHolds instanceof Map ? serverHolds.has(id) : (serverHolds as ReadonlySet<string>).has(id));
  const toDelete: string[] = [];
  const forget: string[] = [];
  for (const id of new Set(requested)) (holds(id) ? toDelete : forget).push(id);
  return { toDelete, forget };
}
