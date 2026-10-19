-- AI COST MONITORING KNOWS GROQ (owner 2026-10-17). The agent can switch provider (AI_PROVIDER, PR #7270)
-- to Groq's openai/gpt-oss models. Two DeepSeek-only assumptions would then misfire on EVERY call:
--   ai_unexpected_model         expected '%flash%' — a gpt-oss model never matches it
--   ai_reasoning_tokens_billed  "any reasoning token = P0" — gpt-oss is a reasoning model by design
-- Each provider now has its own expected model; the reasoning alarm keeps guarding the DeepSeek
-- non-reasoning pin exactly as before. DeepSeek's thresholds are untouched ('%flash%' stays).
-- And ai_usage_costed prices Groq calls at Groq's published gpt-oss rates: $0.075/M input,
-- $0.30/M output, cached input 50% off ($0.0375/M), no peak/off-peak split.
do $mig$
declare d text := pg_get_functiondef('public.mon_detect_ai_cost_health'::regproc);
begin
  if position($n$expected_model_like text := '%flash%';$n$ in d) = 0
     or position($n$and model is not null and model not ilike expected_model_like;$n$ in d) = 0
     or position($n$and coalesce(reasoning_tokens, 0) > 0;$n$ in d) = 0 then
    raise exception 'mon_detect_ai_cost_health changed shape — refusing to guess the edit';
  end if;
  d := replace(d, $n$expected_model_like text := '%flash%';$n$,
    $n$expected_model_like text := '%flash%';
  expected_groq_like  text := '%gpt-oss%';  -- Groq provider (owner 2026-10-17): its own expected model$n$);
  d := replace(d, $n$and model is not null and model not ilike expected_model_like;$n$,
    $n$and model is not null and model not ilike expected_model_like and model not ilike expected_groq_like;$n$);
  d := replace(d, $n$and coalesce(reasoning_tokens, 0) > 0;$n$,
    $n$and coalesce(reasoning_tokens, 0) > 0
     and coalesce(model, requested_model, '') not ilike expected_groq_like;  -- gpt-oss reasons by design$n$);
  execute d;
end
$mig$;

create or replace view public.ai_usage_costed as
with p as (
  select u.id, u.at, u.requested_model, u.model, u.kind, u.locale, u.call_seq,
         u.prompt_tokens, u.completion_tokens, u.reasoning_tokens, u.cache_hit_tokens, u.cache_miss_tokens,
         u.total_tokens, u.finish_reason, u.history_turns, u.latency_ms,
         extract(isodow from (u.at at time zone 'UTC')) <= 5
           and (((u.at at time zone 'UTC')::time >= '01:00' and (u.at at time zone 'UTC')::time < '04:00')
             or ((u.at at time zone 'UTC')::time >= '06:00' and (u.at at time zone 'UTC')::time < '10:00')) as is_peak,
         case
           when coalesce(u.model, u.requested_model) ilike '%gpt-oss%' then 'groq'
           when coalesce(u.model, u.requested_model) ilike '%pro%' then 'pro'
           else 'flash'
         end as tier,
         u.source, u.attempt, u.http_status
    from ai_usage u
)
select id, at, requested_model, model, kind, locale, call_seq, prompt_tokens, completion_tokens,
       reasoning_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns,
       latency_ms, is_peak, tier,
       round(
         coalesce(cache_hit_tokens, 0)::numeric / 1000000 *
           case when tier = 'groq' then 0.0375
                when tier = 'pro' then case when is_peak then 0.044 else 0.022 end
                else case when is_peak then 0.014 else 0.007 end end
       + coalesce(cache_miss_tokens, greatest(coalesce(prompt_tokens, 0) - coalesce(cache_hit_tokens, 0), 0))::numeric / 1000000 *
           case when tier = 'groq' then 0.075
                when tier = 'pro' then case when is_peak then 1.32 else 0.66 end
                else case when is_peak then 0.44 else 0.22 end end
       + coalesce(completion_tokens, 0)::numeric / 1000000 *
           case when tier = 'groq' then 0.30
                when tier = 'pro' then case when is_peak then 3.96 else 1.98 end
                else case when is_peak then 1.32 else 0.66 end end,
       8) as usd,
       source, attempt, http_status
  from p;
