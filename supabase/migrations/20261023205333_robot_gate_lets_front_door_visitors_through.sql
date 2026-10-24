-- P1 SPEED (owner 2026-10-23 19:58 UTC, on an iPhone: «it takes so so long to load»): real users were queued as robots.
--
-- robot_gate() (PostgREST db_pre_request) puts every anon/authenticated request whose user-agent is a script
-- («node», undici, curl, python…) into ONE global pool of 2 lanes, waiting up to 6 s for a lane. Since the front door
-- (api/sb.ts, 2026-10-21) every browser request reaches us from Vercel's Node fetch, whose user-agent is «node» and
-- which does not forward the browser's — so every real user went into the 2 robot lanes too. Measured 19:30–21:10 UTC
-- in the API logs: front-door calls (all «node») p50 628 ms / p95 5,228 ms at the origin; pg_stat_statements:
-- robot_gate() 5.1 M calls at a 648 ms mean, i.e. most of that time was users waiting for a robot lane.
--
-- Fix: a visitor the front door vouches for (the secret handshake → guard.front_door_client_ip() is not null) skips
-- the lanes, unless it carries the robot pass (x-ezhalah-robot = 1, which api/sb.ts sets only for OUR robots that
-- present EZ_GATE_SECRET) — those still queue, so post-deploy robots still cannot crowd real users. Direct script
-- callers (no handshake) queue exactly as before. The scrape guard and the network guard above are untouched.
--
-- Needle edit of the live definition (never a full-body replace — a concurrent edit is kept): exactly one occurrence
-- or nothing changes. Apply-time proof, as anon, in this transaction: a vouched browser takes no lane and does not
-- wait; our robot pass and a direct «node» script still queue.
do $mig$
declare
  needle constant text := $n$    if not public.robot_gate_applies(
         current_setting('request.headers', true)::json ->> 'user-agent', current_user::text) then
      return;
    end if;$n$;
  replacement constant text := $r$    -- FRONT DOOR (2026-10-23): browsers reach us through api/sb.ts with user-agent «node». A visitor the front door
    -- vouches for skips the robot lanes unless it carries the robot pass (our own robots: always queue).
    if coalesce(hdr ->> 'x-ezhalah-robot', '') = '1' then
      null;
    elsif visitor is not null or not public.robot_gate_applies(
         current_setting('request.headers', true)::json ->> 'user-agent', current_user::text) then
      return;
    end if;$r$;
  def text := pg_get_functiondef('public.robot_gate()'::regprocedure);
  n int;
begin
  n := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if n <> 1 then
    raise exception 'robot_gate: the lane check was found % times (expected 1) — refusing', n;
  end if;
  execute replace(def, needle, replacement);
end
$mig$;

do $chk$
declare
  sec text;
  t0 timestamptz;
  waited interval;
  lanes int;
  lane_key constant oid := (hashtext('ezhalah:robot_gate')::bigint & 4294967295)::oid;
begin
  select s.secret into sec from guard.front_door_secret s limit 1;
  if sec is null then raise exception 'robot_gate check: no front-door secret to test with'; end if;

  -- 1. a browser through the front door: no lane, no wait.
  perform set_config('request.headers', json_build_object('user-agent', 'node', 'x-ezhalah-gate', sec, 'x-ezhalah-client-ip', '127.0.0.1')::text, true);
  set local role anon;
  t0 := clock_timestamp();
  perform public.robot_gate();
  waited := clock_timestamp() - t0;
  reset role;
  select count(*) into lanes from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = lane_key and objsubid = 2;
  if lanes > 0 or waited > interval '1 second' then
    raise exception 'robot_gate check: a vouched browser still queued (lanes %, waited %)', lanes, waited;
  end if;

  -- 2. our own robot through the front door (robot pass): still queues.
  perform set_config('request.headers', json_build_object('user-agent', 'node', 'x-ezhalah-gate', sec, 'x-ezhalah-client-ip', '127.0.0.1', 'x-ezhalah-robot', '1')::text, true);
  set local role anon;
  t0 := clock_timestamp();
  perform public.robot_gate();
  waited := clock_timestamp() - t0;
  reset role;
  select count(*) into lanes from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = lane_key and objsubid = 2;
  if lanes = 0 and waited < interval '5 seconds' then
    raise exception 'robot_gate check: the robot pass no longer queues';
  end if;

  -- 3. a direct «node» script (no handshake): still queues (this backend already holds a lane from step 2, so it re-enters).
  perform set_config('request.headers', json_build_object('user-agent', 'node')::text, true);
  set local role anon;
  t0 := clock_timestamp();
  perform public.robot_gate();
  waited := clock_timestamp() - t0;
  reset role;
  if (select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = lane_key and objsubid = 2) = 0
     and waited < interval '5 seconds' then
    raise exception 'robot_gate check: a direct node script no longer queues';
  end if;
  perform set_config('request.headers', '', true);
end
$chk$;
