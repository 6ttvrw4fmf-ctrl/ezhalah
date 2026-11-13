-- The map pill's nightly job moves from 22:15 to 22:11 UTC (01:11 Riyadh): 22:15 already starts two jobs, and the hour
-- allows at most two per minute (scripts/verify-cron-slot-discipline.ts). 22:11 is outside every hog window.
select cron.schedule('map-view-facts', '11 22 * * *',
  $$set statement_timeout to '900s'; select public.map_fact_capture_removals(); select public.audit_map_view_facts();$$);
