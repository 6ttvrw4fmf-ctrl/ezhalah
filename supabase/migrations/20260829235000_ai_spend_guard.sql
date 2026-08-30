-- ═══ AI SPEND SAFETY: CONFIG, STATE, ATTRIBUTION, GATE, RESET ════════════════════════════════
-- MIRROR of the migrations applied to production on 2026-08-29 (migration-mirror rule).
--
-- Owner ruling: "A bug may degrade the AI temporarily, but no bug should ever be allowed to silently
-- bankrupt us. Quality can fail soft; spending must fail closed."
--
-- THRESHOLDS LIVE HERE AND NOWHERE ELSE. Single documented source of truth, tunable with an UPDATE,
-- never a redeploy of the 93KB agent function. Every default is derived from MEASURED production
-- baselines (2026-08-29), not guessed:
--   observed peak hour ...... 50 turns/hour
--   observed typical hour ... 9-21 turns/hour
--   observed cost/call ...... $0.000482 peak rate, $0.000241 off-peak
--   observed cache hit ...... 99.0-99.6%
--   observed calls/turn ..... 1.00
-- Ceilings sit ~40x above the observed peak, so ordinary growth (even a very good launch day) never
-- trips them while a genuine runaway is stopped inside one rolling window. They ARE meant to be
-- tuned: if the owner learns the DeepSeek account's own limits, update this row.
create table if not exists public.ai_spend_config (
  id                        boolean primary key default true check (id),  -- single-row table
  max_calls_per_hour        integer not null default 2000,   -- 40x the observed 50/h peak
  max_usd_per_hour          numeric not null default 2.00,   -- ~4100 calls at the measured rate
  max_calls_per_day         integer not null default 20000,
  max_usd_per_day           numeric not null default 10.00,
  -- A breaker must never trip on a tiny sample: below this many calls in the window the ceilings are
  -- not evaluated at all, so one odd burst on a quiet day cannot take the AI down.
  min_calls_before_trip     integer not null default 200,
  -- Models we are willing to PAY for. Mirrors ALLOWED_MODELS in the agent edge function.
  allowed_models            text[]  not null default array['deepseek-chat','deepseek-v4-flash'],
  enabled                   boolean not null default true,
  notes                     text,
  updated_at                timestamptz not null default now()
);

insert into public.ai_spend_config (id, notes)
values (true, 'Defaults derived from measured 2026-08-29 baselines: 50 turns/h peak, $0.000482/call, 1.00 calls/turn, 99% cache. Ceilings ~40x peak.')
on conflict (id) do nothing;

alter table public.ai_spend_config enable row level security;

comment on table public.ai_spend_config is
  'THE source of truth for AI spend ceilings. Tune with UPDATE; never hardcode a limit in the edge function.';

-- Separate from config on purpose: config is intent, state is what is happening now. A trip must
-- record exactly WHY, and resuming paid calls must be a deliberate act, never a silent recovery.
create table if not exists public.ai_spend_state (
  id            boolean primary key default true check (id),
  state         text not null default 'closed' check (state in ('closed','open')),
  reason        text,
  detail        jsonb,
  tripped_at    timestamptz,
  reset_at      timestamptz,
  reset_by      text,
  updated_at    timestamptz not null default now()
);
insert into public.ai_spend_state (id) values (true) on conflict (id) do nothing;
alter table public.ai_spend_state enable row level security;

comment on table public.ai_spend_state is
  'AI spend circuit breaker. state=open means NO new paid DeepSeek calls. Reset only via ai_spend_reset() after the condition is healthy.';

-- ATTRIBUTION: without this a CI job and a real customer are indistinguishable in the cost data, so
-- "is our spend real usage or a runaway test loop?" cannot be answered — and that was a live
-- question. Defaults to 'user' so an unlabelled call is counted as the more important kind.
alter table public.ai_usage add column if not exists source text not null default 'user';
create index if not exists ai_usage_source_at_idx on public.ai_usage (source, at desc);

comment on column public.ai_usage.source is
  'Caller class: user | ci | selftest. Set from the x-ezhalah-client request header; defaults to user.';

-- ═══ THE GATE ════════════════════════════════════════════════════════════════════════════════
-- Called by the agent edge function BEFORE every paid DeepSeek request. One round trip, and it is
-- authoritative: the decision, the rolling-window arithmetic and the trip all happen inside one
-- statement, so two concurrent workers cannot both squeeze past a ceiling.
--
-- FAIL CLOSED IS THE CALLER'S JOB TOO: if this RPC errors or times out, the edge function treats it
-- as DENY. Safe for the product because the client already falls back to its deterministic offline
-- heuristic on any agent failure, and Normal Filter / Advanced Filter / pagination / sort never call
-- the model at all.
--
-- NOTE the v_detail naming: a local named `detail` collides with ai_spend_state.detail and makes the
-- UPDATE on the trip path ambiguous — the gate then throws exactly when it matters. Caught by
-- mon_selftest_ai_spend_guard() on its first run.
create or replace function public.ai_spend_gate(p_source text default 'user')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.ai_spend_config%rowtype;
  s public.ai_spend_state%rowtype;
  h_calls int; h_usd numeric;
  d_calls int; d_usd numeric;
  breach text := null;
  v_detail jsonb;
