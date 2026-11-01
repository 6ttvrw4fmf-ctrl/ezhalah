-- TEST ROBOTS QUEUE FOR TWO LANES; USERS NEVER WAIT (owner 2026-10-04: «make sure we never ever get
-- this problem»).
--
-- THE INCIDENT. 2026-10-04 21:52-22:21 UTC a real جدة/شراء/سكني search showed «يجري تحميل الإعلانات»
-- after ~45 s with 0 cards. Edge logs: 85% of location_search_candidates_ar calls were our own live
-- checks (user-agent `node`, anon key, GitHub runners) — district-suggestion parity held ~9.5 searches
-- in flight while three AF backend-truth jobs and count-parity ran beside it; browser p90 hit 17-20 s.
-- Capping one script (PR #6035) does not stop the NEXT script, or five capped scripts overlapping.
--
-- THE FIX, IN THE ONE PLACE EVERY ROBOT PASSES. PostgREST runs `pgrst.db_pre_request` before every
-- API request, inside that request's transaction. robot_gate() makes a robot request take one of
-- ROBOT_LANES transaction-scoped advisory locks before its query runs, so across ALL runners, scripts
-- and sessions at most ROBOT_LANES robot queries run at once; the rest wait their turn.
--
-- WHO IS A ROBOT — an explicit list, so a real user can never be mistaken for one:
--   role anon/authenticated (live checks must use the public key) AND user-agent of a script runtime
--   (node, undici, axios, curl, python). Browsers ("Mozilla/…") are never gated. service_role is never
--   gated: scrapers (python-httpx, curl) and the agent edge function (Deno) use it, and the agent
--   serves real users.
--
-- WHAT IT NEVER DOES. It never refuses or changes a request: same query, same rows, same counts — a
-- robot only starts later. Any error inside the gate lets the request through (fail-open), and a
-- robot that waited ROBOT_MAX_WAIT goes through anyway, so a gate fault can never take the API down.
--
-- ROLLBACK: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

create or replace function public.robot_gate_applies(p_user_agent text, p_role text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(
    p_role in ('anon', 'authenticated')
    and (p_user_agent = 'node'
         or p_user_agent like 'node-fetch/%'
         or p_user_agent like 'undici%'
         or p_user_agent like 'axios/%'
         or p_user_agent like 'curl/%'
         or p_user_agent like 'python-%'),
    false)
$$;

create or replace function public.robot_gate()
returns void
language plpgsql
set search_path to ''
as $$
declare
  -- ponytail: one global pool of 2 lanes and a 6 s wait (under authenticator's 8 s statement_timeout),
  -- then fail-open. Tune these two numbers if robots start timing out or users still feel them.
  robot_lanes constant int := 2;
  robot_max_wait constant interval := interval '6 seconds';
  give_up_at timestamptz;
begin
  if not public.robot_gate_applies(
       current_setting('request.headers', true)::json ->> 'user-agent', current_user::text) then
    return;
  end if;
  give_up_at := clock_timestamp() + robot_max_wait;
  loop
    for lane in 1..robot_lanes loop
      if pg_try_advisory_xact_lock(hashtext('ezhalah:robot_gate'), lane) then
        return;
      end if;
    end loop;
    exit when clock_timestamp() >= give_up_at;
    perform pg_sleep(0.1);
  end loop;
exception when others then
  return;
end
$$;

grant execute on function public.robot_gate_applies(text, text) to public;
grant execute on function public.robot_gate() to public;

-- Self-check, at apply time: the classifier's whole contract.
do $$
begin
  if not public.robot_gate_applies('node', 'anon') then raise exception 'robot_gate: node/anon must queue'; end if;
  if not public.robot_gate_applies('curl/8.5.0', 'anon') then raise exception 'robot_gate: curl/anon must queue'; end if;
  if not public.robot_gate_applies('python-httpx/0.27.2', 'authenticated') then raise exception 'robot_gate: python/authenticated must queue'; end if;
  if public.robot_gate_applies('node', 'service_role') then raise exception 'robot_gate: service_role must never queue'; end if;
  if public.robot_gate_applies('Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.77.0)', 'service_role') then raise exception 'robot_gate: the agent edge function must never queue'; end if;
  if public.robot_gate_applies('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'anon') then raise exception 'robot_gate: a browser must never queue'; end if;
  if public.robot_gate_applies(null, 'anon') then raise exception 'robot_gate: a missing user-agent must never queue'; end if;
end
$$;

alter role authenticator set pgrst.db_pre_request to 'public.robot_gate';
notify pgrst, 'reload config';
