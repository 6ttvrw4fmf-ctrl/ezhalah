-- mon_detect_transcript_integrity(): limb 2 was crying wolf on the common, by-design case, and
-- asserting a false consequence when it did.
--
-- ROOT CAUSE (routine #6, 2026-09-11). `user_chats` holds TWO legitimate lifecycles in one table:
-- a Filter search saved to the sidebar (meta carries `query`, never gets a transcript unless the
-- user later continues it in the Agent) and an Agent conversation (gets a transcript once a turn
-- settles, via saveTranscript() in src/store.tsx, which is the ONLY place `meta.tRev` is ever set).
-- The old WHERE clause fired on ANY row past the 30-minute grace with `transcript is null` and
-- `meta.ts` set, which matches BOTH lifecycles identically, and its note claimed "Opening this chat
-- ... restores nothing" for both.
--
-- That claim is FALSE for a pure Filter entry. Read end to end in src/store.tsx / src/app/agent.tsx:
-- `openSaved()` -> no transcript anywhere -> `openStatic()`, which renders the saved `snapshot`
-- instantly, or — when this device holds no snapshot either (a fresh device, or an entry beyond
-- SNAPSHOT_ENTRIES) — calls `runQuery(q, false)` and LIVE-REPLAYS the exact saved search. That is
-- the by-design fallback this feature has always had, not data loss.
--
-- Measured on production, 2026-09-11: 17 of 48 user_chats rows tripped this limb. 15 of the 17
-- carry `meta.tRev` — meaning a transcript WAS captured client-side for those chats at some point
-- (tRev is set nowhere else) — while the server's `transcript` column is null. THAT shape is a real
-- anomaly worth a permanent, narrower signal: the Agent CONTINUATION of those chats is unrecoverable
-- on a fresh device (the search itself still replays correctly via meta.query). The other 2 rows
-- carry no `tRev` at all — pure Filter-only searches never continued in the Agent, which is normal,
-- permanent, by-design state for a large fraction of every user's history and must never alert.
--
-- THE FIX distinguishes the two shapes instead of silencing the limb (AGENTS.md: "make it
-- distinguish cases, and prove both directions"):
--   · meta has no `tRev`  -> this chat was never captured with a transcript. NOT an anomaly. Do not
--                            alert (the query/snapshot replay path is the intended experience).
--   · meta HAS `tRev`     -> a transcript existed client-side and never reached (or was lost from)
--                            the server. Keep alerting, P2, with an ACCURATE note: the search itself
--                            still restores; the agent conversation beyond it does not.
--
-- The offline predicate this mirrors is pinned in
-- scripts/verify-transcript-missing-detector-distinguishes-cases.ts, which asserts BOTH directions
-- against the exact shapes measured above (with-tRev alerts, without-tRev does not) so this rule
-- cannot silently regress back into crying wolf. `ops_incident` #174.
create or replace function public.mon_detect_transcript_integrity()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; rec record;
  grace constant interval := interval '30 minutes';
  k_shrank      text[] := '{}';
  k_missing     text[] := '{}';
  k_unreachable text[] := '{}';
  k_invalid     text[] := '{}';
begin
  -- 1. HISTORY SHRANK -- the defect itself, P1 (unchanged)
  for rec in
    select c.id, c.user_id,
           jsonb_array_length(c.transcript->'msgs') as now_msgs,
           w.max_msgs, w.max_seen_at
    from public.user_chats c
    join public.mon_chat_transcript_watermark w on w.chat_id = c.id
    where c.transcript is not null
      and jsonb_typeof(c.transcript->'msgs') = 'array'
      and jsonb_array_length(c.transcript->'msgs') < w.max_msgs
  loop
    k_shrank := k_shrank || ('transcript_shrank:'||rec.id);
    n := n + public.mon_raise('P1','transcript_shrank','chat','transcript_shrank:'||rec.id,
      jsonb_build_object('chat_id',rec.id,'now_msgs',rec.now_msgs,'was_msgs',rec.max_msgs,
        'high_water_at',rec.max_seen_at,
        'note','A stored conversation LOST turns. This is user-visible history loss: a stale client '
            ||'cache overwrote a newer server copy, or a partial write landed. Do not "fix" by '
            ||'resetting the watermark - recover the transcript and find the write that shortened it.'));
  end loop;

  -- 2. A CHAT WHOSE TRANSCRIPT WAS CAPTURED BUT NEVER LANDED ON THE SERVER, past the grace window.
  -- Gated on `meta ? 'tRev'` -- that key is set in exactly one place client-side (saveTranscript(),
  -- src/store.tsx), so its presence is proof a transcript existed for this chat. Its absence means
  -- this row is a Filter-only search that was never continued in the Agent, which never gets a
  -- transcript by design and must not alert (see the routine #6 note above this function).
  for rec in
    select c.id, c.updated_at from public.user_chats c
    where c.transcript is null and c.meta is not null
      and (c.meta->>'ts') is not null
      and (c.meta ? 'tRev')
      and c.updated_at < now() - grace
  loop
    k_missing := k_missing || ('transcript_missing:'||rec.id);
    n := n + public.mon_raise('P2','transcript_missing_for_chat','chat','transcript_missing:'||rec.id,
      jsonb_build_object('chat_id',rec.id,'chat_updated_at',rec.updated_at,
        'note','This chat''s meta carries tRev (src/store.tsx saveTranscript() is the only place '
            ||'that key is ever set), so a transcript existed client-side but the server holds none. '
            ||'The saved SEARCH still restores correctly (meta.query/snapshot replay) -- the AGENT '
            ||'CONVERSATION beyond it does not, on a device without the local cache. Recover the '
            ||'transcript if still held on any device, or accept the loss is bounded to the agent '
            ||'turns; do not treat this as "restores nothing".'));
  end loop;

  -- 3. A TRANSCRIPT WITH NO USABLE SIDEBAR ENTRY (unreachable conversation) -- unchanged
  for rec in
    select c.id from public.user_chats c
    where c.transcript is not null
      and (c.meta is null or (c.meta->>'ts') is null or c.meta->'query' is null)
  loop
    k_unreachable := k_unreachable || ('transcript_unreachable:'||rec.id);
    n := n + public.mon_raise('P1','transcript_unreachable','chat','transcript_unreachable:'||rec.id,
      jsonb_build_object('chat_id',rec.id,
        'note','A stored conversation has no valid sidebar meta, so the user cannot reach it. The '
            ||'client merge skips metas with no ts/query - this row is invisible history.'));
  end loop;

  -- 4. STRUCTURALLY INVALID TRANSCRIPT -- unchanged
  for rec in
    select c.id from public.user_chats c
    where c.transcript is not null
      and ( (c.transcript->>'v') is distinct from '1'
         or jsonb_typeof(c.transcript->'msgs') <> 'array'
         or jsonb_array_length(c.transcript->'msgs') = 0 )
  loop
    k_invalid := k_invalid || ('transcript_invalid:'||rec.id);
    n := n + public.mon_raise('P1','transcript_invalid','chat','transcript_invalid:'||rec.id,
      jsonb_build_object('chat_id',rec.id,
        'note','restoreChat() will reject this transcript, so the chat restores blank or falls back '
            ||'to a 2-message reconstruction. Likely an interrupted or truncated write.'));
  end loop;

  perform public.mon_resolve_stale_keys('transcript_shrank',            k_shrank);
  perform public.mon_resolve_stale_keys('transcript_missing_for_chat',  k_missing);
  perform public.mon_resolve_stale_keys('transcript_unreachable',       k_unreachable);
  perform public.mon_resolve_stale_keys('transcript_invalid',           k_invalid);

  insert into public.mon_chat_transcript_watermark (chat_id, max_msgs, max_seen_at, updated_at)
  select c.id, jsonb_array_length(c.transcript->'msgs'), now(), now()
    from public.user_chats c
   where c.transcript is not null and jsonb_typeof(c.transcript->'msgs') = 'array'
  on conflict (chat_id) do update
    set max_msgs    = greatest(public.mon_chat_transcript_watermark.max_msgs, excluded.max_msgs),
        max_seen_at = case when excluded.max_msgs > public.mon_chat_transcript_watermark.max_msgs
                           then now() else public.mon_chat_transcript_watermark.max_seen_at end,
        updated_at  = now();

  delete from public.mon_chat_transcript_watermark w
   where not exists (select 1 from public.user_chats c where c.id = w.chat_id);

  return n;
end $function$;
