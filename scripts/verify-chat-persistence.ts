// FULL-CONVERSATION PERSISTENCE + CONVERSATION IDENTITY (owner 2026-08-25):
// «Treat Ezhalah's chat like ChatGPT in terms of persistence. When I return to a previous chat, I
// should see exactly the conversation I left … and it must survive a page refresh, closing the
// browser, and logging back in. Do not make this only temporary frontend state. Do not create a
// separate fake history that can drift from the actual search state.»
//
// Three layers, each pinned here:
//   1. The PURE serialization contract (src/lib/chatTranscript.ts) — EXECUTED, with mutation-style
//      negative cases, not grepped.
//   2. CONVERSATION IDENTITY — a continuation turn updates its own chat; dedupe can never overwrite
//      a chat that holds a conversation (that was the fragmentation/loss bug).
//   3. The WIRING — agent capture/restore, store persistence + server sync, sidebar routing.
import { readFileSync } from 'node:fs';
import { mergeOne, withFreshTranscript } from '../src/lib/chatMerge.ts';
import { serializeChat, restoreChat, sameTranscript, TRANSCRIPT_LISTING_CAP, TRANSCRIPT_FIRST_PAGE, LOCAL_TRANSCRIPT_ENTRIES } from '../src/lib/chatTranscript.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nfull-conversation persistence (owner 2026-08-25)\n');

// ── 1. The pure serialization contract, executed ────────────────────────────────────────────────
const listing = (i: number) => ({ id: i, title: 'l' + i });
const mkResults = (id: string, n: number) => ({
  id, role: 'results', text: 'sub', summary: 'ملخص',
  result: { heading: '', notes: [], listings: Array.from({ length: n }, (_, i) => listing(i)), query: { deal: 'Buy' }, pageOffset: 77, hasMore: false },
});
const live = {
  msgs: [
    { id: 'u1', role: 'user', text: 'مصنع للإيجار', typing: false },
    { id: 's1', role: 'status', phase: 'searching' },              // transient — must be stripped
    mkResults('r1', 40),
    { id: 'a1', role: 'agent', text: 'وش رايك؟', typing: true },   // typing flag must be stripped
    mkResults('r2', 8),
  ],
  revealCount: { r1: 25, r2: 8, ghost: 5 },
  afReceipt: { r1: 'عرض الشارع: 15م فأكثر', ghost: 'x' },
  guidedPills: { msgId: 'r2', baseQ: { deal: 'Rent' }, facets: [{ id: 'street_width', keys: ['w15'], labels: ['15م'] }], asked: ['street_width'], total: 39 },
};
const t = serializeChat(live as any)!;
check('serialize: keeps user/agent/results, strips status turns', t.msgs.length === 4 && t.msgs.every((m) => m.role !== ('status' as any)));
check('serialize: strips typing flags (a restored chat renders final state)', t.msgs.every((m) => !('typing' in m)));
const r1 = t.msgs.find((m) => m.id === 'r1') as any;
check('serialize: results turn keeps exactly the cards the user revealed (25 of 40)', r1.result.listings.length === 25);
check('serialize: a truncated turn restarts paging (pageOffset 0 + hasMore) for gap-free «عرض المزيد»', r1.result.pageOffset === 0 && r1.result.hasMore === true);
const r2 = t.msgs.find((m) => m.id === 'r2') as any;
check('serialize: an un-truncated turn keeps its exact paging state', r2.result.listings.length === 8 && r2.result.pageOffset === 77 && r2.result.hasMore === false);
check('serialize: revealCount/afReceipt drop ids of messages that are not kept', !('ghost' in t.revealCount) && !('ghost' in t.afReceipt));
check('serialize: the cumulative AF pills record rides along (answers stay removable after restore)', t.guidedPills?.msgId === 'r2' && t.guidedPills.asked[0] === 'street_width');
check('serialize: an empty chat (greeting only) persists nothing', serializeChat({ msgs: [{ id: 'g', role: 'agent', text: 'ارحب', greeting: true }], revealCount: {}, afReceipt: {}, guidedPills: null } as any) === null);

