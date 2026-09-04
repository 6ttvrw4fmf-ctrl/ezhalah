create or replace view public.ai_usage_costed as
with p as (
  select
    u.id, u.at, u.requested_model, u.model, u.kind, u.locale, u.call_seq,
    u.prompt_tokens, u.completion_tokens, u.reasoning_tokens, u.cache_hit_tokens, u.cache_miss_tokens,
    u.total_tokens, u.finish_reason, u.history_turns, u.latency_ms,
    (extract(isodow from u.at at time zone 'UTC') <= 5
      and (
        (u.at at time zone 'UTC')::time >= time '01:00' and (u.at at time zone 'UTC')::time < time '04:00'
        or (u.at at time zone 'UTC')::time >= time '06:00' and (u.at at time zone 'UTC')::time < time '10:00'
      )) as is_peak,
    case when coalesce(u.model, u.requested_model) ilike '%pro%' then 'pro' else 'flash' end as tier,
    u.source, u.attempt, u.http_status
  from public.ai_usage u
)
select
  p.id, p.at, p.requested_model, p.model, p.kind, p.locale, p.call_seq,
  p.prompt_tokens, p.completion_tokens, p.reasoning_tokens, p.cache_hit_tokens, p.cache_miss_tokens,
  p.total_tokens, p.finish_reason, p.history_turns, p.latency_ms, p.is_peak, p.tier,
  round(
    ( coalesce(p.cache_hit_tokens, 0)::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 0.044 else 0.022 end
                                    else case when p.is_peak then 0.014 else 0.007 end end
    + coalesce(p.cache_miss_tokens, greatest(coalesce(p.prompt_tokens, 0) - coalesce(p.cache_hit_tokens, 0), 0))::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 1.32 else 0.66 end
                                    else case when p.is_peak then 0.44 else 0.22 end end
    + coalesce(p.completion_tokens, 0)::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 3.96 else 1.98 end
                                    else case when p.is_peak then 1.32 else 0.66 end end
    ), 8) as usd,
  p.source, p.attempt, p.http_status
from p;

comment on view public.ai_usage_costed is
  'ai_usage + estimated USD per call. Pricing/peak windows live here so a rate change never needs an edge-function redeploy. source/attempt/http_status appended 2026-08-30 (fixing a column-drift blind spot: they existed on ai_usage since before this view was even created, but a view built on u.* only picks up new columns on a fresh CREATE OR REPLACE, which never happened until now).';

create or replace function public.ai_cost_dashboard()
returns jsonb
language sql stable security definer set search_path = 'public'
as $function$
  select jsonb_build_object(
    'generated_at', now(),
    'spend', jsonb_build_object(
      'usd_last_1h',  (select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= now() - interval '1 hour'),
      'usd_today_utc',(select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= date_trunc('day', now())),
      'usd_last_24h', (select coalesce(round(sum(usd), 6), 0) from public.ai_usage_costed where at >= now() - interval '24 hours'),
      'projected_monthly_usd_at_24h_rate',
        (select coalesce(round(sum(usd) * 30, 2), 0) from public.ai_usage_costed where at >= now() - interval '24 hours'),
      'usd_by_source_24h', (select coalesce(jsonb_object_agg(src, usd_sum), '{}'::jsonb) from (
          select coalesce(source,'user') src, round(sum(usd), 6) usd_sum from public.ai_usage_costed
           where at >= now() - interval '24 hours' group by 1) x)),
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
  'One-shot AI cost/health snapshot. spend.usd_by_source_24h (added 2026-08-30, alongside the ai_usage_costed source-column-drift fix) breaks USD down by user/ci/selftest -- calls.by_source_24h already did this for raw call counts, straight off ai_usage, unaffected by the view drift.';
