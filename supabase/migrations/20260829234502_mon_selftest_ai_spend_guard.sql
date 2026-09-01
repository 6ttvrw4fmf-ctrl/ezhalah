-- MIRROR of the migration applied to production on 2026-08-29 (migration-mirror rule).
--
-- Mutation-proof for the AI spend circuit breaker. A breaker nobody has watched trip is a promise,
-- not a protection. On its FIRST run this caught a real defect: a local variable named `detail`
-- collided with ai_spend_state.detail, making the UPDATE on the trip path ambiguous — the gate
-- would have thrown exactly when it mattered.
--
-- ISOLATION: synthetic rows are marked source='selftest' and removed at the end; the real breaker
-- state and any alert rows created during the run are restored/removed, so a genuine open breaker or
-- a genuine alert is never disturbed.
create or replace function public.mon_selftest_ai_spend_guard()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r jsonb := '{}'::jsonb;
  before_state text; before_reason text; before_tripped timestamptz;
  before_max_id bigint;
  g jsonb;
  saved_max_calls int; saved_min int;
begin
  select state, reason, tripped_at into before_state, before_reason, before_tripped
    from public.ai_spend_state where id;
  select coalesce(max(id), 0) into before_max_id from public.alert_event;
  select max_calls_per_hour, min_calls_before_trip into saved_max_calls, saved_min
    from public.ai_spend_config where id;

  delete from public.ai_usage where source = 'selftest';

  -- 1. healthy: the gate ALLOWS
  update public.ai_spend_state set state = 'closed', reason = null, tripped_at = null where id;
  g := public.ai_spend_gate('selftest');
  r := r || jsonb_build_object('allows_when_healthy', (g->>'allow')::boolean);

  -- 2. breach a rolling ceiling: DENY + TRIP. Lower the ceiling rather than insert 2,000 rows -
  -- the ceiling is config, so this exercises the identical comparison the real ceiling uses.
  update public.ai_spend_config set max_calls_per_hour = 5, min_calls_before_trip = 3 where id;
  insert into public.ai_usage (at, source, requested_model, model, kind, locale, call_seq,
    prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens, total_tokens, finish_reason, history_turns, latency_ms)
  select now() - interval '1 minute', 'selftest', 'deepseek-chat', 'deepseek-v4-flash', 'listings', 'ar', 1,
         18156, 115, 17978, 178, 18271, 'stop', 4, 1500
  from generate_series(1, 20);

  g := public.ai_spend_gate('selftest');
  r := r || jsonb_build_object('denies_when_over_ceiling', (g->>'allow')::boolean = false,
                               'trip_reason', g->>'reason');
  r := r || jsonb_build_object('breaker_state_is_open',
    (select state = 'open' from public.ai_spend_state where id));
  r := r || jsonb_build_object('raised_p0_alert', exists (
    select 1 from public.alert_event
     where id > before_max_id and kind = 'ai_spend_guard'
       and dedup_key = 'ai_spend_circuit_open' and severity = 'P0'));

  -- 3. once open it STAYS open (no silent self-heal back into spending)
  update public.ai_spend_config set max_calls_per_hour = saved_max_calls, min_calls_before_trip = saved_min where id;
  g := public.ai_spend_gate('selftest');
  r := r || jsonb_build_object('stays_open_until_reset', (g->>'allow')::boolean = false);

  -- 4. reset REFUSES while the breach is still live
  update public.ai_spend_config set max_calls_per_hour = 5, min_calls_before_trip = 3 where id;
  r := r || jsonb_build_object('reset_refuses_while_unhealthy',
    (public.ai_spend_reset('selftest', 'selftest')->>'reset')::boolean = false);

  -- 5. reset SUCCEEDS once healthy, and the gate allows again
  update public.ai_spend_config set max_calls_per_hour = saved_max_calls, min_calls_before_trip = saved_min where id;
  delete from public.ai_usage where source = 'selftest';
  r := r || jsonb_build_object('reset_succeeds_when_healthy',
    (public.ai_spend_reset('selftest complete', 'selftest')->>'reset')::boolean = true);
  g := public.ai_spend_gate('selftest');
  r := r || jsonb_build_object('allows_after_reset', (g->>'allow')::boolean);

  -- restore
  delete from public.ai_usage where source = 'selftest';
  delete from public.alert_event where id > before_max_id and kind = 'ai_spend_guard';
  update public.ai_spend_config set max_calls_per_hour = saved_max_calls, min_calls_before_trip = saved_min where id;
  update public.ai_spend_state
     set state = before_state, reason = before_reason, tripped_at = before_tripped,
         reset_at = null, reset_by = null, updated_at = now()
   where id;

  r := r || jsonb_build_object('all_passed',
    (r->>'allows_when_healthy')::boolean and (r->>'denies_when_over_ceiling')::boolean
    and (r->>'breaker_state_is_open')::boolean and (r->>'raised_p0_alert')::boolean
    and (r->>'stays_open_until_reset')::boolean and (r->>'reset_refuses_while_unhealthy')::boolean
    and (r->>'reset_succeeds_when_healthy')::boolean and (r->>'allows_after_reset')::boolean);
  return r;
end
$function$;

comment on function public.mon_selftest_ai_spend_guard() is
  'Mutation-proof for the AI spend circuit breaker: allows when healthy, denies+trips over ceiling, raises P0, stays open until reset, refuses reset while unhealthy, resets when healthy. Restores all state.';