const back = restoreChat(JSON.parse(JSON.stringify(t)))!;
check('restore: round-trips the serialized conversation', back !== null && back.msgs.length === 4 && sameTranscript({ v: 1, msgs: back.msgs, revealCount: back.revealCount, afReceipt: back.afReceipt, guidedPills: back.guidedPills }, t));
check('restore: marks every message done-typing (nothing re-types on a reopened chat)', back.msgs.every((m) => back.doneTyping[m.id] === true));
check('restore: rejects a wrong version', restoreChat({ ...t, v: 2 }) === null);
check('restore: rejects structurally-broken storage (results turn without listings)', restoreChat({ v: 1, msgs: [{ id: 'x', role: 'results', result: {} }], revealCount: {}, afReceipt: {}, guidedPills: null }) === null);
check('restore: rejects an empty transcript', restoreChat({ v: 1, msgs: [], revealCount: {}, afReceipt: {}, guidedPills: null }) === null);
check('bounds: listing cap and first-page floor are sane', TRANSCRIPT_LISTING_CAP >= 30 && TRANSCRIPT_FIRST_PAGE === 10 && LOCAL_TRANSCRIPT_ENTRIES >= 5);
const big = serializeChat({ ...live, revealCount: { r1: 500 } } as any)!;
check('bounds: reveal beyond the cap is clamped to TRANSCRIPT_LISTING_CAP', (big.msgs.find((m) => m.id === 'r1') as any).result.listings.length === Math.min(40, TRANSCRIPT_LISTING_CAP) && big.revealCount.r1 === TRANSCRIPT_LISTING_CAP);

// ── 2. Conversation identity (store) ────────────────────────────────────────────────────────────
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
check('a continuation turn names its chat: recordHistory(q, result, chatId) threaded from runQuery',
  /recordHistory = \(q: SearchQuery, result\?: SearchResult, chatId\?: string \| null\)/.test(store)
  && /recordHistory\(q, result, chatId\)/.test(store));
check('the named chat is looked up FIRST — a continuation can never fork a new sidebar entry',
  /const prior = \(chatId \? h\.find\(\(it\) => it\.id === chatId\) : undefined\)/.test(store));
check('query-dedupe applies ONLY to entries with no held conversation (a transcript is never overwritten by a lookalike search)',
  /\?\? \(!chatId \? h\.find\(\(it\) => !it\.transcript && sameQuery\(it\.query, q\)\) : undefined\)/.test(store));
check('a continuation carries the entry’s existing transcript through the update (never dropped between turns)',
  /\.\.\.\(prior\?\.transcript \? \{ transcript: prior\.transcript, tRev: prior\.tRev \} : \{\}\)/.test(store));
// Re-anchored 2026-08-25: the literal object spread moved into withFreshTranscript() when transcript
// PRECEDENCE was centralised in src/lib/chatMerge.ts. The invariant is unchanged and is now proved by
// EXECUTING the helper rather than matching its old spelling — `ts` must not move, `tRev` must.
check('saveTranscript stamps tRev, not ts (revealing more cards must not resort the sidebar)',
  // one tRev minted up front, shared by the direct disk write and the state update (flush-on-exit),
  // and routed through withFreshTranscript so a fresh capture also clears txStale.
  /const tRev = Date\.now\(\);/.test(store) && /withFreshTranscript\(h\[idx\] as never, transcript, tRev\)/.test(store));
{
  const before = { id: 'c', ts: 111, tRev: 1, transcript: { old: true }, txStale: true } as never;
  const after = withFreshTranscript(before, { fresh: true }, 999) as { ts: number; tRev: number; txStale?: boolean; transcript: unknown };
  check('…proved by execution: tRev moves', after.tRev === 999);
  check('…proved by execution: ts is untouched (the sidebar does not resort)', after.ts === 111);
  check('…proved by execution: the fresh transcript replaces the old one', JSON.stringify(after.transcript) === '{"fresh":true}');
  check('…proved by execution: a stale flag is cleared once a fresh transcript lands', after.txStale === undefined);
}

