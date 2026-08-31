-- MIRROR of the migration applied to production on 2026-08-29 (migration-mirror rule).
--
-- ═══ TELEMETRY-FAILURE DETECTOR ══════════════════════════════════════════════════════════════
-- "Alert if telemetry itself stops recording" (owner). Every protection in this system reads
-- public.ai_usage. If that table stops being written, every cost monitor AND the spend circuit
-- breaker go quiet and read as perfectly healthy — the exact shape of the original problem, where
-- nothing recorded usage and the silence looked like calm.
--
-- The independent witness is agent_health_event: written by a DIFFERENT code path in the same
-- function. Turns happening with no usage rows means the cost telemetry is broken, not that the
-- agent is idle.
create or replace function public.mon_detect_ai_telemetry_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  live_keys text[] := '{}';
  win interval := interval '2 hours';
  turns int; usage_rows int; gate_state text;
begin
  select count(*) into turns from public.agent_health_event where at >= now() - win and outcome = 'ok';
  select count(*) into usage_rows from public.ai_usage where at >= now() - win;

  if turns >= 20 and usage_rows = 0 then
    n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_telemetry_silent',
      jsonb_build_object(
        'window_hours', 2, 'successful_turns', turns, 'usage_rows', usage_rows,
        'what_this_means',
          'The agent is answering turns but public.ai_usage has recorded NOTHING. Every cost monitor and the spend circuit breaker read this table, so they are all silently blind right now - and they will report healthy while blind, which is exactly how the original cost problem hid.',
        'first_check',
          'logUsage() in supabase/functions/agent/index.ts is fire-and-forget and swallows errors by design. Check the service-role key, RLS on ai_usage, and the Supabase function logs for the agent. agent_health_event is still writing, so the function itself is alive.',
        'rule',
          'Treat a blind cost monitor as an outage of the monitor, not as good news.'));
    live_keys := live_keys || array['ai_telemetry_silent'];
  end if;

  -- A partial stall: rows should be >= turns (a language retry adds a second row).
  if turns >= 50 and usage_rows > 0 and usage_rows < turns / 2 then
    n := n + public.mon_raise('P2', 'ai_cost_health', 'deepseek', 'ai_telemetry_partial',
      jsonb_build_object(
        'window_hours', 2, 'successful_turns', turns, 'usage_rows', usage_rows,
        'what_this_means', 'Cost telemetry is recording far fewer calls than the agent is serving, so every cost figure is an undercount.',
        'first_check', 'Look for logUsage() failures (RLS, key rotation, PostgREST errors) in the agent function logs.',
        'rule', 'An undercounting cost monitor is worse than none - it reports safety it cannot see.'));
    live_keys := live_keys || array['ai_telemetry_partial'];
  end if;

  -- An open breaker is an operational state a human must keep seeing, independent of the P0 raised
  -- at trip time (that one can be closed by hand while the breaker stays open).
  select state into gate_state from public.ai_spend_state where id;
  if gate_state = 'open' then
    n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_spend_breaker_still_open',
      jsonb_build_object(
        'state', gate_state,
        'reason', (select reason from public.ai_spend_state where id),
        'tripped_at', (select tripped_at from public.ai_spend_state where id),
        'what_this_means', 'The AI spend circuit breaker is OPEN: no paid DeepSeek calls are being made. Deterministic search still works; the AI chat is degraded.',
        'first_check', 'select * from public.ai_spend_state; then public.ai_cost_dashboard() for the numbers.',
        'rule', 'Resume with public.ai_spend_reset(reason) only after the cause is understood.'));
    live_keys := live_keys || array['ai_spend_breaker_still_open'];
  end if;

  perform public.mon_resolve_stale_keys('ai_cost_health_telemetry', live_keys);
  return n;
end
$function$;

