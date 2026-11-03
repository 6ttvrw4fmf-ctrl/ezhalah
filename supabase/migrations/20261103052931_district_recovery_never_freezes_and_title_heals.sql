-- DISTRICT RECOVERY NEVER FREEZES A WHOLE SITE, AND A TITLE DISTRICT HEALS ITSELF (backlog 1165, found 2026-11-03).
--
-- 1. refresh_district_recovery_table(): the LOSS GUARD refused the WHOLE refill when > 1 % of last time's recovered
--    districts would go — on a site with 75 of them that is ONE district. Measured 2026-11-03: sirdab_commercial,
--    ashab_residential and ialqarawi_residential had been frozen every hour since 2026-10-30 (1–3 pin districts the
--    refill no longer reproduces), ksaaqar_residential on and off since 10-18, therc_residential since 11-02 20:10 — and
--    while frozen, NO new ad on those sites got a recovered district (4 sirdab ads whose title names «حي الفيحاء» /
--    «حي المطار» sat blank). Now the guard still alerts, still drops nothing (owner 10-18: never drop a district), but
--    it carries the would-be-lost rows into the new set and lets the rest refresh.
-- 2. refresh_title_district(): judged only ads SERVED blank, but an ad served with a title district is not blank — so a
--    title decision that was ever removed could never come back (circular; 9 therc Riyadh ads «… حي طويق, مدينة الرياض»
--    lost theirs to a bulk clean-up and the loss guard above then froze therc). Ads whose recovered district has
--    basis 'title' are now re-judged every run by the same rule.
-- Both patched on the live bodies, anchors checked exactly once, fail closed.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  g_old constant text := $o$, p_table, v_lost, v_elig));
    return 0;
  end if;$o$;
  g_new constant text := $n$, p_table, v_lost, v_elig));
    insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim, basis)
    select o.source_table, o.listing_id, o.district_ar, o.resolved_at, o.verbatim, o.basis
      from public.district_recovery o
      join public.listing_native_location_v1 v1 on v1.source_table = o.source_table and v1.listing_id = o.listing_id
     where o.source_table = p_table and (v1.district_ar is null or btrim(v1.district_ar) = '')
    on conflict (source_table, listing_id) do nothing;
  end if;$n$;
  t_old constant text := 'kept the previous rows (owner 10-18';
  t_new constant text := 'kept those districts and refreshed the rest (owner 10-18';
begin
  if (length(d) - length(replace(d, g_old, ''))) / length(g_old) <> 1
     or (length(d) - length(replace(d, t_old, ''))) / length(t_old) <> 1 then
    raise exception 'refresh_district_recovery_table: loss-guard anchors not found exactly once';
  end if;
  execute replace(replace(d, g_old, g_new), t_old, t_new);
  if position('refreshed the rest' in pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure)) = 0 then
    raise exception 'refresh_district_recovery_table: carry-forward did not land';
  end if;
end
$mig$;

do $mig$
declare
  d text := pg_get_functiondef('public.refresh_title_district()'::regprocedure);
  a_old constant text := '  create temp table _ttl (source_table text, listing_id bigint, txt text) on commit drop;';
  a_new constant text := $n$  -- an ad served with a TITLE-recovered district is re-judged too, so a removed decision heals itself
  insert into _blank
  select s.source_table, s.listing_id, s.city_id, s.city_ar
    from public.district_recovery dr
    join public.search_listings_ar s on s.source_table = dr.source_table and s.listing_id = dr.listing_id
   where dr.basis = 'title' and s.production_ready and s.city_id is not null
     and not exists (select 1 from _blank b where b.source_table = dr.source_table and b.listing_id = dr.listing_id);
  create temp table _ttl (source_table text, listing_id bigint, txt text) on commit drop;$n$;
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then
    raise exception 'refresh_title_district: _ttl anchor not found exactly once';
  end if;
  execute replace(d, a_old, a_new);
end
$mig$;
