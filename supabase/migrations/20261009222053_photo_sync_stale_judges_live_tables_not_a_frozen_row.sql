-- photo_sync_stale JUDGES THE CHAIN BY THE TABLES IT REFRESHES, NEVER BY A FROZEN ROW (falcon, 2026-10-09).
--
-- THE STATE FOUND. alert_event photo_sync_stale (P2) has been open since 2026-09-26 and re-affirmed on
-- every sweep, owned by a deleted routine, saying "ops_photo_capture_trust has not refreshed in 36h+".
-- Measured 2026-10-09 22:20 UTC: 245 of 246 rows were refreshed at 21:22 today by jobid 28, exactly as
-- designed. The one other row is expattrusted_commercial_listings, checked_at 2026-09-24 19:22, 3
-- reachable rows then, 0 rows in search_listings_ar now. refresh_photo_capture_trust() iterates
-- `select distinct source_table from search_listings_ar`, so a table that LEFT the index keeps its last
-- row forever, and this detector's `min(checked_at)` over the whole table read that frozen row as "the
-- jobid 28 chain stopped". It had not stopped once. A detector that cannot tell a dormant platform from
-- a dead chain is a standing P2 nobody reads, which is how a real stall would hide (AGENTS.md: a
-- checker's silence must be an alarm; this one was an alarm nobody could act on).
--
-- THE REPAIR. Staleness is measured over the SAME universe the refresh writes: tables that currently
-- hold rows in search_listings_ar. A frozen row for a table outside that set says nothing about the
-- chain and is ignored. trusted_ct is scoped the same way so the two numbers describe one population.
-- A real stall still fires: if jobid 28 stops, every live table's checked_at ages past 36h together.
create or replace function public.mon_detect_photo_sync_stale()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare stalest timestamptz; trusted_ct bigint; n int := 0;
begin
  -- the refresh's own universe: tables that hold rows in the served index right now
  select min(t.checked_at) into stalest
    from public.ops_photo_capture_trust t
   where exists (select 1 from public.search_listings_ar s where s.source_table = t.source_table);
  select count(*) into trusted_ct
    from public.ops_photo_capture_trust t
   where t.trusted
     and exists (select 1 from public.search_listings_ar s where s.source_table = t.source_table);
  if trusted_ct > 0 and (stalest is null or stalest < now() - interval '36 hours') then
    n := public.mon_raise('P2', 'photo_sync_stale', 'all', 'photo_sync_stale',
      jsonb_build_object('stalest', stalest, 'trusted_platforms', trusted_ct,
        'why', 'ops_photo_capture_trust has not refreshed in 36h+ for a table that is in the served index '
               || 'while trusted platforms exist - jobid 28 chain may have stopped calling '
               || 'refresh_photo_capture_trust()/sync_all_listing_photos().'));
  else
    perform public.mon_resolve_key('photo_sync_stale', 'photo_sync_stale');
  end if;
  return n;
end
$function$;

-- Post-check: the frozen row is exactly the case this fixes, and it must now be invisible to the detector.
do $$
declare frozen int; stale_live int;
begin
  select count(*) into frozen from public.ops_photo_capture_trust t
   where not exists (select 1 from public.search_listings_ar s where s.source_table = t.source_table);
  select count(*) into stale_live from public.ops_photo_capture_trust t
   where t.checked_at < now() - interval '36 hours'
     and exists (select 1 from public.search_listings_ar s where s.source_table = t.source_table);
  raise notice 'photo_sync_stale repair: frozen rows outside the index = %, live tables stale > 36h = %', frozen, stale_live;
  if stale_live > 0 then
    raise exception 'a LIVE table is stale: the chain really is stalled, do not ship this as a false-alarm fix';
  end if;
end $$;