begin
  select * into c from public.ai_spend_config where id;
  select * into s from public.ai_spend_state where id;

  -- No config row = misconfiguration, not permission. Deny.
  if c is null or s is null then
    return jsonb_build_object('allow', false, 'state', 'open',
      'reason', 'ai_spend_config/ai_spend_state missing - refusing to spend without a ceiling');
  end if;

  if not c.enabled then
    return jsonb_build_object('allow', true, 'state', 'disabled', 'reason', 'gating disabled in config');
  end if;

  -- Already tripped: stay closed until someone runs ai_spend_reset(). Never self-heal into spending
  -- again - a breaker that resets itself is just a delay before the same drain.
  if s.state = 'open' then
    return jsonb_build_object('allow', false, 'state', 'open',
      'reason', coalesce(s.reason, 'circuit breaker open'),
      'tripped_at', s.tripped_at);
  end if;

  select count(*), coalesce(sum(usd), 0) into h_calls, h_usd
    from public.ai_usage_costed where at >= now() - interval '1 hour';
  select count(*), coalesce(sum(usd), 0) into d_calls, d_usd
    from public.ai_usage_costed where at >= now() - interval '24 hours';

  if h_calls >= c.min_calls_before_trip then
    if h_calls > c.max_calls_per_hour then
      breach := format('calls/hour %s exceeded ceiling %s', h_calls, c.max_calls_per_hour);
    elsif h_usd > c.max_usd_per_hour then
      breach := format('spend/hour $%s exceeded ceiling $%s', round(h_usd, 4), c.max_usd_per_hour);
    end if;
  end if;

  if breach is null and d_calls >= c.min_calls_before_trip then
    if d_calls > c.max_calls_per_day then
      breach := format('calls/24h %s exceeded ceiling %s', d_calls, c.max_calls_per_day);
    elsif d_usd > c.max_usd_per_day then
      breach := format('spend/24h $%s exceeded ceiling $%s', round(d_usd, 4), c.max_usd_per_day);
    end if;
  end if;

  if breach is not null then
    v_detail := jsonb_build_object(
      'calls_1h', h_calls, 'usd_1h', round(h_usd, 6),
      'calls_24h', d_calls, 'usd_24h', round(d_usd, 6),
      'ceilings', jsonb_build_object(
        'max_calls_per_hour', c.max_calls_per_hour, 'max_usd_per_hour', c.max_usd_per_hour,
        'max_calls_per_day', c.max_calls_per_day, 'max_usd_per_day', c.max_usd_per_day),
      'by_source', (select jsonb_object_agg(src, n) from (
          select coalesce(source,'user') src, count(*) n from public.ai_usage
           where at >= now() - interval '24 hours' group by 1) x),
      'triggered_by_source', p_source);

    update public.ai_spend_state
       set state = 'open', reason = breach, detail = v_detail,
           tripped_at = now(), reset_at = null, reset_by = null, updated_at = now()
     where id;

    perform public.mon_raise('P0', 'ai_spend_guard', 'deepseek', 'ai_spend_circuit_open',
      v_detail || jsonb_build_object(
        'breach', breach,
        'what_this_means',
          'The AI spend circuit breaker TRIPPED and no new paid DeepSeek calls are being made. The product is NOT down: the client falls back to its deterministic offline heuristic, and Normal Filter, Advanced Filter, pagination and sort never used the model at all.',
        'first_check',
          'Look at by_source above. If the volume is ci/selftest, a test loop is the cause - fix the loop, do not raise the ceiling. If it is user traffic, confirm it is genuine before treating it as growth, then tune public.ai_spend_config deliberately.',
        'rule',
          'Paid calls resume ONLY via public.ai_spend_reset(reason) after the cause is understood. Never widen a ceiling just to clear the alert.'));

    return jsonb_build_object('allow', false, 'state', 'open', 'reason', breach, 'detail', v_detail);
  end if;

  return jsonb_build_object('allow', true, 'state', 'closed',
    'calls_1h', h_calls, 'usd_1h', round(h_usd, 6),
    'calls_24h', d_calls, 'usd_24h', round(d_usd, 6));
end
$function$;

comment on function public.ai_spend_gate(text) is
  'Authoritative pre-call gate for paid DeepSeek requests. Returns {allow}. Trips the breaker and raises P0 when a rolling ceiling is breached. Caller MUST treat an error as deny.';

-- Deliberate, attributable, and it REFUSES while the breach is still live — otherwise a reset just
-- re-opens the tap into the same runaway.
create or replace function public.ai_spend_reset(p_reason text, p_by text default 'owner', p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.ai_spend_config%rowtype;
  h_calls int; h_usd numeric;
begin
  select * into c from public.ai_spend_config where id;
  select count(*), coalesce(sum(usd), 0) into h_calls, h_usd
    from public.ai_usage_costed where at >= now() - interval '1 hour';

  if not p_force and (h_calls > c.max_calls_per_hour or h_usd > c.max_usd_per_hour) then
    return jsonb_build_object('reset', false,
      'reason', format('refusing: the last hour is STILL over ceiling (%s calls, $%s). Fix the cause, or pass p_force := true deliberately.',
                       h_calls, round(h_usd, 4)));
  end if;

  update public.ai_spend_state
     set state = 'closed', reason = null, detail = null,
         reset_at = now(), reset_by = coalesce(p_by, 'owner'), updated_at = now()
   where id;

  perform public.mon_resolve_key('ai_spend_guard', 'ai_spend_circuit_open');

  return jsonb_build_object('reset', true, 'by', p_by, 'note', p_reason,
    'calls_last_hour', h_calls, 'usd_last_hour', round(h_usd, 6));
end
$function$;

comment on function public.ai_spend_reset(text, text, boolean) is
  'Controlled reset of the AI spend breaker. Refuses while the last hour is still over ceiling unless p_force. Resolves the P0 alert.';
