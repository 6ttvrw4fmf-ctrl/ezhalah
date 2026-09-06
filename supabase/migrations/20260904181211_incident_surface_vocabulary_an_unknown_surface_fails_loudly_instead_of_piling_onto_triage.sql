-- THE ROUTING VOCABULARY WAS TOO SMALL TO NAME REAL SURFACES, AND A TYPO WAS INDISTINGUISHABLE FROM
-- A DELIBERATE FALLBACK.
--
-- Found by a 74-agent coverage audit (run wf_01c03538-2c0, 2026-09-04). Three independent judges,
-- reasoning from coverage, ownership and operational cost, all reached the same verdict: the seven
-- routines are the right SEVEN, and every one of the run's 15 confirmed defects landed on a surface
-- an existing routine already owns. What was actually broken was the VOCABULARY -- ~9 real,
-- user-reachable surfaces had no name in incident_route_owner(), so a finding on them fell through
-- to the routine-2 fallback and arrived indistinguishable from noise. Three of that run's own
-- defects (the half-dark share sheet, the stuck account menu, the doubled share URL) landed on a
-- routine whose spec never mentions the component they are in.
--
-- TWO CHANGES, AND THE SECOND MATTERS MORE THAN THE FIRST.
--
-- 1. Ten surfaces gain names. `agent` is deliberately included and deliberately routed to routine #2:
--    ENGINEER_ROUTINES.md gives #2 "AI Agent consistency", so an AI-turn finding belonging to #2 is
--    now an EXPLICIT routing decision rather than an accident of the fallback. Those two things look
--    identical in a queue and mean completely different things.
--
-- 2. An unknown surface now RAISES at incident_open() instead of silently routing to #2. Routing
--    stays total -- a fallback is a real owner, not a bin -- but "I chose #2" and "I typed
--    `resultcard` instead of `result_card`" must not be the same outcome. This is the same
--    silent->NULL-never-unknown->NO discipline the data layer is held to, applied to ownership: an
--    unrecognised surface is UNKNOWN, and unknown must be loud. The error names the whole valid
--    vocabulary so the caller can fix it without reading this file.
create or replace function public.incident_known_surfaces()
returns text[] language sql immutable as $fn$
  select array[
    -- product surfaces
    'advanced_filter','trending','search','matching','normal_filter','pagination','result_card',
    'auth','session','sidebar','chat_persistence','navigation','theme','voice','loading_states','modal',
    -- named 2026-09-04: real, user-reachable, and previously unnameable
    'agent','interview','share','feedback','account_menu','devices','support','browser','intro','mode_switch',
    -- data + pipeline surfaces
    'data_integrity','price','location','listing','scraper','ingestion',
    -- operational surfaces
    'deploy','monitoring','alerting','cron','seam','migration'
  ]
$fn$;

create or replace function public.incident_route_owner(p_surface text)
returns text language sql immutable as $fn$
  select case lower(coalesce(p_surface, ''))
    when 'advanced_filter'   then 'routine-5-af-trending'
    when 'trending'          then 'routine-5-af-trending'
    -- The guided interview IS the Advanced Filter, reached through the agent flow.
    when 'interview'         then 'routine-5-af-trending'
    when 'search'            then 'routine-4-search-qa'
    when 'matching'          then 'routine-4-search-qa'
    when 'normal_filter'     then 'routine-4-search-qa'
    when 'pagination'        then 'routine-4-search-qa'
    when 'result_card'       then 'routine-4-search-qa'
    when 'auth'              then 'routine-6-journey'
    when 'session'           then 'routine-6-journey'
    when 'sidebar'           then 'routine-6-journey'
    when 'chat_persistence'  then 'routine-6-journey'
    when 'navigation'        then 'routine-6-journey'
    when 'theme'             then 'routine-6-journey'
    when 'voice'             then 'routine-6-journey'
    when 'loading_states'    then 'routine-6-journey'
    when 'modal'             then 'routine-6-journey'
    -- Named 2026-09-04. All of these are "everything around a search", which is #6's own words.
    when 'share'             then 'routine-6-journey'
    when 'feedback'          then 'routine-6-journey'
    when 'account_menu'      then 'routine-6-journey'
    when 'devices'           then 'routine-6-journey'
    when 'support'           then 'routine-6-journey'
    when 'browser'           then 'routine-6-journey'
    when 'intro'             then 'routine-6-journey'
    when 'mode_switch'       then 'routine-6-journey'
    -- EXPLICIT, not a fallback: ENGINEER_ROUTINES.md gives #2 "AI Agent consistency". Writing it
    -- down is the whole point -- a deliberate #2 and an accidental #2 must not look the same.
    when 'agent'             then 'routine-2-production'
    when 'data_integrity'    then 'routine-3-data-integrity'
    when 'price'             then 'routine-3-data-integrity'
    when 'location'          then 'routine-3-data-integrity'
    when 'listing'           then 'routine-3-data-integrity'
    when 'scraper'           then 'routine-1-scraping'
    when 'ingestion'         then 'routine-1-scraping'
    when 'deploy'            then 'routine-7-seam'
    when 'monitoring'        then 'routine-7-seam'
    when 'alerting'          then 'routine-7-seam'
    when 'cron'              then 'routine-7-seam'
    when 'seam'              then 'routine-7-seam'
    when 'migration'         then 'routine-7-seam'
    else 'routine-2-production'
  end
$fn$;

-- incident_open() gains one guard and is otherwise unchanged.
create or replace function public.incident_open(
  p_fingerprint text, p_title text, p_surface text, p_severity text,
  p_source text, p_source_ref text default null, p_detail jsonb default '{}'::jsonb
) returns bigint language plpgsql as $fn$
declare
  v_id bigint; v_state text; v_owner text;
begin
  -- UNKNOWN MUST BE LOUD. Routing is still total, but a surface nobody named is a typo or a genuinely
  -- new part of the product -- either way it needs a human decision, not a silent landing on #2.
  if not (lower(coalesce(p_surface, '')) = any (public.incident_known_surfaces())) then
    raise exception 'unknown incident surface %; it would route to the triage fallback and be indistinguishable from a deliberate assignment. Valid surfaces: %',
      coalesce(p_surface, '(null)'), array_to_string(public.incident_known_surfaces(), ', ');
  end if;

  select id, state into v_id, v_state from public.ops_incident where fingerprint = p_fingerprint;

  if v_id is null then
    v_owner := public.incident_route_owner(p_surface);
    insert into public.ops_incident (fingerprint, title, surface, severity, source, source_ref,
                                     detail, owner_routine)
    values (p_fingerprint, p_title, lower(p_surface), p_severity, p_source, p_source_ref,
            coalesce(p_detail, '{}'::jsonb), v_owner)
    returning id into v_id;
    return v_id;
  end if;

  if v_state = 'resolved' then
    update public.ops_incident
       set state = 'open', resolved_at = null, last_progress_at = now(), updated_at = now(),
           last_seen_at = now(), observations = observations + 1,
           severity = public.incident_worst_severity(severity, p_severity),
           detail = detail || jsonb_build_object(
             'regressed_at', now(),
             'regression_note', 'This incident was resolved with barrier ' ||
                                coalesce(barrier_script, '(none recorded)') ||
                                ' and has been observed again -- the barrier did not hold.')
     where id = v_id;
    return v_id;
  end if;

  update public.ops_incident
     set last_seen_at = now(), observations = observations + 1, updated_at = now(),
         detail = detail || coalesce(p_detail, '{}'::jsonb)
   where id = v_id;
  return v_id;
end $fn$;
