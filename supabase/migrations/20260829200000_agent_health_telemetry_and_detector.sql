-- AI AGENT HEALTH ALERT (owner request 2026-08-29).
--
-- WHY. On 2026-08-29 the agent ran BROKEN for ~14.5 hours — 213 failed calls, every one burning the
-- full ~17,400-token prompt and returning nothing — and nobody knew until the DeepSeek bill was read
-- by hand. The client falls back to its bundled offline heuristic on any failure
-- (src/data/agent.ts:571,583-585), so users kept seeing results and the outage was SILENT.
--
-- That fallback is the whole reason this alert has to exist: "the user saw results" is NOT evidence
-- the AI worked. The owner's rule, encoded below: a turn the fallback rescued still counts as an AI
-- FAILURE for monitoring.
--
-- ~170 detectors existed and not one watched the agent. The agent's health lived only in Supabase
-- edge logs, which Postgres cannot read — so the detector framework was structurally blind to it.
-- This migration gives the agent a Postgres-visible heartbeat and a detector over it.

-- ── 1. TELEMETRY ────────────────────────────────────────────────────────────
create table if not exists public.agent_health_event (
  id          bigserial primary key,
  at          timestamptz  not null default now(),
  outcome     text         not null,
  latency_ms  integer,
  -- TRUE when this turn could not have reached the user as an AI answer: the model call failed, or
  -- it outran the client's 20s race in src/data/agent.ts:569 and the client had already fallen back.
  -- This — not `outcome <> 'ok'` — is the number the owner asked to be alerted on.
  fallback_certain boolean not null default false,
  detail      jsonb        not null default '{}'::jsonb,
  constraint agent_health_outcome_known check (outcome in (
    'ok', 'model_http_error', 'empty_output', 'unparseable', 'no_classification',
    'model_not_configured', 'exception'))
);
comment on table public.agent_health_event is
  'One row per DeepSeek model call from the agent edge function. Written fire-and-forget; a failure '
  'to record must never break a user turn. Read by mon_detect_agent_health().';

create index if not exists idx_agent_health_at on public.agent_health_event (at desc);
create index if not exists idx_agent_health_at_fallback on public.agent_health_event (at desc, fallback_certain);

alter table public.agent_health_event enable row level security;
-- No policies: the edge function writes with the service role, the detector is SECURITY DEFINER.
-- Anon/authenticated get nothing — this is ops telemetry, not user data.

-- ── 2. DETECTOR ─────────────────────────────────────────────────────────────
create or replace function public.mon_detect_agent_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  -- TWO ADJACENT WINDOWS. The owner asked explicitly for low noise and no alert on one random
  -- failure. Requiring the CURRENT and PREVIOUS window to both breach is the consecutive-window
  -- logic: a single bad minute, one cold-start blip or one DeepSeek hiccup cannot raise anything.
  win interval := interval '30 minutes';
  min_sample int := 20;   -- below this a "rate" is noise, not a signal
  cur_total int; cur_bad int; cur_p90 numeric;
  prv_total int; prv_bad int;
  cur_rate numeric; prv_rate numeric;
  sev text; live_keys text[] := '{}';
begin
  select count(*), count(*) filter (where fallback_certain),
         percentile_disc(0.9) within group (order by latency_ms)
    into cur_total, cur_bad, cur_p90
    from public.agent_health_event where at >= now() - win;

  select count(*), count(*) filter (where fallback_certain)
    into prv_total, prv_bad
    from public.agent_health_event where at >= now() - win*2 and at < now() - win;

  cur_rate := case when cur_total > 0 then cur_bad::numeric / cur_total else 0 end;
  prv_rate := case when prv_total > 0 then prv_bad::numeric / prv_total else 0 end;

  -- FAILURE RATE. Both windows must carry a real sample AND both must breach.
  if cur_total >= min_sample and prv_total >= min_sample
     and cur_rate >= 0.20 and prv_rate >= 0.20 then
    sev := case when cur_rate >= 0.50 then 'P0' else 'P1' end;
    n := n + public.mon_raise(sev, 'agent_health', 'deepseek', 'agent_failure_rate',
      jsonb_build_object(
        'window_minutes', 30,
        'current_failure_rate', round(cur_rate, 3), 'current_failed', cur_bad, 'current_total', cur_total,
        'previous_failure_rate', round(prv_rate, 3), 'previous_failed', prv_bad, 'previous_total', prv_total,
        'top_outcomes', (select jsonb_object_agg(o, c) from (
            select outcome o, count(*) c from public.agent_health_event
             where at >= now() - win and fallback_certain group by outcome order by 2 desc limit 5) s),
        'what_this_means',
          'The AI agent is failing. Users are NOT seeing an error — the client falls back to its '
          'bundled offline heuristic (src/data/agent.ts:571), so the product looks fine while the AI '
          'is dead. This is exactly how the 2026-08-29 outage stayed invisible for 14.5 hours.',
        'first_check',
          'Read the deepseek_usage / error lines in Supabase function_logs for the agent function. '
          'finish_reason "length" with reasoning_tokens == max_tokens means the model alias is a '
          'REASONING alias again and the whole budget is going to hidden chain-of-thought — that was '
          'the 2026-08-28 root cause. Also check the DeepSeek balance: a 402 surfaces here as '
          'model_http_error.',
        'rule',
          'A turn the fallback rescued is still an AI FAILURE. Never resolve this by pointing at the '
          'fallback working.'));
    live_keys := live_keys || array['agent_failure_rate'];
  end if;

  -- LATENCY. p90 past the client's own 20s race means users are being served the offline heuristic
  -- even when the model eventually answers. Same two-window discipline via the sample floor.
  if cur_total >= min_sample and cur_p90 is not null and cur_p90 > 20000 then
    n := n + public.mon_raise('P2', 'agent_health', 'deepseek', 'agent_latency',
      jsonb_build_object(
        'window_minutes', 30, 'p90_latency_ms', cur_p90, 'client_timeout_ms', 20000, 'sample', cur_total,
        'what_this_means',
          'The agent is answering slower than the client waits (src/data/agent.ts:569), so the user '
          'gets the offline heuristic even on turns the model eventually completes.',
        'first_check', 'DeepSeek API latency, then prompt size — every call carries the full system message.'));
    live_keys := live_keys || array['agent_latency'];
  end if;

  -- Auto-close whichever keys are no longer live, so a recovered agent clears its own alert.
  perform public.mon_resolve_stale_keys('agent_health', live_keys);

  -- Bound the table. The detector only ever reads the last hour; 14 days is generous for a human
  -- reading back through an incident, and stops ops telemetry growing without limit.
  delete from public.agent_health_event where at < now() - interval '14 days';

  return n;
end
$function$;

comment on function public.mon_detect_agent_health() is
  'AI agent health: failure rate and latency over two adjacent 30-minute windows. A turn rescued by '
  'the client fallback counts as a FAILURE. Registered in mon_run_all_detectors().';

grant execute on function public.mon_detect_agent_health() to service_role;
