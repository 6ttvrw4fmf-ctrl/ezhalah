-- P1 follow-up (owner/coordinator decision 2026-10-23): our own test copies queue in the robot lanes too. Real users first.
--
-- After 20261023205333 real users skip the 2 robot lanes, and our front-door robots (robot pass) and «node» scripts
-- still queue. One robot class was never queued: the test copies of the app that CI builds and drives in a headless
-- browser (the required PR check «built app runs», ui-parity, welcome, selector…). They call the database directly
-- with user-agent HeadlessChrome, so the user-agent rule never caught them. Edge logs 20:54–22:10 UTC: 6,567 such calls
-- next to ~500 real-user calls.
--
-- They are recognisable without guessing: scripts/lib/robotPassCore.mjs (grantRobotPass) and gateFetch.mjs add the
-- secret handshake x-ezhalah-gate AND the log marker «ezhalah-gate» in x-client-info to every direct database call of
-- our robots, and the front door is not involved (no vouched visitor). Our own server helpers that also send the
-- handshake (middleware.ts link-preview facts, api/share-card.ts) do not add the marker, so they are unchanged. A
-- caller who fakes the marker only queues itself.
--
-- Needle edit of the live definition (exactly one occurrence or nothing changes). Apply-time proof as anon, ordered so
-- each case is measured before any lane is held: a vouched browser, a link-preview helper and a plain browser take no
-- lane; then a marked test copy queues.
do $mig$
declare
  needle constant text := $n$    if coalesce(hdr ->> 'x-ezhalah-robot', '') = '1' then
      null;$n$;
  replacement constant text := $r$    -- TEST COPIES (2026-10-23): our robots' direct database calls carry the handshake and the «ezhalah-gate» log
    -- marker (scripts/lib/robotPassCore.mjs, gateFetch.mjs) with no vouched visitor — they queue as robots too.
    if coalesce(hdr ->> 'x-ezhalah-robot', '') = '1'
       or (visitor is null and coalesce(hdr ->> 'x-ezhalah-gate', '') <> ''
           and coalesce(hdr ->> 'x-client-info', '') like '%ezhalah-gate%') then
      null;$r$;
  def text := pg_get_functiondef('public.robot_gate()'::regprocedure);
  n int;
begin
  n := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if n <> 1 then
    raise exception 'robot_gate: the robot-pass branch was found % times (expected 1) — refusing', n;
  end if;
  execute replace(def, needle, replacement);
end
$mig$;

do $chk$
declare
  sec text;
  t0 timestamptz;
  waited interval;
  lane_key constant oid := (hashtext('ezhalah:robot_gate')::bigint & 4294967295)::oid;
  held int;
  hdrs json[];
  h json;
begin
  select s.secret into sec from guard.front_door_secret s limit 1;
  if sec is null then raise exception 'robot_gate check: no front-door secret to test with'; end if;

  -- No lane: a vouched browser (front door), our link-preview helper (handshake, no marker), a plain browser.
  hdrs := array[
    json_build_object('user-agent', 'node', 'x-ezhalah-gate', sec, 'x-ezhalah-client-ip', '127.0.0.1', 'x-client-info', 'supabase-js-web/2 ezhalah-front-door robot=0'),
    json_build_object('user-agent', 'Vercel Edge Functions', 'x-ezhalah-gate', sec),
    json_build_object('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', 'x-client-info', 'supabase-js-web/2')
  ];
  foreach h in array hdrs loop
    perform set_config('request.headers', h::text, true);
    set local role anon;
    t0 := clock_timestamp();
    perform public.robot_gate();
    waited := clock_timestamp() - t0;
    reset role;
    select count(*) into held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = lane_key and objsubid = 2;
    if held > 0 or waited > interval '1 second' then
      raise exception 'robot_gate check: a caller that must not queue did (%; lanes %, waited %)', h ->> 'user-agent', held, waited;
    end if;
  end loop;

  -- Queues: a test copy of the app (HeadlessChrome, handshake + marker, no vouched visitor).
  perform set_config('request.headers', json_build_object(
    'user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
    'x-ezhalah-gate', sec, 'x-client-info', 'supabase-js-web/2 ezhalah-gate')::text, true);
  set local role anon;
  t0 := clock_timestamp();
  perform public.robot_gate();
  waited := clock_timestamp() - t0;
  reset role;
  select count(*) into held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = lane_key and objsubid = 2;
  if held = 0 and waited < interval '5 seconds' then
    raise exception 'robot_gate check: a marked test copy does not queue';
  end if;
  perform set_config('request.headers', '', true);
end
$chk$;
