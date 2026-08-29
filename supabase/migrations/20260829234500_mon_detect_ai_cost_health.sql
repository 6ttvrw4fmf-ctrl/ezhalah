-- AI COST / CACHE HEALTH DETECTOR (owner 2026-08-29)
--
-- The cost audit established what a healthy turn looks like, from 130 real production calls:
--   1 DeepSeek call per user message · billed as deepseek-v4-flash · 99.0% cache hit
--   ~18,156 input + ~115 output tokens · $0.000482/message peak, $0.000241 off-peak
--
-- Every one of those is a number that can silently move. This detector watches the five that
-- change the bill, using public.ai_usage_costed as the truth. It changes NO model, prompt, or
-- caching behaviour — it only observes.
--
-- WHY EACH CHECK EXISTS (the counterfactuals are measured, not guessed):
--   cache collapse   → 99% hit is what makes an 18k-token prompt affordable. If anything dynamic
--                      ever precedes the system prompt in messages[], the prefix stops matching and
--                      the SAME traffic costs $8.14/1k instead of $0.48/1k — 17x, silently.
--   cost/message     → the catch-all. Any cause we did not predict still moves this number.
--   calls/turn       → the language-guard retry is a full second paid call. Baseline is ~0.
--   billed model     → DEEPSEEK_MODEL is an ALIAS. If it ever resolves to v4-pro, the same call
--                      costs 3x ($1.48/1k). Nothing in our code would change; the bill would.
--   volume spike     → cost is per-call, so runaway volume is a cost event even when every
--                      individual call is perfectly healthy.
--
-- ROLLING WINDOWS + MIN SAMPLES: every check compares a window against an established baseline and
-- refuses to fire below a minimum sample, so one strange request cannot alert. Self-heals via
-- mon_resolve_stale_keys — when the condition clears, the alert resolves and its GitHub issue closes.
create or replace function public.mon_detect_ai_cost_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  live_keys text[] := '{}';

  -- Windows. Short enough to catch a regression the same day, long enough that a handful of odd
  -- turns cannot swing them.
  win        interval := interval '6 hours';   -- "now"
  base_win   interval := interval '7 days';    -- established baseline
  vol_win    interval := interval '60 minutes';

  -- Minimum samples. Below these the detector stays silent rather than guessing.
  min_now    int := 50;
  min_base   int := 200;

  -- The expected billed tier. NOT a knob to widen when an alert fires — if this ever needs to
  -- change, the cost model changes with it and that is an owner decision.
  expected_model_like text := '%flash%';

  cur_n int; cur_hit numeric; cur_prompt numeric; cur_usd numeric;
  base_n int; base_usd numeric; base_hit_rate numeric;
  cur_hit_rate numeric;
  seq1 int; seq_retry int; retry_rate numeric;
  bad_model_n int; bad_models text;
  vol_now int; vol_median numeric;
  usd_24h numeric; usd_median_day numeric;
  sev text;
