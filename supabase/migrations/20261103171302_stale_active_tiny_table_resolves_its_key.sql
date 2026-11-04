-- mon_detect_stale_active_fraction: a table that drops under the 20-row floor must RESOLVE its key, not just skip it.
--
-- The floor says tiny tables are «handled by D1/coverage, not fraction», but the branch was a bare `continue`, so an
-- alert raised while the table was large stayed open forever once it shrank: razre_residential_listings was raised at
-- 112 active / 94 stale (2026-10-26), its crawl now keeps exactly the 18 AVAILABLE units (0 stale, measured 2026-11-03),
-- and the P1 has sat open since its last affirmation on 10-27 with nothing able to close it. A detector that stops
-- evaluating a key must say so by resolving it; it re-raises by itself if the table grows back past the floor.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.mon_detect_stale_active_fraction()'::regprocedure);
  if position($x$if coalesce(active_n,0) < 20 then continue; end if;$x$ in d) = 0 then
    raise exception 'mon_detect_stale_active_fraction: floor line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$if coalesce(active_n,0) < 20 then continue; end if;$x$,
    $x$if coalesce(active_n,0) < 20 then
      perform public.mon_resolve_key('stale_active', 'stale_active:'||rec.tn);  -- out of scope now: close, never strand
      continue;
    end if;$x$);
  execute d;
end
$mig$;