-- Register in the twice-hourly sweep. NEEDLE EDIT, never a full-body rewrite of the sweep
-- (memory: RPC full-body-replace revert hazard). Idempotent; refuses to guess if the anchor is gone.
do $do$
declare src text; anchor text := '''mon_detect_ai_cost_health'','; hits int;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_ai_telemetry_health' in src) > 0 then raise notice 'already registered'; return; end if;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then raise exception 'anchor matched % times, expected 1', hits; end if;
  execute replace(src, anchor, anchor || chr(10) || '    ''mon_detect_ai_telemetry_health'',');
end $do$;

-- ═══ OPERATIONAL DASHBOARD ═══════════════════════════════════════════════════════════════════
-- One call answers every question the owner asked to be able to ask at any moment: today's spend,
-- last hour, calls, calls per user turn, user vs CI, cache hit rate, model billed, breaker state,
-- open alerts.
create or replace function public.ai_cost_dashboard()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'generated_at', now(),
    'spend', jsonb_build_object(
      'usd_last_1h',  (select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= now() - interval '1 hour'),
      'usd_today_utc',(select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= date_trunc('day', now())),
      'usd_last_24h', (select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= now() - interval '24 hours'),
      'projected_monthly_usd_at_24h_rate',
        (select coalesce(round(sum(usd) * 30, 2), 0) from public.ai_usage_costed where at >= now() - interval '24 hours')),
    'calls', jsonb_build_object(
      'last_1h',  (select count(*) from public.ai_usage where at >= now() - interval '1 hour'),
      'last_24h', (select count(*) from public.ai_usage where at >= now() - interval '24 hours'),
      'by_source_24h', (select coalesce(jsonb_object_agg(src, n), '{}'::jsonb) from (
          select coalesce(source,'user') src, count(*) n from public.ai_usage
           where at >= now() - interval '24 hours' group by 1) x),
      'calls_per_user_turn_24h', (
        select case when count(*) filter (where call_seq = 1) > 0
               then round(count(*)::numeric / count(*) filter (where call_seq = 1), 3) end
          from public.ai_usage where at >= now() - interval '24 hours')),
    'efficiency', jsonb_build_object(
      'cache_hit_pct_24h', (select round(100.0*sum(cache_hit_tokens)/nullif(sum(prompt_tokens),0), 2)
                              from public.ai_usage where at >= now() - interval '24 hours'),
      'avg_usd_per_call_24h', (select round(avg(usd), 8) from public.ai_usage_costed where at >= now() - interval '24 hours'),
      'usd_per_1k_messages_24h', (select round(avg(usd)*1000, 4) from public.ai_usage_costed where at >= now() - interval '24 hours'),
      'models_billed_24h', (select coalesce(string_agg(distinct model, ', '), 'none')
                              from public.ai_usage where at >= now() - interval '24 hours')),
    'circuit_breaker', (select jsonb_build_object(
        'state', state, 'reason', reason, 'tripped_at', tripped_at,
        'reset_at', reset_at, 'reset_by', reset_by) from public.ai_spend_state where id),
    'ceilings', (select jsonb_build_object(
        'enabled', enabled,
        'max_calls_per_hour', max_calls_per_hour, 'max_usd_per_hour', max_usd_per_hour,
        'max_calls_per_day', max_calls_per_day, 'max_usd_per_day', max_usd_per_day,
        'min_calls_before_trip', min_calls_before_trip,
        'allowed_models', allowed_models) from public.ai_spend_config where id),
    'open_ai_cost_alerts', (select coalesce(jsonb_agg(jsonb_build_object(
        'severity', severity, 'dedup_key', dedup_key, 'raised_at', created_at)), '[]'::jsonb)
        from public.alert_event
       where kind in ('ai_cost_health','ai_spend_guard') and resolved_at is null)
  );
$function$;

comment on function public.ai_cost_dashboard() is
  'One-call operational view of AI spend: 1h/today/24h spend, calls, user-vs-CI split, calls per user turn, cache hit rate, model billed, circuit-breaker state, ceilings, open alerts.';
