-- TRANSCRIPT INTEGRITY MONITOR (owner 2026-08-25): "chat history loss can never happen again".
--
-- Two of the five conditions the owner listed are STRUCTURALLY IMPOSSIBLE and deliberately not
-- re-checked here, because a detector for something the schema already forbids is decoration:
--   * duplicate chat ids  -> user_chats_pkey PRIMARY KEY (id)
--   * orphan transcripts  -> user_chats_user_id_fkey ... REFERENCES auth.users(id) ON DELETE CASCADE
-- The barrier scripts/verify-transcript-integrity.ts asserts those constraints still EXIST, so if a
-- future migration drops one, that is caught rather than silently becoming undetected.
--
-- What this detects is the harm itself rather than its proxies: A TRANSCRIPT THAT SHRANK. Every
-- other symptom (a stale cache winning, a partial write landing, a bad merge) ends in the same
-- observable place — a conversation that used to have N turns now has fewer. A high-water mark per
-- chat turns that into something provable from the server alone, with no client cooperation.
create table if not exists public.mon_chat_transcript_watermark (
  chat_id     text primary key,
  max_msgs    int         not null,
  max_seen_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.mon_chat_transcript_watermark is
  'Per-chat high-water mark of transcript message count. A DROP below this is history loss (owner 2026-08-25).';

create or replace function public.mon_detect_transcript_integrity() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare
  n int := 0; rec record;
  -- A brand-new chat legitimately has meta before its first transcript capture settles; only flag it
  -- once it is old enough that a capture should certainly have landed.
  grace constant interval := interval '30 minutes';
begin
  -- ── 1. HISTORY SHRANK — the defect itself, P1 ──────────────────────────────────────────────────
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
    n := n + public.mon_raise('P1','transcript_shrank','chat','transcript_shrank:'||rec.id,
      jsonb_build_object('chat_id',rec.id,'now_msgs',rec.now_msgs,'was_msgs',rec.max_msgs,
        'high_water_at',rec.max_seen_at,
        'note','A stored conversation LOST turns. This is user-visible history loss: a stale client '
            ||'cache overwrote a newer server copy, or a partial write landed. Do not "fix" by '
            ||'resetting the watermark - recover the transcript and find the write that shortened it.'));
  end loop;

  -- ── 2. A CHAT IN THE SIDEBAR WITH NO TRANSCRIPT ON THE SERVER, past the grace window ───────────
  for rec in
    select c.id, c.updated_at from public.user_chats c
    where c.transcript is null and c.meta is not null
      and (c.meta->>'ts') is not null
      and c.updated_at < now() - grace
  loop
    n := n + public.mon_raise('P2','transcript_missing_for_chat','chat','transcript_missing:'||rec.id,
      jsonb_build_object('chat_id',rec.id,'chat_updated_at',rec.updated_at,
        'note','Sidebar entry exists server-side but carries no transcript. Opening this chat on a '
            ||'device without a local cache restores nothing.'));
  end loop;

  -- ── 3. A TRANSCRIPT WITH NO USABLE SIDEBAR ENTRY (unreachable conversation) ────────────────────
  for rec in
    select c.id from public.user_chats c
    where c.transcript is not null
      and (c.meta is null or (c.meta->>'ts') is null or c.meta->'query' is null)
  loop
    n := n + public.mon_raise('P1','transcript_unreachable','chat','transcript_unreachable:'||rec.id,
      jsonb_build_object('chat_id',rec.id,
        'note','A stored conversation has no valid sidebar meta, so the user cannot reach it. The '
            ||'client merge skips metas with no ts/query - this row is invisible history.'));
  end loop;

  -- ── 4. STRUCTURALLY INVALID TRANSCRIPT (would be rejected by restoreChat and render nothing) ───
  for rec in
    select c.id from public.user_chats c
    where c.transcript is not null
      and ( (c.transcript->>'v') is distinct from '1'
         or jsonb_typeof(c.transcript->'msgs') <> 'array'
         or jsonb_array_length(c.transcript->'msgs') = 0 )
  loop
    n := n + public.mon_raise('P1','transcript_invalid','chat','transcript_invalid:'||rec.id,
      jsonb_build_object('chat_id',rec.id,
        'note','restoreChat() will reject this transcript, so the chat restores blank or falls back '
            ||'to a 2-message reconstruction. Likely an interrupted or truncated write.'));
  end loop;

  -- ── ADVANCE THE HIGH-WATER MARK (after detection, so a shrink is caught before it is forgotten) ─
  insert into public.mon_chat_transcript_watermark (chat_id, max_msgs, max_seen_at, updated_at)
  select c.id, jsonb_array_length(c.transcript->'msgs'), now(), now()
    from public.user_chats c
   where c.transcript is not null and jsonb_typeof(c.transcript->'msgs') = 'array'
  on conflict (chat_id) do update
    set max_msgs    = greatest(public.mon_chat_transcript_watermark.max_msgs, excluded.max_msgs),
        max_seen_at = case when excluded.max_msgs > public.mon_chat_transcript_watermark.max_msgs
                           then now() else public.mon_chat_transcript_watermark.max_seen_at end,
        updated_at  = now();

  -- Drop watermarks for chats the user genuinely deleted, so a future id reuse cannot inherit a
  -- stale high-water mark and alarm forever. (Deletion is legitimate; shrinking is not.)
  delete from public.mon_chat_transcript_watermark w
   where not exists (select 1 from public.user_chats c where c.id = w.chat_id);

  return n;
end $function$;

comment on function public.mon_detect_transcript_integrity() is
  'P1 on transcript shrink / unreachable / invalid, P2 on missing-past-grace. Keeps a per-chat msg high-water mark so history LOSS is provable server-side. Duplicate ids and orphans are prevented by the PK and the ON DELETE CASCADE FK instead.';
