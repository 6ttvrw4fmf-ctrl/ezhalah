-- Extend mon_detect_ai_cost_health with a reasoning-token invariant (owner audit, 2026-08-30).
--
-- WHY: the 2026-08-28 outage was a reasoning-alias silently eating max_tokens. ai_unexpected_model
-- (check 4) only fires if the BILLED MODEL NAME changes away from '%flash%' -- it would miss a
-- same-named tier that started returning thinking tokens. reasoning_tokens is the direct signal:
-- DEEPSEEK_MODEL is pinned to a non-reasoning alias specifically so this column stays zero. Any
-- non-zero value means we are being billed for thinking we never asked for, independent of what
-- the model name says. Needle-edited from the live pg_get_functiondef (unchanged otherwise) so this
-- is the exact function running in production, not a stale local copy.
CREATE OR REPLACE FUNCTION public.mon_detect_ai_cost_health()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  live_keys text[] := '{}';
  win        interval := interval '6 hours';
  base_win   interval := interval '7 days';
  vol_win    interval := interval '60 minutes';
  min_now    int := 50;
  min_base   int := 200;
  expected_model_like text := '%flash%';
  cur_n int; cur_hit numeric; cur_prompt numeric; cur_usd numeric;
  base_n int; base_usd numeric; base_hit_rate numeric;
  cur_hit_rate numeric;
  seq1 int; seq_retry int; retry_rate numeric;
  bad_model_n int; bad_models text;
  reasoning_n int;
  vol_now int; vol_median numeric;
  usd_24h numeric; usd_median_day numeric;
  sev text;
