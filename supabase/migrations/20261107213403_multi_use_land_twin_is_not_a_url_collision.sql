-- 🔧 2026-11-07: an owner-approved multi-use land twin is not a res/com URL collision.
--
-- url_collision_res_vs_com:kellerwilliams has re-raised since 11-05 on 20 ads, each production_ready as
-- Residential Land AND Commercial Land. That is the owner's rule (2026-09-27, «الاستخدام المتعدد» = both
-- tables; docs/ops/FALCON_ENGINEER.md rule 5, docs/ops/FIVE_SOURCES_LAUNCH.md Keller Williams row): measured
-- 11-07, 20 of 20 twins say «متعددة الاستخدام» in their own text and are the land pair. A search is exactly ONE
-- category, so a twin never shows as two cards in one result list. The detector now drops a URL whose only
-- ad is such a twin (same ad_number, Residential Land + Commercial Land, the ad's own words say multi-use).
-- Anything else on that URL, or a twin without the words, still raises.

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_url_collisions_res_vs_com()'::regprocedure);
  if position('multi_use_twin' in src) > 0 then
    raise notice 'twin exemption already present';
    return;
  end if;
  out_def := replace(src,
    E'        select lower(r.listing_url) u, %s ad\n          from public.%I r',
    E'        select lower(r.listing_url) u, %s ad,\n'
    || E'               (r.property_type = ''Residential Land'' and (coalesce(r.title, '''') || '' '' || coalesce(r.description, ''''))\n'
    || E'                 ~ ''متعدد[ةه]? ?الاستخدام|الاستخدام المتعدد'') multi_use_twin\n'
    || E'          from public.%I r');
  out_def := replace(out_def,
    E'        select lower(c.listing_url) u, %s ad\n          from public.%I c',
    E'        select lower(c.listing_url) u, %s ad,\n'
    || E'               (c.property_type = ''Commercial Land'' and (coalesce(c.title, '''') || '' '' || coalesce(c.description, ''''))\n'
    || E'                 ~ ''متعدد[ةه]? ?الاستخدام|الاستخدام المتعدد'') multi_use_twin\n'
    || E'          from public.%I c');
  out_def := replace(out_def,
    E'      ), inter as (\n        select u from res intersect select u from com\n      ), judged as (',
    E'      ), inter as (\n        (select u from res intersect select u from com)\n'
    || E'        except\n'
    || E'        select r.u from res r join com c on c.u = r.u and c.ad = r.ad\n'
    || E'         where r.multi_use_twin and c.multi_use_twin\n'
    || E'           and not exists (select 1 from res r2 where r2.u = r.u and r2.ad <> r.ad)\n'
    || E'           and not exists (select 1 from com c2 where c2.u = r.u and c2.ad <> r.ad)\n'
    || E'      ), judged as (');
  if (length(out_def) - length(replace(out_def, 'multi_use_twin', ''))) / length('multi_use_twin') <> 4 then
    raise exception 'anchors not all found — refusing to guess (found % of 4)',
      (length(out_def) - length(replace(out_def, 'multi_use_twin', ''))) / length('multi_use_twin');
  end if;
  execute out_def;
end $$;

-- PROOF at apply: the 20 multi-use twins no longer raise; a twin WITHOUT the multi-use words still does.
do $$
declare v_ad text;
begin
  perform public.mon_detect_url_collisions_res_vs_com();
  if exists (select 1 from public.alert_event where dedup_key = 'url_collision_res_vs_com:kellerwilliams'
              and resolved_at is null) then
    raise exception 'PROOF: the multi-use twins still raise';
  end if;
  begin
    select c.ad_number into v_ad from public.kellerwilliams_commercial_listings c
      join public.kellerwilliams_residential_listings r on r.ad_number = c.ad_number
     where c.active and r.active limit 1;
    if v_ad is null then raise exception 'PROOF: no twin to plant on'; end if;
    update public.kellerwilliams_commercial_listings set title = 'أرض تجارية', description = 'أرض تجارية'
     where ad_number = v_ad;
    update public.kellerwilliams_residential_listings set title = 'أرض سكنية', description = 'أرض سكنية'
     where ad_number = v_ad;
    perform public.mon_detect_url_collisions_res_vs_com();
    if not exists (select 1 from public.alert_event where dedup_key = 'url_collision_res_vs_com:kellerwilliams'
                    and resolved_at is null) then
      raise exception 'PROOF: one ad in both tables without multi-use words was not caught';
    end if;
    raise exception '__twin_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__twin_selftest_rollback__' then raise; end if;
  end;
end $$;