begin
  -- ── current window ────────────────────────────────────────────────────────────
  select count(*),
         coalesce(sum(cache_hit_tokens), 0),
         coalesce(sum(prompt_tokens), 0),
         coalesce(avg(usd), 0)
    into cur_n, cur_hit, cur_prompt, cur_usd
    from public.ai_usage_costed
   where at >= now() - win;

  -- ── established baseline (excludes the current window so a slow drift cannot hide in it) ──
  select count(*), coalesce(avg(usd), 0),
         case when coalesce(sum(prompt_tokens), 0) > 0
              then coalesce(sum(cache_hit_tokens), 0)::numeric / sum(prompt_tokens) end
    into base_n, base_usd, base_hit_rate
    from public.ai_usage_costed
   where at >= now() - base_win and at < now() - win;

  cur_hit_rate := case when cur_prompt > 0 then cur_hit / cur_prompt end;

  -- ── 1. CACHE HIT RATE COLLAPSE ────────────────────────────────────────────────
  -- Absolute thresholds, not relative: 99% is the measured norm and anything under ~85% already
  -- means the prefix is not matching for a large share of traffic.
  if cur_n >= min_now and cur_hit_rate is not null and cur_hit_rate < 0.85 then
    sev := case when cur_hit_rate < 0.60 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'ai_cost_health', 'deepseek', 'ai_cache_collapse',
      jsonb_build_object(
        'window_hours', 6,
        'current_cache_hit_rate', round(cur_hit_rate, 4),
        'baseline_cache_hit_rate', round(coalesce(base_hit_rate, 0.99), 4),
        'sample', cur_n,
        'measured_norm', 0.99,
        'what_this_means',
          'DeepSeek prefix caching has stopped matching. The system prompt is ~18k tokens; at a 99% hit rate that costs about $0.00025 per message, and with no cache the SAME traffic costs $8.14 per 1,000 messages instead of $0.48 — roughly 17x, with no visible change to the product.',
        'first_check',
          'Did anything dynamic get placed BEFORE the system prompt in messages[] in supabase/functions/agent/index.ts? The system message must stay a byte-identical prefix: SYSTEM first, then sysExtra, then JSON_SHAPE_HINT. A per-request value (timestamp, user id, counter) anywhere in SYSTEM breaks every cache entry. Also check whether agent_notes was edited — that is appended AFTER SYSTEM and is safe, but a change moves the tail.',
        'rule',
          'Never fix this by shrinking the prompt. Restore the cache prefix — the prompt size is not the problem.'));
    live_keys := live_keys || array['ai_cache_collapse'];
  end if;

  -- ── 2. COST PER MESSAGE ABOVE BASELINE ────────────────────────────────────────
  -- The catch-all: whatever the cause, if a message costs materially more than it used to, this
  -- fires. Requires BOTH a healthy sample now and an established baseline, and an absolute floor
  -- so that noise around a very cheap baseline cannot trip it.
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
          'Check the sibling alerts first — ai_cache_collapse, ai_unexpected_model and ai_calls_per_turn each cause this and each names its own cause. If none of them fired, compare avg prompt_tokens and completion_tokens in public.ai_usage over the same window: a grown prompt or longer replies move cost without any of the three.',
        'rule',
          'Do not respond by cutting agent quality. Find which input moved first.'));
    live_keys := live_keys || array['ai_cost_per_message'];
  end if;

  -- ── 3. MORE THAN ONE MODEL CALL PER TURN ──────────────────────────────────────
  -- call_seq 1 is the turn's own call; anything above it is the language-guard retry, which sends
  -- the whole prompt a second time. Baseline is ~0, so a sustained retry rate is a real doubling.
  select count(*) filter (where call_seq = 1), count(*) filter (where call_seq > 1)
    into seq1, seq_retry
    from public.ai_usage where at >= now() - win;
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
          'The retry fires when detectLang(out.reply) disagrees with the requested locale. Look for a locale-detection regression, or an agent_notes edit that pushes the model toward the wrong language.',
        'rule',
          'Fix the language selection deterministically. Do NOT silence this by removing the retry — a wrong-language reply is a product failure.'));
    live_keys := live_keys || array['ai_calls_per_turn'];
  end if;

  -- ── 4. BILLED MODEL IS NOT THE EXPECTED TIER ──────────────────────────────────
  -- DEEPSEEK_MODEL is an alias ("deepseek-chat"); DeepSeek decides what it resolves to and reports
  -- it back as data.model. A silent move to v4-pro triples the bill with no code change at all.
  -- 24h window and a >=3 floor so a single odd response cannot page anyone.
  select count(*), string_agg(distinct model, ', ')
    into bad_model_n, bad_models
    from public.ai_usage
   where at >= now() - interval '24 hours'
     and model is not null
     and model not ilike expected_model_like;

  if bad_model_n >= 3 then
    n := n + public.mon_raise('P0', 'ai_cost_health', 'deepseek', 'ai_unexpected_model',
      jsonb_build_object(
        'window_hours', 24,
        'unexpected_calls', bad_model_n,
        'models_seen', bad_models,
        'expected_like', expected_model_like,
        'what_this_means',
          'DeepSeek billed calls on a model we do not expect. deepseek-chat is an ALIAS and the tier it resolves to sets the whole bill: v4-pro costs 3x v4-flash on the same call ($1.48 vs $0.48 per 1,000 messages). Nothing in our code has to change for this to happen.',
        'first_check',
          'Read public.ai_usage: requested_model is what we asked for, model is what DeepSeek says it billed. If requested_model is unchanged and model moved, DeepSeek re-pointed the alias — pin DEEPSEEK_MODEL to an explicit model id. If a reasoning model appears, also check reasoning_tokens: that was the 2026-08-28 outage (reasoning ate max_tokens and the turn returned empty).',
        'rule',
          'This is an owner-level cost decision. Do not widen expected_model_like to make the alert stop.'));
    live_keys := live_keys || array['ai_unexpected_model'];
  end if;

  -- ── 5. REQUEST VOLUME SPIKE ───────────────────────────────────────────────────
  -- Cost is per call, so volume is a cost variable even when every call is healthy. Compared to the
  -- MEDIAN hourly volume of the last 7 days (median, not mean, so one busy hour does not raise the
  -- bar for the next one).
  select count(*) into vol_now from public.ai_usage where at >= now() - vol_win;

  select percentile_cont(0.5) within group (order by c)
    into vol_median
    from (
      select count(*) c
        from public.ai_usage
       where at >= now() - base_win and at < now() - vol_win
       group by date_trunc('hour', at)
    ) h;

  if vol_median is not null and vol_median >= 5 and vol_now >= 100 and vol_now > vol_median * 5 then
    n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_volume_spike',
      jsonb_build_object(
        'window_minutes', 60,
        'calls_last_hour', vol_now,
        'median_hourly_calls_7d', round(vol_median, 1),
        'ratio', round(vol_now / nullif(vol_median, 0), 1),
        'estimated_extra_usd_this_hour',
          round((vol_now - vol_median) * coalesce(nullif(base_usd, 0), 0.000482), 4),
        'what_this_means',
          'AI request volume is far above normal. Every call is billed, so this is a cost event even if each individual call is healthy.',
        'first_check',
          'Is it real users, an automated test loop, or a client retry storm? public.ai_usage has no user id by design (PDPL), so correlate with agent_health_event volume and the Supabase edge request logs. A frontend that lost its in-flight guard shows up here first.',
        'rule',
          'Confirm the traffic is genuine before treating it as growth.'));
    live_keys := live_keys || array['ai_volume_spike'];
  end if;

  -- ── 6. DAILY SPEND STEP-CHANGE ────────────────────────────────────────────────
  -- The owner-facing number. Per-message cost can be flat while the daily bill still climbs
  -- (volume), and vice versa — so watch the total independently of the rate.
  select coalesce(sum(usd), 0) into usd_24h
    from public.ai_usage_costed where at >= now() - interval '24 hours';

  select percentile_cont(0.5) within group (order by d)
    into usd_median_day
    from (
      select sum(usd) d
        from public.ai_usage_costed
       where at >= now() - base_win and at < now() - interval '24 hours'
       group by date_trunc('day', at)
    ) x;

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
          'Check the sibling alerts to see WHICH variable moved: ai_volume_spike (more calls) vs ai_cost_per_message / ai_cache_collapse / ai_unexpected_model (dearer calls). If none fired, the change is gradual rather than a step.',
        'rule',
          'These figures cover only calls this project makes. If the DeepSeek dashboard shows materially more spend than public.ai_usage_costed accounts for, something OUTSIDE this project is using the same API key — that gap is the finding, not a detector fault.'));
    live_keys := live_keys || array['ai_daily_spend_step_change'];
  end if;

  -- Self-heal: any key not raised this pass resolves, closing its GitHub issue.
  perform public.mon_resolve_stale_keys('ai_cost_health', live_keys);

  -- Retention. Longer than agent_health_event's 14 days on purpose: cost history IS the product of
  -- this table, and the 7-day baseline above needs headroom.
  delete from public.ai_usage where at < now() - interval '90 days';

  return n;
end
$function$;

comment on function public.mon_detect_ai_cost_health() is
  'Watches DeepSeek cost health from public.ai_usage_costed: cache-hit collapse, cost/message vs baseline, calls/turn, unexpected billed model, volume spike, daily spend step-change. Observes only — never changes model, prompt or caching.';
