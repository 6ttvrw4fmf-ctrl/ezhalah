-- 🔧 2026-11-06 — unverified_inactivation and deduplicated_copy_flood get a real resolver (alerts 13117 / 13137,
-- unresolvable_alert_kind, P2 since 11-04). mon_detect_unverified_inactivation() raised day-keyed alerts and closed
-- them only with a raw 2-day UPDATE, which the resolver audit cannot see as a re-check of the condition (class 521,
-- 🔧 2026-10-13: a per-day key is a detector that can never close yesterday). The same detector now re-checks: the
-- key it raised today is the only live key of its kind, so yesterday's keys resolve at once and today's resolves the
-- first sweep after the 24-h window reads clean — the raw UPDATE is replaced, nothing else in the body moves.
-- Needle edit of the LIVE body (no retyping); raises if the expected text is missing.
do $edit$
declare d text; needle text; patch text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_unverified_inactivation';
  if d is null then raise exception 'mon_detect_unverified_inactivation not found'; end if;
  needle := E'  -- Point-in-time events: auto-resolve after ~2 days, same pattern as mass_inactivation.\n  update public.alert_event set resolved_at = now()\n   where kind in (''unverified_inactivation'', ''deduplicated_copy_flood'') and resolved_at is null\n     and created_at < now() - interval ''2 days'';\n';
  if position(needle in d) = 0 then raise exception 'needle not found in mon_detect_unverified_inactivation — re-read the live body'; end if;
  patch := E'  -- RE-CHECK, THEN CLEAR (🔧 2026-11-06): the key raised this sweep is the only live key of its kind, so an\n  -- older day''s key resolves now and today''s resolves on the first clean sweep after the 24-h window.\n  perform public.mon_resolve_stale_keys(''unverified_inactivation'',\n    case when coalesce(cnt, 0) > 0 then array[''unverified_inactivation:'' || current_date] else ''{}''::text[] end);\n  perform public.mon_resolve_stale_keys(''deduplicated_copy_flood'',\n    case when coalesce(dedup, 0) >= 5 and coalesce(dedup, 0) >= coalesce(cnt, 0) then array[''deduplicated_copy_flood:'' || current_date] else ''{}''::text[] end);\n';
  execute replace(d, needle, patch);
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_unverified_inactivation';
  if position('mon_resolve_stale_keys(''deduplicated_copy_flood''' in d) = 0 then raise exception 'patch did not land'; end if;
end
$edit$;
-- Run it once now so yesterday's keys close in this same step (today's stay while the 24-h window still reads them).
select public.mon_detect_unverified_inactivation();