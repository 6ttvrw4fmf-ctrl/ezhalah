-- Systems Seam Engineer, 2026-08-29.
-- SEAM: acknowledgment -> detector self-clear.
--
-- BUG (proven in production): mon_detect_transcript_integrity raises four per-chat alert kinds and
-- has NO resolve path at all. Every one of its conditions is TRANSIENT and self-healing (a chat
-- gains a transcript, history is recovered, meta is repaired, the user deletes the chat), yet the
-- alert stays open forever. Worse, while the key sits open mon_raise() returns 0 for a genuine
-- RE-occurrence at the same severity -- so a chat that loses its transcript, gets it back, and
-- loses it again raises NOTHING and dispatches NOTHING.
--
-- Live instance at the time of this migration: alert 1087, dedup_key
-- 'transcript_missing:h17879680772543666', raised 2026-08-29 02:29. The chat has carried a
-- transcript again since; the alert has been open and wrong for ~16h and would never have closed.
-- (The other 7 open transcript_missing alerts were re-checked against production and are STILL
-- TRUE -- they must stay open. This change must resolve exactly the cleared one.)
--
-- FIX: collect the dedup keys this run actually re-affirmed, and call mon_resolve_stale_keys() for
-- each kind on the EVALUATED path. This detector has no early return, so every call evaluates all
-- four limbs and the resolve is always reached from a path that genuinely evaluated the condition.

alter table public.alert_event
  add column if not exists last_affirmed_at timestamptz;

comment on column public.alert_event.last_affirmed_at is
  'Set by mon_raise() every time a detector re-raises an ALREADY-OPEN dedup key, i.e. every time '
  'the underlying condition is re-observed as still true. NULL on first insert, so '
  '(last_affirmed_at > created_at) is exactly "this key has been re-affirmed at least once since '
  'it was opened". mon_detect_stuck_open_alert() uses that to tell a detector that re-evaluates '
  'every sweep (and has therefore gone quiet for a reason) apart from a deliberately one-shot '
  'detector that never re-raises by design. Never hand-stamp this column.';


