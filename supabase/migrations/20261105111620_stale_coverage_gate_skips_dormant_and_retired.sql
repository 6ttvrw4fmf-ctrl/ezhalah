-- ♻️ 2026-11-05 (backlog 1329): stale_coverage_gate skips dormant and retired sites, like its sister key.
-- 20261104112551 taught stale_listings_detected to skip a site whose platform_registry.status is
-- 'dormant' or 'retired' (its ads are out of search, it is down at its own end, and its rows can never
-- be re-seen until it returns). The coverage gate in the same function kept raising for them: sadin,
-- senan and snam (all dormant) opened stale_coverage_gate at 2026-11-04 05:15 and were re-affirmed
-- every run since, with no event that could close them. Now the raise skips those sites and the
-- existing else-branch resolves their keys on the next run. Needle edit of one anchor, asserted to
-- match exactly once. Deactivation behaviour is unchanged: this function still deactivates nothing.
do $anchor$
declare
  v_def text := pg_get_functiondef('public.mark_stale_listings_inactive(integer, numeric)'::regprocedure);
  a1 text := $a$    if cov_gated and stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_coverage_gate'$a$;
  b1 text := $b$    if cov_gated and stale > 0 and not exists (
         select 1 from public.platform_registry pr
          where pr.platform = plat and pr.status in ('dormant', 'retired')) then
      perform public.mon_raise(
        'P2', 'stale_coverage_gate'$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or md5(v_def) <> '8fa91fe42b3c1efd3bbf31c38fa98c87' then
    raise exception 'mark_stale_listings_inactive is not the body this was written against; nothing changed';
  end if;
  execute replace(v_def, a1, b1);
end
$anchor$;