// ── 3a. Local persistence bounds ────────────────────────────────────────────────────────────────
check('every disk write routes through serializeHistoryForDisk (transcripts pruned to the recent-N cache)',
  !/localStorage\.setItem\(historyKey\([^)]*\), JSON\.stringify\(/.test(store)
  && (store.match(/serializeHistoryForDisk\(/g) ?? []).length >= 7);
check('pruning happens ONLY at the serialization boundary — in-memory state keeps every transcript',
  /const serializeHistoryForDisk = \(items: HistoryItem\[\]\): string =>/.test(store)
  && /slice\(0, LOCAL_TRANSCRIPT_ENTRIES\)/.test(store));

// ── 3b. Server sync (survives new browser / re-login) ───────────────────────────────────────────
// Re-anchored 2026-08-25: the inline stamp comparison moved into chatMerge.mergeOne() so the pull
// merge and hydrateTranscript cannot disagree about which copy is newer (they did — see
// scripts/verify-transcript-integrity.ts for the loss that caused). Executed, not matched.
check('pull: server metas merge after sign-in, via the single shared precedence rule',
  /loadChatMetas\(\)\.then\(\(rows\)/.test(store) && /mergeOne\(/.test(store)
  && !/serverStamp\s*>\s*localStamp/.test(store));
{
  const localOld = { id: 'c', ts: 10, tRev: 10, transcript: { n: 1 } } as never;
  const localNew = { id: 'c', ts: 99, tRev: 99, transcript: { n: 9 } } as never;
  check('…proved by execution: a NEWER SERVER entry wins the meta',
    (mergeOne(localOld, { id: 'c', ts: 50, tRev: 50 }) as { ts: number }).ts === 50);
  check('…proved by execution: a NEWER LOCAL entry is kept whole',
    (mergeOne(localNew, { id: 'c', ts: 50, tRev: 50 }) as { ts: number }).ts === 99);
  check('…proved by execution: a server-only chat appears',
    (mergeOne(undefined, { id: 'z', ts: 5 }) as { id: string }).id === 'z');
}
check('push: debounced write-through diffs per-entry activity stamps', /const stamp = Math\.max\(it\.ts, it\.tRev \?\? 0\);/.test(store));
check('push: gated on the pull having merged (a not-yet-merged list can never mass-delete server history)',
  /if \(syncReadyRef\.current !== historyKey\(user\.sub\)\) return; \/\/ push only after the pull merged/.test(store));
check('push: deletions propagate only for ids the server was known to hold', /const gone = \[\.\.\.base\.keys\(\)\]\.filter\(\(id\) => !seen\.has\(id\)\);/.test(store));
check('a transcript the local cache pruned is never nulled on the server (meta-only upsert)',
  /void upsertChat\(it\.id, chatMetaOf\(it\), it\.transcript\)/.test(store));
const sync = readFileSync(new URL('../src/lib/chatSync.ts', import.meta.url), 'utf8');
check('chatSync: upsert leaves the server transcript untouched when the caller holds none',
  /if \(transcript !== undefined\) row\.transcript = transcript;/.test(sync));
check('chatSync: metas load excludes the transcript column (sidebar load stays small)',
  /\.select\('id, meta, updated_at'\)/.test(sync));
const migration = readFileSync(new URL('../supabase/migrations/20260825180647_user_chats_full_conversation_persistence.sql', import.meta.url), 'utf8');
check('migration: user_chats is RLS-locked to auth.uid() with server-side identity default',
  /user_id uuid not null default auth\.uid\(\)/.test(migration)
  && /enable row level security/.test(migration)
  && /using \(user_id = auth\.uid\(\)\)/.test(migration)
  && /with check \(user_id = auth\.uid\(\)\)/.test(migration));
check('migration: PDPL — chats cascade away with the auth user (account deletion wipes conversations)',
  /references auth\.users \(id\) on delete cascade/.test(migration));

// ── 3c. Agent capture + restore wiring ──────────────────────────────────────────────────────────
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('agent: every live recorded turn names the conversation (ensureChatId on all 4 record calls)',
  (agent.match(/runQuery\([^)]*run\.ac\.signal, ensureChatId\(\)\)/g) ?? []).length === 4);
check('agent: a text turn keeps the same identity (recordChatTurn return adopted)',
  /const rid = recordChatTurn\(v\); if \(rid\) chatIdRef\.current = rid;/.test(agent));
check('agent: a fresh chat clears the conversation id (New Chat + startFresh inherit nothing)',
  (agent.match(/chatIdRef\.current = null;/g) ?? []).length >= 2);
check('agent: capture serializes the settled state, debounced and content-keyed',
  /const t = serializeChat\(\{ msgs: msgs as any, revealCount, afReceipt, guidedPills \}\);/.test(agent)
  && /if \(j === lastCapturedRef\.current\) return;/.test(agent)
  && /if \(busy\) return;/.test(agent));
check('agent: restore reinstates ALL FIVE state slices (msgs, doneTyping, revealCount, afReceipt, guidedPills)',
  /setMsgs\(restored\.msgs as unknown as ChatMsg\[\]\);/.test(agent)
  && /setDoneTyping\(restored\.doneTyping\);/.test(agent)
  && /setRevealCount\(restored\.revealCount\);/.test(agent)
  && /setAfReceipt\(restored\.afReceipt\);/.test(agent)
  // guidedPills is also deduped-by-label on restore (owner audit, 2026-08-27) — a chat saved before
  // that fix shipped could carry a stray duplicate pill baked into its serialized facets, and restore
  // must not resurrect it verbatim. Still reinstates the same `restored.guidedPills`, just through
  // dedupeFacetsByLabel first.
  && /setGuidedPills\(\(rgp && rgp\.facets \? \{ \.\.\.rgp, facets: dedupeFacetsByLabel\(rgp\.facets\) \} : rgp\) as any\);/.test(agent));
check('agent: restore adopts the chat id so continuing the conversation updates the SAME entry',
  /chatIdRef\.current = entryId \?\? null;/.test(agent));
check('agent: restore falls back to the server copy when the local cache was pruned',
  /if \(!t && entryId\) t = await hydrateTranscript\(entryId\)\.catch\(\(\) => null\);/.test(agent));
check('agent: restore never echo-writes what it just rendered', /lastCapturedRef\.current = JSON\.stringify\(t\);/.test(agent));
// FLUSH-ON-EXIT (owner 2026-08-26: «leaving the chat must never lose later messages»). The 600ms
// debounce alone had a real loss window: switching chats while the newest turn's cards were still
// cascading cleared the pending timer and the reopened chat showed an OLDER conversation. Every
// abandonment path must flush the pending capture first, and an unload flush must land on disk
// without depending on React state processing.
check('agent: the pending capture is tracked, and flushed by ONE function', /const pendingCaptureRef = useRef<\{ id: string; t: PersistedChat; j: string \} \| null>\(null\);/.test(agent) && /const flushPendingCapture = \(\) => \{/.test(agent));
check('agent: EVERY conversation-abandonment path flushes first (startFresh, openSaved, New Chat wipe)', (agent.match(/flushPendingCapture\(\);/g) ?? []).length >= 4);
check('agent: a web unload flushes too (pagehide covers refresh, close and bfcache)', /window\.addEventListener\('pagehide', flush\);/.test(agent));
check('store: saveTranscript writes disk DIRECTLY before setState — an unload-time flush cannot depend on React processing an update', /const direct = cur\.slice\(\);/.test(store) && /localStorage\.setItem\(historyKey\(user\.sub\), serializeHistoryForDisk\(direct\)\);/.test(store));
check('agent: the sidebar replay path routes through openSaved (transcript first, snapshot fallback)',
  /if \(replay === '0'\) void openSaved\(hid, q, override\);/.test(agent));

// ── 3d. Sidebar routing ─────────────────────────────────────────────────────────────────────────
const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
check('sidebar: EVERY chat opens through the replay path (chat-only entries restore too)',
  /router\.replace\(\{ pathname: '\/agent', params: \{ filter: JSON\.stringify\(c\.query\), replay: '0', hid: c\.id \} \}\);/.test(sidebar)
  && !/params: \{ fresh: String\(Date\.now\(\)\) \}/.test(sidebar));

console.log(failed ? `\n✗ ${failed} check(s) FAILED — conversation persistence is drifting` : '\n✓ conversations persist in full — exact transcript, one identity, local + server, ChatGPT-grade');
process.exit(failed ? 1 : 0);
