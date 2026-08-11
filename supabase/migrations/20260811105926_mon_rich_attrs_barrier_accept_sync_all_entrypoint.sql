-- Check D asserted that cron jobid 28 calls sync_listing_rich_attrs by name. The hourly job now
-- calls the fleet-wide entry point sync_all_rich_attrs() instead, so the check fired on correct
-- wiring — a false positive, and my own bug.
--
-- Widened to accept either entry point. Deliberately NOT loosened to "any call at all": the point of
-- check D is that removing the plumbing must break the monitor loudly rather than leave A-C quietly
-- passing over rotting data.
do $$
declare def text;
begin
  select pg_get_functiondef('public.mon_rich_attrs_barrier()'::regprocedure) into def;

  if position(E'if cmd is null or cmd not like ''%sync_listing_rich_attrs%'' then' in def) = 0 then
    raise exception 'check D anchor not found - barrier body changed, refusing to guess';
  end if;
  def := replace(def,
    E'if cmd is null or cmd not like ''%sync_listing_rich_attrs%'' then',
    E'if cmd is null or (cmd not like ''%sync_listing_rich_attrs%'' and cmd not like ''%sync_all_rich_attrs%'') then');

  if position(E'and command like ''%wasalt%''' in def) = 0 then
    raise exception 'wasalt check anchor not found - refusing to guess';
  end if;

  execute def;
end $$;

-- the alerts raised while the check was wrong are noise; retract them so the roster is not
-- permanently red over a monitor defect rather than a data defect
delete from public.location_pipeline_alerts
 where alert_type in ('rich_attrs_sync_unwired', 'rich_attrs_platform_unmapped');
