-- stale_breaker_escape alerts could never close (unresolvable_alert_kind:stale_breaker_escape, open
-- since 2026-08-21; 8 open, 5 last affirmed in September/October). mark_stale_listings_inactive()
-- (cron stale-listings-mark, 04:00 UTC) raises stale_breaker_escape:<table> when a table has tripped
-- the stale breaker for escape_after_days in a row on a live platform, and resets
-- consecutive_breaker_days to 0 on the first run the breaker does NOT trip — but left the alert open,
-- so a table that recovered stayed lit forever. The reset branch now also resolves that table's key:
-- same evaluation, same table, the condition the alert names is no longer true. Nothing about which
-- rows are deactivated changes (this adds a resolve only). Needle edit: exactly one match asserted.
do $mig$
declare
  v_def text := pg_get_functiondef('public.mark_stale_listings_inactive(integer,numeric)'::regprocedure);
  v_needle constant text := E'    update public.mon_stale_breaker_state\n       set consecutive_breaker_days = 0, updated_at = now()\n     where tbl = t and consecutive_breaker_days <> 0;';
  v_new constant text := v_needle || E'\n    -- 2026-11-02: the breaker did not trip for this table on this run, so its escape alert is no longer true.\n    perform public.mon_resolve_key(''stale_breaker_escape'', ''stale_breaker_escape:'' || t);';
  v_hits int := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
begin
  if v_hits <> 1 then
    raise exception 'expected 1 match for the breaker reset in mark_stale_listings_inactive, found %', v_hits;
  end if;
  execute replace(v_def, v_needle, v_new);
  if position('mon_resolve_key(''stale_breaker_escape''' in pg_get_functiondef('public.mark_stale_listings_inactive(integer,numeric)'::regprocedure)) = 0 then
    raise exception 'resolve missing after rewrite';
  end if;
end
$mig$;