-- THE TRENDING «UNREACHABLE BY DISTRICT» COUNT ASKS THE ONE LIST-GAP ORACLE (alert trending_district #2434, 2026-11-04).
--
-- mon_trending_district_barrier()'s first check counted every served ad whose district token is absent from
-- loc_canonical_district in its OWN city — 968 ads on 2026-11-03, open since 2026-09-11 and never clearable. It could
-- not tell two cases apart that public.served_district_not_offered() (the oracle mon_detect_served_district_not_offered
-- raises the P1 from) already separates:
--   • a word the LIST deliberately refuses (refresh_loc_canonical_district()'s `liv` arm: placeholder, bogus shape,
--     digits, a rewritten recovery) — 794 + 140 + 9 = 943 ads that day, an owner rule working, not a gap;
--   • a district offered under a clustered sibling city (loc_city_cluster), which IS reachable.
-- Measured the same day: list_rule IS NULL (a real gap) = 0 ads. So the check now counts exactly that, from the same
-- function, so the two detectors can never disagree again. A real gap still fires here AND as the P1.
-- Live body patched, anchors checked exactly once, fail closed.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_trending_district_barrier()'::regprocedure);
  a_start constant text := $a$  return query
  with live as ($a$;
  a_end constant text := $a$  having coalesce(sum(l.n) filter (where c.city_id is null), 0) > 0;$a$;
  repl constant text := $r$  -- Real gaps only: the list's own refusals (list_rule) and clustered-city offers are excluded by the one
  -- oracle the P1 served_district_not_offered uses (20261104 trending fix).
  return query
  select 'unreachable_listings_no_catalog_district'::text,
         'listings whose district the Filter list does not offer and no list rule refuses — unfindable by district'::text,
         sum(w.ads)::bigint
    from public.served_district_not_offered() w
   where w.list_rule is null
  having coalesce(sum(w.ads), 0) > 0;$r$;
  i int; j int;
begin
  if (length(d) - length(replace(d, a_start, ''))) / length(a_start) <> 1
     or (length(d) - length(replace(d, a_end, ''))) / length(a_end) <> 1 then
    raise exception 'mon_trending_district_barrier: anchors not found exactly once';
  end if;
  i := position(a_start in d);
  j := position(a_end in d) + length(a_end);
  if j <= i then raise exception 'mon_trending_district_barrier: anchors out of order'; end if;
  execute substr(d, 1, i - 1) || repl || substr(d, j);
  if position('from public.served_district_not_offered() w' in pg_get_functiondef('public.mon_trending_district_barrier()'::regprocedure)) = 0 then
    raise exception 'mon_trending_district_barrier: patch did not land';
  end if;
end
$mig$;
