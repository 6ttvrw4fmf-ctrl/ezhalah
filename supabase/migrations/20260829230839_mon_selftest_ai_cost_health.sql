-- MIRROR of the migration applied to production on 2026-08-29 (migration-mirror rule).
--
-- Proves every check in mon_detect_ai_cost_health() actually FIRES. A detector that has never been
-- seen to fire is not protection, it is decoration — this drives synthetic ai_usage through each
-- failure mode and asserts the matching dedup_key was raised, then asserts SILENCE on healthy data
-- so the thresholds cannot be satisfied by alerting on everything.
--
-- ISOLATION: synthetic rows are marked locale='__selftest__' and deleted at the end; alert rows are
-- removed by id, only those created DURING this run, so a genuine open alert of the same key is
-- never touched. The detector is re-run at the end so live state reflects real data again.
--
-- Result when written: all six true (cache_collapse, cost_per_message, calls_per_turn,
-- unexpected_model, volume_spike, quiet_on_healthy_data).
create or replace function public.mon_selftest_ai_cost_health()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  before_max_id bigint; results jsonb := '{}'::jsonb; ok boolean;
begin
  select coalesce(max(id), 0) into before_max_id from public.alert_event;
  delete from public.ai_usage where locale = '__selftest__';

  -- shared cheap baseline: 300 healthy calls, older than the 6h "current" window
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '2 days' - (g || ' minutes')::interval, 'deepseek-chat', 'deepseek-v4-flash',
         'listings', '__selftest__', 1, 18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 300) g;

  -- 1. CACHE COLLAPSE: 60 recent calls where the prefix no longer matches
  insert into public.ai_usage (at, requested_model, model, kind, locale, call_seq, prompt_tokens,
    completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '10 minutes', 'deepseek-chat', 'deepseek-v4-flash', 'listings',
         '__selftest__', 1, 18156, 115, 0, 18156, 18271, 'stop', 4, 1500
  from generate_series(1, 60);
  perform public.mon_detect_ai_cost_health();
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_cache_collapse') into ok;
  results := results || jsonb_build_object('cache_collapse_fires', ok);
  -- cost/message must ALSO fire here: a cache miss is ~30x dearer per input token
  select exists (select 1 from public.alert_event where id > before_max_id and kind='ai_cost_health'
    and dedup_key='ai_cost_per_message') into ok;
  results := results || jsonb_build_object('cost_per_message_fires', ok);

  -- 2. CALLS PER TURN: the language-guard retry firing on 25% of turns
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

  -- 3. UNEXPECTED BILLED MODEL: the alias silently resolving to v4-pro (3x the bill)
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

  -- 4. VOLUME SPIKE: baseline 10 calls/hour over 100 hours (median 10, clearing the detector's >=5
  --    floor), then 400 calls in the last five minutes.
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

  -- 5. QUIET ON HEALTHY DATA — the false-positive guard. Same shape as the measured production
  --    baseline; nothing may raise.
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

  -- restore: synthetic data gone, only this run's alert rows removed, detector recomputed on REAL data
  delete from public.ai_usage where locale='__selftest__';
  delete from public.alert_event where id > before_max_id and kind='ai_cost_health';
  perform public.mon_detect_ai_cost_health();

  results := results || jsonb_build_object('all_passed',
    (results->>'cache_collapse_fires')::boolean and (results->>'cost_per_message_fires')::boolean
    and (results->>'calls_per_turn_fires')::boolean and (results->>'unexpected_model_fires')::boolean
    and (results->>'volume_spike_fires')::boolean and (results->>'quiet_on_healthy_data')::boolean);
  return results;
end $function$;

comment on function public.mon_selftest_ai_cost_health() is
  'Mutation-proof for mon_detect_ai_cost_health(): drives synthetic ai_usage through every failure mode, asserts each dedup_key raises, asserts silence on healthy data, then restores real state.';
