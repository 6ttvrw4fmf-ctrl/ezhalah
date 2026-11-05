-- ♻️ 2026-11-05: lifecycle_duplicate_stale_copy skips dormant sites, like every other liveness alarm.
-- A site with platform_registry.status = 'dormant' is down at its own end and none of its rows is
-- served (ops_platform_is_dormant(), guard verify-liveness-alarms-skip-dormant-sites.ts). The alert's
-- premise («the other copy is active and still returned by search») is false for it, so
-- lifecycle_duplicate_stale_copy:sadin stood open from 2026-09-06 with no event that could close it.
-- The loop now skips dormant platforms and mon_resolve_stale_keys() closes their key on the next sweep;
-- the site comes back into the alert by itself the day it is no longer dormant. Needle edit of one
-- anchor, asserted to match exactly once, md5-guarded against the live definition.
do $anchor$
declare
  v_def text := pg_get_functiondef('public.mon_detect_lifecycle_duplicate_stale_copy()'::regprocedure);
  a1 text := $a$      from public.ops_lifecycle_duplicate_stale_copy() d
     group by 1$a$;
  b1 text := $b$      from public.ops_lifecycle_duplicate_stale_copy() d
     where not public.ops_platform_is_dormant(d.platform)
     group by 1$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or md5(v_def) <> '4609c04b4547b707c1ada4fc9dedf689' then
    raise exception 'mon_detect_lifecycle_duplicate_stale_copy is not the body this was written against; nothing changed';
  end if;
  execute replace(v_def, a1, b1);
end
$anchor$;