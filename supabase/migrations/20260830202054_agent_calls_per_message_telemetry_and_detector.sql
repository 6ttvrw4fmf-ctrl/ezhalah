-- TELEMETRY FOR THE UNIFIED AGENT DECISION AUTHORITY (owner-approved consolidation, 2026-08-30).
--
-- Adds the columns the consolidated supabase/functions/agent/index.ts / decide.ts need to tell a
-- genuine second user message apart from a duplicate/runaway call on the SAME message.
-- See supabase/migrations/20260830210000_agent_calls_per_message_telemetry_and_detector.sql in git
-- for the full rationale (mirrored here verbatim).

create type public.ai_call_reason as enum ('primary', 'language_retry', 'http_retry');

alter table public.ai_usage
  add column if not exists user_message_id text,
  add column if not exists call_reason public.ai_call_reason,
  add column if not exists history_turns_raw smallint;

comment on column public.ai_usage.user_message_id is
  'Client-generated id (src/app/agent.tsx''s uid()), stamped once per user SEND. Shared by the primary call and any retry it triggers so mon_detect_agent_calls_per_message() can group rows by turn.';
comment on column public.ai_usage.call_reason is
  'Why this row was logged: primary (the turn''s own call), language_retry (wrong-language regenerate), http_retry (a 429/5xx retry attempt).';
comment on column public.ai_usage.history_turns_raw is
  'The TRUE pre-cap conversation turn count (client msgs.length before its own history slice), vs history_turns which is post-cap.';

create index if not exists ai_usage_user_message_id_idx on public.ai_usage (user_message_id) where user_message_id is not null;

create or replace function public.mon_detect_agent_calls_per_message()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  live_keys text[] := '{}';
  win interval := interval '6 hours';
  min_messages int := 20;   -- distinct user_message_id's before this detector will speak at all

  msgs_seen int;
  dup_primary_n int;
  over_two_n int;
  bad_reason_n int;
  sev text;
begin
  select count(distinct user_message_id) into msgs_seen
    from public.ai_usage
   where at >= now() - win and user_message_id is not null;

  if msgs_seen < min_messages then
    perform public.mon_resolve_stale_keys('agent_call_integrity', live_keys);
    return 0;
  end if;

  select count(*) into dup_primary_n
    from (
      select user_message_id
        from public.ai_usage
       where at >= now() - win and user_message_id is not null and call_reason = 'primary'
       group by user_message_id
      having count(*) > 1
    ) d;

  if dup_primary_n > 0 then
    sev := case when dup_primary_n >= 3 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'agent_call_integrity', 'agent', 'agent_duplicate_primary_call',
      jsonb_build_object(
        'window_hours', 6,
        'messages_with_duplicate_primary', dup_primary_n,
        'messages_sampled', msgs_seen,
        'what_this_means',
          'At least one user_message_id has more than one call_reason=''primary'' row in public.ai_usage. The platform is supposed to make exactly one primary DeepSeek call per user SEND; a duplicate means either the client sent the same turn twice or the edge function was invoked twice for it.',
        'first_check',
          'Correlate the duplicate user_message_id rows'' timestamps and http_status/attempt in public.ai_usage. If they are milliseconds apart, look for a double-submit in src/app/agent.tsx''s send() (missing busy-guard, a retry wrapper calling it again). If minutes apart, this may be a genuinely separate message that reused an id — check the client''s id generation.',
        'rule',
          'Do not silence this by widening call_reason semantics. A second primary call for the same message is real double spend.'));
    live_keys := live_keys || array['agent_duplicate_primary_call'];
  end if;

  select count(*) into over_two_n
    from (
      select user_message_id
        from public.ai_usage
       where at >= now() - win and user_message_id is not null
       group by user_message_id
      having count(*) > 2
    ) t;

  if over_two_n > 0 then
    sev := case when over_two_n >= 5 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'agent_call_integrity', 'agent', 'agent_calls_per_message_over_ceiling',
      jsonb_build_object(
        'window_hours', 6,
        'messages_over_ceiling', over_two_n,
        'messages_sampled', msgs_seen,
        'what_this_means',
          'At least one user_message_id has more than 2 ai_usage rows. The known ceiling is one primary call plus, at most, one language_retry call (each of which may itself log one extra http_retry row for a transport-level 429/5xx) — a message with more rows than that retried somewhere it should not have.',
        'first_check',
          'Group public.ai_usage by user_message_id and inspect call_reason + attempt for the affected ids: distinguish a legitimate http_retry (transport failure, same call_reason as its parent) from an actual extra model call.',
        'rule',
          'Every paid retry must have a reason a human can name. An unexplained extra call is a cost bug, not noise.'));
    live_keys := live_keys || array['agent_calls_per_message_over_ceiling'];
  end if;

  select count(*) into bad_reason_n
    from public.ai_usage
   where at >= now() - win and user_message_id is not null and call_reason is null;

  if bad_reason_n > 0 then
    n := n + public.mon_raise('P2', 'agent_call_integrity', 'agent', 'agent_call_reason_missing',
      jsonb_build_object(
        'window_hours', 6,
        'rows_missing_call_reason', bad_reason_n,
        'what_this_means',
          'A row has user_message_id set but call_reason NULL, so it cannot be classified as primary/language_retry/http_retry — the two checks above cannot see it.',
        'first_check',
          'Every logUsage() call site in supabase/functions/agent/index.ts must pass call_reason. If this fires right after a deploy it is likely stale rows from before the deploy and will self-heal; if it persists, a call site is missing the field.',
        'rule',
          'Fix the call site, not the detector.'));
    live_keys := live_keys || array['agent_call_reason_missing'];
  end if;

  perform public.mon_resolve_stale_keys('agent_call_integrity', live_keys);
  return n;
end
$function$;

comment on function public.mon_detect_agent_calls_per_message() is
  'Sibling to mon_detect_ai_cost_health(): watches public.ai_usage.user_message_id/call_reason for more than one primary call, more than 2 total calls, or an unlabelled call reason per user message.';

do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_agent_calls_per_message' in def) > 0 then
    raise notice 'mon_detect_agent_calls_per_message already registered - no-op';
    return;
  end if;
  if position('''mon_detect_ai_cost_health''' in def) = 0 then
    raise exception 'anchor mon_detect_ai_cost_health missing - refusing to guess an insert point';
  end if;

  def := replace(def,
    '''mon_detect_ai_cost_health'',',
    '''mon_detect_ai_cost_health'',' || chr(10) || '    ''mon_detect_agent_calls_per_message'',');

  execute def;
end
$do$;
