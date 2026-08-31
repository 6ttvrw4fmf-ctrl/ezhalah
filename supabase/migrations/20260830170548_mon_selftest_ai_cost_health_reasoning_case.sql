-- Extend mon_selftest_ai_cost_health with the reasoning-token case (owner audit, 2026-08-30).
-- Needle-edited from the live pg_get_functiondef (unchanged otherwise): adds one synthetic call
-- with reasoning_tokens > 0 and asserts ai_reasoning_tokens_billed fires, wired into all_passed.
CREATE OR REPLACE FUNCTION public.mon_selftest_ai_cost_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  before_max_id bigint; results jsonb := '{}'::jsonb; ok boolean;
begin
  select coalesce(max(id), 0) into before_max_id from public.alert_event;
  delete from public.ai_usage where locale = '__selftest__';

  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '2 days' - (g || ' minutes')::interval, 'deepseek-chat', 'deepseek-v4-flash',
         'listings', '__selftest__', 1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 300) g;

  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings',
         '__selftest__', 1, 18156, 115, 0, 18156, 18271, 'stop', 4, 1500
  from generate_series(1, 60);
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_cache_collapse') into ok;
  results := results || jsonb_build_object('cache_collapse_fires', ok);
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_cost_per_message') into ok;
  results := results || jsonb_build_object('cost_per_message_fires', ok);

  delete from public.ai_usage where locale='__selftest__' and at > now() - interval '6 hours';
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings', '__selftest__',
         case when g % 4 = 0 then 2 else 1 end, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 100) g;
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_calls_per_turn') into ok;
  results := results || jsonb_build_object('calls_per_turn_fires', ok);

  delete from public.ai_usage where locale='__selftest__' and at > now() - interval '6 hours';
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-pro', 'listings', '__selftest__',
         1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 10);
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_unexpected_model') into ok;
  results := results || jsonb_build_object('unexpected_model_fires', ok);

  -- REASONING TOKENS: a single call with reasoning_tokens > 0 on the pinned non-reasoning model
  -- must fire immediately (no minimum-sample floor - even one is a real leak).
  delete from public.ai_usage where locale='__selftest__' and at > now() - interval '24 hours';
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, reasoning_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  values (now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings', '__selftest__',
          1, 18156, 115, 512, 17978, 178, 18783, 'stop', 4, 1500);
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_reasoning_tokens_billed') into ok;
  results := results || jsonb_build_object('reasoning_tokens_fires', ok);

  -- VOLUME: baseline 10 calls/hour over 100 hours -> median 10 (clears the detector's >=5 floor),
  -- then 400 in the last five minutes.
  delete from public.ai_usage where locale='__selftest__';
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '2 days' - (h || ' hours')::interval, 'deepseek-chat', 'deepseek-v4-flash',
         'listings', '__selftest__', 1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 100) h, generate_series(1, 10) r;
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '5 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings', '__selftest__',
         1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 400);
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_volume_spike') into ok;
  results := results || jsonb_build_object('volume_spike_fires', ok);

  delete from public.ai_usage where locale='__selftest__';
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '2 days' - (g || ' minutes')::interval, 'deepseek-chat', 'deepseek-v4-flash',
         'listings', '__selftest__', 1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 300) g;
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings', '__selftest__',
         1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 100);
  delete from public.alert_event where id > before_max_id and kind='ai_cost_health';
  perform public.mon_detect_ai_cost_health();
  select not exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health') into ok;
  results := results || jsonb_build_object('quiet_on_healthy_data', ok);

  delete from public.ai_usage where locale='__selftest__';
  delete from public.alert_event where id > before_max_id and kind='ai_cost_health';
  perform public.mon_detect_ai_cost_health();

  results := results || jsonb_build_object('all_passed',
    (results->>'cache_collapse_fires')::boolean and (results->>'cost_per_message_fires')::boolean
    and (results->>'calls_per_turn_fires')::boolean and (results->>'unexpected_model_fires')::boolean
    and (results->>'reasoning_tokens_fires')::boolean
    and (results->>'volume_spike_fires')::boolean and (results->>'quiet_on_healthy_data')::boolean);
  return results;
end $function$;

comment on function public.mon_selftest_ai_cost_health() is
  'Mutation-proof for mon_detect_ai_cost_health(): drives synthetic ai_usage through every failure mode (including reasoning tokens on the pinned non-reasoning model), asserts each dedup_key raises, asserts silence on healthy data, then restores real state.';
