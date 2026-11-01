-- 2026-10-18. Companion of 20261018125140 (ksaaqar `neighborhood` holds only a stated district): the repair's invariant,
-- watched. Once a ksaaqar `neighborhood` is a plus code, or (with no catalog district) anything but a self-named «حي X»,
-- the index carries it to the card and the Filter's district list as if the source stated it — «المملكة العربية
-- السعودية», «عقارات جدة JIJB», «عقارات الدمام 8Q9H+JHH» were live until today. The scraper half (#7511,
-- neighborhood_word) writes only stated districts; a None never overwrites, so a regression in it would show here as
-- new rows, and a stale row as an old one. P1, on the mon_run_all_detectors() roster.
set local lock_timeout = '5s';
create or replace function public.mon_detect_ksaaqar_neighborhood_unstated()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pc constant text := '(^|[^A-Z0-9])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}([^A-Z0-9]|$)';
  hayy constant text := '^حي\s+[ء-ي][ء-ي\s]{1,30}$';
  n int := 0; live text[] := '{}'; v_seen bigint; v_bad bigint; v_top jsonb;
begin
  select count(*) into v_seen
    from (select 1 from public.ksaaqar_residential_listings where active
          union all select 1 from public.ksaaqar_commercial_listings where active) k;
  with bad as (
    select id, neighborhood from public.ksaaqar_residential_listings
     where active and neighborhood is not null and (neighborhood ~ pc or (district_ar is null and neighborhood !~ hayy))
    union all
    select id, neighborhood from public.ksaaqar_commercial_listings
     where active and neighborhood is not null and (neighborhood ~ pc or (district_ar is null and neighborhood !~ hayy)))
  select count(*), (select jsonb_agg(jsonb_build_object('id', b.id, 'neighborhood', left(b.neighborhood, 60)))
                      from (select * from bad order by id desc limit 10) b)
    into v_bad, v_top from bad;

  if v_seen = 0 then
    live := live || 'ksaaqar_neighborhood_unstated:BLIND'::text;
    n := n + public.mon_raise('P2', 'ksaaqar_neighborhood_unstated', 'ksaaqar', 'ksaaqar_neighborhood_unstated:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active ksaaqar row, so this detector cannot see a stored non-district.'));
  elsif v_bad > 0 then
    live := live || 'ksaaqar_neighborhood_unstated:stored'::text;
    n := n + public.mon_raise('P1', 'ksaaqar_neighborhood_unstated', 'ksaaqar', 'ksaaqar_neighborhood_unstated:stored',
      jsonb_build_object('rows', v_bad, 'sample', v_top,
        'why', 'ksaaqar neighborhood is carried to the card and the Filter district list as the source''s district word when the catalog has no match. It must be the «الموقع:» field''s «حي X», a catalog-recognised map line, or a self-named «حي X» — never the map line''s title/category/country text or a plus code.',
        'action', 'Check scrapers/ksaaqar/run.py neighborhood_word() (#7511); clear the rows as 20261018125140 did.'));
  end if;
  perform public.mon_resolve_stale_keys('ksaaqar_neighborhood_unstated', live);
  return n;
end
$function$;

revoke execute on function public.mon_detect_ksaaqar_neighborhood_unstated() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_ksaaqar_neighborhood_unstated' in src) > 0 then
    raise notice 'mon_detect_ksaaqar_neighborhood_unstated already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_sanadak_unticked_box_as_no'',',
    E'    ''mon_detect_sanadak_unticked_box_as_no'',\n    ''mon_detect_ksaaqar_neighborhood_unstated'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- PROOF at apply: 0 live after the repair; a planted stored non-district is caught (0 -> 1), then rolled back.
do $$
declare v_id bigint; v_hit int;
begin
  if public.mon_detect_ksaaqar_neighborhood_unstated() <> 0 then
    raise exception 'PROOF: the detector fires on the repaired table';
  end if;
  select id into v_id from public.ksaaqar_residential_listings where active and district_ar is null order by id limit 1;
  begin
    update public.ksaaqar_residential_listings set neighborhood = 'عقارات الدمام 8Q9H+JHH' where id = v_id;
    perform public.mon_detect_ksaaqar_neighborhood_unstated();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'ksaaqar_neighborhood_unstated:stored' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted plus code was not caught'; end if;
    raise exception '__ks_detector_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__ks_detector_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_ksaaqar_neighborhood_unstated' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