-- mon_raise: stamp the affirmation. Needle edit of the LIVE definition; only the UPDATE set-list
-- gains one assignment. Everything else is byte-identical to pg_get_functiondef() as of today.
CREATE OR REPLACE FUNCTION public.mon_raise(p_sev text, p_kind text, p_platform text, p_dedup text, p_detail jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare v_id bigint; v_sev text; v_escalated boolean;
begin
  select id, severity into v_id, v_sev
    from public.alert_event
   where dedup_key = p_dedup and resolved_at is null
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.alert_event(severity, kind, platform, dedup_key, detail)
    values (p_sev, p_kind, p_platform, p_dedup, coalesce(p_detail,'{}'::jsonb));
    return 1;
  end if;

  -- Still exactly ONE open row per dedup key -- this is not alert spam. But an open alert must
  -- never go stale or under-report: refresh the payload every run so the dashboard shows today's
  -- numbers, and if the condition has got WORSE, promote the severity and re-arm both dispatch and
  -- acknowledgement so the escalation actually reaches a human. mon_dispatch_alerts() only sends
  -- rows with dispatched_at IS NULL, so clearing it is what makes the page happen.
  v_escalated := public.mon_sev_rank(p_sev) > public.mon_sev_rank(v_sev);

  update public.alert_event
     set detail          = coalesce(p_detail,'{}'::jsonb),
         -- The condition was just re-observed as still true. This is the ONLY writer of this
         -- column, and it writes only on the already-open path, which is what makes
         -- (last_affirmed_at > created_at) mean "a detector is still standing behind this alert".
         last_affirmed_at = now(),
         severity        = case when v_escalated then p_sev else severity end,
         dispatched_at   = case when v_escalated then null else dispatched_at end,
         acknowledged_at = case when v_escalated then null else acknowledged_at end
   where id = v_id;

  return case when v_escalated then 1 else 0 end;
end $fn$;


-- THE FIX
CREATE OR REPLACE FUNCTION public.mon_detect_transcript_integrity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  n int := 0; rec record;
  -- A brand-new chat legitimately has meta before its first transcript capture settles; only flag it
  -- once it is old enough that a capture should certainly have landed.
  grace constant interval := interval '30 minutes';
  -- The dedup keys this run re-affirmed, per kind. Anything OPEN for one of these kinds and not in
  -- its list is a condition that has cleared, and must be resolved -- otherwise mon_raise() returns
  -- 0 on a genuine re-occurrence and the recurrence never pages anyone.
  k_shrank      text[] := '{}';
  k_missing     text[] := '{}';
  k_unreachable text[] := '{}';
  k_invalid     text[] := '{}';
begin
  -- 1. HISTORY SHRANK -- the defect itself, P1
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

  -- 2. A CHAT IN THE SIDEBAR WITH NO TRANSCRIPT ON THE SERVER, past the grace window
  for rec in
    select c.id, c.updated_at from public.user_chats c
    where c.transcript is null and c.meta is not null
      and (c.meta->>'ts') is not null
      and c.updated_at < now() - grace
  loop
    k_missing := k_missing || ('transcript_missing:'||rec.id);
    n := n + public.mon_raise('P2','transcript_missing_for_chat','chat','transcript_missing:'||rec.id,
      jsonb_build_object('chat_id',rec.id,'chat_updated_at',rec.updated_at,
        'note','Sidebar entry exists server-side but carries no transcript. Opening this chat on a '
            ||'device without a local cache restores nothing.'));
  end loop;

  -- 3. A TRANSCRIPT WITH NO USABLE SIDEBAR ENTRY (unreachable conversation)
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

  -- 4. STRUCTURALLY INVALID TRANSCRIPT (would be rejected by restoreChat and render nothing)
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

  -- SELF-CLEAR. Reached only here, after all four limbs above have actually run their queries --
  -- there is no early return in this function, so this path is never taken without the conditions
  -- having been evaluated. Each call passes exactly the keys THIS run re-affirmed, so a condition
  -- that has cleared (transcript restored, history recovered, meta repaired, chat deleted) closes
  -- its alert and a later re-occurrence raises -- and dispatches -- again.
  perform public.mon_resolve_stale_keys('transcript_shrank',            k_shrank);
  perform public.mon_resolve_stale_keys('transcript_missing_for_chat',  k_missing);
  perform public.mon_resolve_stale_keys('transcript_unreachable',       k_unreachable);
  perform public.mon_resolve_stale_keys('transcript_invalid',           k_invalid);

  -- ADVANCE THE HIGH-WATER MARK (after detection, so a shrink is caught before it is forgotten)
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
end $fn$;


-- THE BARRIER
-- mon_detect_unresolvable_detector() covers the STATIC half of this bug class: a mon_detect_*
-- whose source contains mon_raise and no resolve call at all. It is why this bug was visible.
-- It cannot cover the BEHAVIOURAL half, which is the half that actually bites: a detector that
-- HAS a resolve call but never reaches it (an early return before the evaluated path, a dedup_key
-- that differs between the raise and the resolve, a resolve on a branch that did not evaluate the
-- condition). After the fix above, the static check goes green -- and nothing would prove the
-- resolve ever fires. This detector is that proof, and it is generic: it needs no per-kind
-- knowledge and covers every detector on the roster, including ones written after it.
--
-- The signal is mon_raise's own affirmation stamp. An alert whose last_affirmed_at is later than
-- its created_at is one some detector re-raised at least once while it was already open -- i.e. a
-- detector that re-evaluates this key every sweep is standing behind it. If that detector then
-- STOPS affirming the key and the alert is still open, exactly one of two things is true, and both
-- are bugs this routine owns:
--   (a) the condition cleared and the detector failed to resolve the key (this migration's bug), or
--   (b) the detector itself went dark -- crashed, fell off the roster, or stopped being reached.
--
-- Why the threshold is 26 hours and not something tighter: expensive behavioural detectors are
-- deliberately gated to ~once per 20h via ops_detector_last_full_run, so they legitimately affirm
-- only every 20h. 26h clears that gate with margin and cannot false-alarm on it. A one-shot
-- detector that never re-raises by design (mon_detect_deleted_but_source_live guards its raise with
-- NOT EXISTS, because "this deleted listing is live at the source" is a permanent historical fact a
-- human must adjudicate, not a condition that clears) never satisfies last_affirmed_at > created_at
-- at all, so it is excluded by construction rather than by an allowlist. There is no waiver table
-- here on purpose: nothing can be added to silence this.
CREATE OR REPLACE FUNCTION public.mon_detect_stuck_open_alert()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  n int := 0;
  v_stale jsonb;
  v_count int;
  stale_after constant interval := interval '26 hours';
begin
  select count(*) into v_count
    from public.alert_event a
   where a.resolved_at is null
     and a.last_affirmed_at is not null
     and a.last_affirmed_at > a.created_at
     and a.last_affirmed_at < now() - stale_after;

  -- Oldest-unaffirmed first, capped: the payload is for triage, the count is the measurement.
  select coalesce(jsonb_agg(jsonb_build_object(
           'alert_id', s.id, 'kind', s.kind, 'severity', s.severity,
           'dedup_key', s.dedup_key, 'created_at', s.created_at,
           'last_affirmed_at', s.last_affirmed_at,
           'hours_since_affirmed', round(extract(epoch from (now() - s.last_affirmed_at))::numeric/3600.0, 1)
         ) order by s.last_affirmed_at), '[]'::jsonb)
    into v_stale
    from (select a.* from public.alert_event a
           where a.resolved_at is null
             and a.last_affirmed_at is not null
             and a.last_affirmed_at > a.created_at
             and a.last_affirmed_at < now() - stale_after
           order by a.last_affirmed_at
           limit 25) s;

  if v_count > 0 then
    n := public.mon_raise('P2', 'stuck_open_alert', 'all', 'stuck_open_alert',
      jsonb_build_object(
        'count', v_count,
        'stale_after_hours', 26,
        'alerts_shown', jsonb_array_length(v_stale),
        'alerts', v_stale,
        'why', 'These alerts are OPEN, and the detector that was re-affirming them every sweep has '
            || 'stopped. Exactly one of two things is true and both are bugs: (a) the condition '
            || 'CLEARED and the detector failed to resolve the key -- so it reads as a standing '
            || 'alert forever AND, worse, mon_raise() now returns 0 for a genuine re-occurrence at '
            || 'the same severity, meaning the recurrence raises nothing and pages nobody; or '
            || '(b) the detector itself went DARK -- crashed, fell off the mon_run_all_detectors() '
            || 'roster, or is no longer reached -- and its whole bug class is unwatched. '
            || 'mon_detect_unresolvable_detector() cannot see either case: it only reads source '
            || 'text for the PRESENCE of a resolve call, not whether that call is ever reached.',
        'adjudicate', 'For each: find the detector that raises this kind, re-evaluate its condition '
            || 'against production NOW, and confirm the detector is still on the roster and still '
            || 'running (ops_detector_timing). If the condition cleared, fix the detector so it '
            || 'calls mon_resolve_stale_keys(kind, live_keys) on its EVALUATED path, passing the '
            || 'keys that run re-affirmed -- never resolve from an early return, which is a worse '
            || 'bug than not resolving at all. If the detector went dark, that is the real finding.',
        'do_not', 'Do NOT clear this by hand-resolving the alerts, by stamping last_affirmed_at, or '
            || 'by widening the 26h window. The window already clears the ~20h '
            || 'ops_detector_last_full_run gate with margin, so a legitimately slow detector cannot '
            || 'reach it. Resolving the symptom leaves the re-occurrence still unpageable.'));
  else
    perform public.mon_resolve_key('stuck_open_alert', 'stuck_open_alert');
  end if;

  return n;
end $fn$;


-- ROSTER (same migration as the detector, per AGENTS.md: a detector nothing reaches is
-- decoration, and mon_detect_orphaned_detectors() fires on one).
--
-- NEEDLE EDIT, not a full-body replace. mon_run_all_detectors() is a 126-entry roster that other
-- sessions add to concurrently; re-creating it from a body captured earlier in this session would
-- silently drop whatever landed in between. So build from pg_get_functiondef() of the LIVE
-- function at apply time, insert exactly one array element, and fail loudly rather than guess.
do $mig$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to guess a roster';
  end if;

  -- Idempotent: a re-run (or a concurrent session that already added it) is a no-op, not a dupe.
  if position('mon_detect_stuck_open_alert' in src) > 0 then
    raise notice 'mon_detect_stuck_open_alert already on the roster -- nothing to do';
    return;
  end if;

  if (select count(*) from regexp_matches(src, '''mon_detect_unresolvable_detector''', 'g')) <> 1 then
    raise exception 'anchor mon_detect_unresolvable_detector not found exactly once in the live roster';
  end if;

  newsrc := replace(src,
    '''mon_detect_unresolvable_detector''',
    '''mon_detect_unresolvable_detector'',' || chr(10) || '    ''mon_detect_stuck_open_alert''');

  if newsrc = src then
    raise exception 'needle edit produced no change -- refusing to re-create the roster unchanged';
  end if;

  execute newsrc;
end
$mig$;

-- Prove the roster actually gained it, in the same transaction that claims to have added it.
do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
       and position('mon_detect_stuck_open_alert' in pg_get_functiondef(p.oid)) > 0)
  then
    raise exception 'mon_detect_stuck_open_alert is NOT on the roster after the edit';
  end if;
end
$chk$;
