-- stale_listings_detected: a dormant or retired site is not a gap (♻️ lifecycle, 2026-11-04).
--
-- LIFECYCLE_ENGINEER.md (2026-10-30): a platform_registry row with status 'dormant' is down at its own
-- end, its ads are already out of search, and the liveness alarms skip it (ops_platform_is_dormant()).
-- mark_stale_listings_inactive() still raised its REPORT key for them, so 8 of the 14 open
-- stale_listings_detected alerts on 2026-11-04 were sites nobody can see: sadin (74 + 9), senan 57,
-- snam 32, moftah (12 + 1) — every one of their search_listings_ar rows is production_ready = false —
-- and almuteb, retired by the owner that morning (its 11 rows hidden and adjudicated). An alert a
-- person cannot act on hides the six that matter (sakani, maqrat, haraj, manzo, safa, nowaisiry).
-- Now the key is resolved for a dormant or retired platform and raised exactly as before for every
-- other one. Nothing deactivates, as before; the breaker and coverage gate are untouched. A dormant
-- site that comes back flips to 'active' and its stale rows raise again on the next run.
do $anchor$
declare
  v_def text := pg_get_functiondef('public.mark_stale_listings_inactive(integer, numeric)'::regprocedure);
  a1 text := $a$    if stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_listings_detected'$a$;
  b1 text := $b$    if stale > 0 and not exists (
         select 1 from public.platform_registry pr
          where pr.platform = plat and pr.status in ('dormant', 'retired')) then
      perform public.mon_raise(
        'P2', 'stale_listings_detected'$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or position('''dormant'', ''retired''' in v_def) > 0 then
    raise exception 'mark_stale_listings_inactive is not the body this was written against; nothing changed';
  end if;
  execute replace(v_def, a1, b1);
end
$anchor$;