begin
  select count(*), coalesce(sum(cache_hit_tokens), 0), coalesce(sum(prompt_tokens), 0), coalesce(avg(usd), 0)
    into cur_n, cur_hit, cur_prompt, cur_usd
    from public.ai_usage_costed where at >= now() - win;

  select count(*), coalesce(avg(usd), 0),
         case when coalesce(sum(prompt_tokens), 0) > 0
              then coalesce(sum(cache_hit_tokens), 0)::numeric / sum(prompt_tokens) end
    into base_n, base_usd, base_hit_rate
    from public.ai_usage_costed where at >= now() - base_win and at < now() - win;

  cur_hit_rate := case when cur_prompt > 0 then cur_hit / cur_prompt end;

  if cur_n >= min_now and cur_hit_rate is not null and cur_hit_rate < 0.85 then
    sev := case when cur_hit_rate < 0.60 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'ai_cost_health', 'deepseek', 'ai_cache_collapse',
      jsonb_build_object(
        'window_hours', 6,
        'current_cache_hit_rate', round(cur_hit_rate, 4),
        'baseline_cache_hit_rate', round(coalesce(base_hit_rate, 0.99), 4),
        'sample', cur_n, 'measured_norm', 0.99,
        'what_this_means',
          'DeepSeek prefix caching has stopped matching. The system prompt is ~18k tokens; at a 99% hit rate that costs about $0.00025 per message, and with no cache the SAME traffic costs $8.14 per 1,000 messages instead of $0.48 - roughly 17x, with no visible change to the product.',
        'first_check',
          'Did anything dynamic get placed BEFORE the system prompt in messages[] in supabase/functions/agent/index.ts? The system message must stay a byte-identical prefix: SYSTEM first, then sysExtra, then JSON_SHAPE_HINT. A per-request value (timestamp, user id, counter) anywhere in SYSTEM breaks every cache entry.',
        'rule',
          'Never fix this by shrinking the prompt. Restore the cache prefix - the prompt size is not the problem.'));
    live_keys := live_keys || array['ai_cache_collapse'];
  end if;

  if cur_n >= min_now and base_n >= min_base and base_usd > 0
     and cur_usd > base_usd * 2.5 and cur_usd > 0.0015 then
    sev := case when cur_usd > base_usd * 5 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'ai_cost_health', 'deepseek', 'ai_cost_per_message',
      jsonb_build_object(
        'window_hours', 6,
        'current_usd_per_message', round(cur_usd, 8),
        'baseline_usd_per_message', round(base_usd, 8),
        'ratio', round(cur_usd / base_usd, 2),
        'current_per_1k_messages', round(cur_usd * 1000, 4),
        'baseline_per_1k_messages', round(base_usd * 1000, 4),
        'sample', cur_n, 'baseline_sample', base_n,
        'what_this_means',
          'A message costs materially more than the established baseline. Measured norm is $0.000482/message at peak rates ($0.48 per 1,000).',
        'first_check',
          'Check the sibling alerts first - ai_cache_collapse, ai_unexpected_model and ai_calls_per_turn each cause this and each names its own cause. If none fired, compare avg prompt_tokens and completion_tokens in public.ai_usage over the same window.',
        'rule', 'Do not respond by cutting agent quality. Find which input moved first.'));
    live_keys := live_keys || array['ai_cost_per_message'];
  end if;

  select count(*) filter (where call_seq = 1), count(*) filter (where call_seq > 1)
    into seq1, seq_retry from public.ai_usage where at >= now() - win;
  retry_rate := case when seq1 > 0 then seq_retry::numeric / seq1 end;

  if seq1 >= min_now and retry_rate is not null and retry_rate > 0.05 then
    sev := case when retry_rate > 0.20 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'ai_cost_health', 'deepseek', 'ai_calls_per_turn',
      jsonb_build_object(
        'window_hours', 6,
        'calls_per_turn', round(1 + retry_rate, 3),
        'retry_rate', round(retry_rate, 4),
        'primary_calls', seq1, 'retry_calls', seq_retry,
        'what_this_means',
          'The language-guard retry in the agent is firing often. Each retry is a FULL second paid call with the entire prompt, so a 20% retry rate is a 20% cost increase. Measured baseline is 1.00 calls per turn.',
        'first_check',
          'The retry fires when detectLang(out.reply) disagrees with the requested locale. Look for a locale-detection regression, or an agent_notes edit pushing the model toward the wrong language.',
        'rule',
          'Fix the language selection deterministically. Do NOT silence this by removing the retry - a wrong-language reply is a product failure.'));
    live_keys := live_keys || array['ai_calls_per_turn'];
  end if;

  select count(*), string_agg(distinct model, ', ')
    into bad_model_n, bad_models
    from public.ai_usage
   where at >= now() - interval '24 hours' and model is not null and model not ilike expected_model_like;

  if bad_model_n >= 3 then
    n := n + public.mon_raise('P0', 'ai_cost_health', 'deepseek', 'ai_unexpected_model',
      jsonb_build_object(
        'window_hours', 24, 'unexpected_calls', bad_model_n, 'models_seen', bad_models,
        'expected_like', expected_model_like,
        'what_this_means',
          'DeepSeek billed calls on a model we do not expect. deepseek-chat is an ALIAS and the tier it resolves to sets the whole bill: v4-pro costs 3x v4-flash on the same call ($1.48 vs $0.48 per 1,000 messages). Nothing in our code has to change for this to happen.',
        'first_check',
          'Read public.ai_usage: requested_model is what we asked for, model is what DeepSeek says it billed. If requested_model is unchanged and model moved, DeepSeek re-pointed the alias - pin DEEPSEEK_MODEL to an explicit model id. If a reasoning model appears, also check reasoning_tokens: that was the 2026-08-28 outage.',
        'rule',
          'This is an owner-level cost decision. Do not widen expected_model_like to make the alert stop.'));
    live_keys := live_keys || array['ai_unexpected_model'];
  end if;

  -- ── 4b. REASONING TOKENS BILLED ON THE PINNED NON-REASONING MODEL ──────────────
  -- deepseek-chat is pinned specifically because it must NOT be a reasoning/thinking alias (the
  -- 2026-08-28 outage: reasoning ate max_tokens and the turn returned empty, silently). Check 4
  -- above only fires if the BILLED MODEL NAME stops matching '%flash%' - it would miss a
  -- same-named tier that started returning thinking tokens. reasoning_tokens is the direct,
  -- name-independent signal, so it fires on the very first affected call rather than waiting for
  -- 3 in 24h.
  select count(*) into reasoning_n
    from public.ai_usage
   where at >= now() - interval '24 hours' and coalesce(reasoning_tokens, 0) > 0;

  if reasoning_n >= 1 then
    n := n + public.mon_raise('P0', 'ai_cost_health', 'deepseek', 'ai_reasoning_tokens_billed',
      jsonb_build_object(
        'window_hours', 24,
        'calls_with_reasoning_tokens', reasoning_n,
        'what_this_means',
          'DeepSeek billed reasoning/thinking tokens on a call using the pinned non-reasoning model. This is the exact 2026-08-28 outage shape: reasoning ate max_tokens and the turn returned empty, and reasoning tokens are billed even though the agent never asked for them.',
        'first_check',
          'Read public.ai_usage for the affected rows: check requested_model and model. If DEEPSEEK_MODEL or ALLOWED_MODELS changed, or DeepSeek silently re-pointed the alias to a thinking variant, pin DEEPSEEK_MODEL back to a literal non-reasoning model id.',
        'rule',
          'Do not just raise max_tokens to compensate - pin the model, do not budget around reasoning we never asked for.'));
    live_keys := live_keys || array['ai_reasoning_tokens_billed'];
  end if;

  select count(*) into vol_now from public.ai_usage where at >= now() - vol_win;

  select percentile_cont(0.5) within group (order by c) into vol_median
    from (select count(*) c from public.ai_usage
           where at >= now() - base_win and at < now() - vol_win
           group by date_trunc('hour', at)) h;

  if vol_median is not null and vol_median >= 5 and vol_now >= 100 and vol_now > vol_median * 5 then
    n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_volume_spike',
      jsonb_build_object(
        'window_minutes', 60, 'calls_last_hour', vol_now,
        'median_hourly_calls_7d', round(vol_median, 1),
        'ratio', round(vol_now / nullif(vol_median, 0), 1),
        'estimated_extra_usd_this_hour', round((vol_now - vol_median) * coalesce(nullif(base_usd, 0), 0.000482), 4),
        'what_this_means',
          'AI request volume is far above normal. Every call is billed, so this is a cost event even if each individual call is healthy.',
        'first_check',
          'Is it real users, an automated test loop, or a client retry storm? public.ai_usage has no user id by design (PDPL), so correlate with agent_health_event volume and the Supabase edge request logs.',
        'rule', 'Confirm the traffic is genuine before treating it as growth.'));
    live_keys := live_keys || array['ai_volume_spike'];
  end if;

  select coalesce(sum(usd), 0) into usd_24h
    from public.ai_usage_costed where at >= now() - interval '24 hours';

  select percentile_cont(0.5) within group (order by d) into usd_median_day
    from (select sum(usd) d from public.ai_usage_costed
           where at >= now() - base_win and at < now() - interval '24 hours'
           group by date_trunc('day', at)) x;

  if usd_median_day is not null and usd_median_day > 0
     and usd_24h > usd_median_day * 5 and usd_24h > 1.0 then
    n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_daily_spend_step_change',
      jsonb_build_object(
        'usd_last_24h', round(usd_24h, 4),
        'median_daily_usd_7d', round(usd_median_day, 4),
        'ratio', round(usd_24h / nullif(usd_median_day, 0), 1),
        'projected_monthly_usd', round(usd_24h * 30, 2),
        'what_this_means',
          'Total DeepSeek spend over the last 24h is far above the recent daily median. This is the number that shows up on the bill.',
        'first_check',
          'Check the sibling alerts to see WHICH variable moved: ai_volume_spike (more calls) vs ai_cost_per_message / ai_cache_collapse / ai_unexpected_model (dearer calls).',
        'rule',
          'These figures cover only calls this project makes. If the DeepSeek dashboard shows materially more spend than public.ai_usage_costed accounts for, something OUTSIDE this project is using the same API key - that gap is the finding, not a detector fault.'));
    live_keys := live_keys || array['ai_daily_spend_step_change'];
  end if;

  perform public.mon_resolve_stale_keys('ai_cost_health', live_keys);

  delete from public.ai_usage where at < now() - interval '90 days';

  return n;
end
$function$;

comment on function public.mon_detect_ai_cost_health() is
  'Watches DeepSeek cost health from public.ai_usage_costed/ai_usage: cache-hit collapse, cost/message vs baseline, calls/turn, unexpected billed model, reasoning tokens on the pinned non-reasoning model, volume spike, daily spend step-change. Observes only - never changes model, prompt or caching.';
