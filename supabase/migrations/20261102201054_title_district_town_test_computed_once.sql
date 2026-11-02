-- refresh_title_district: the town-name test ran district_is_other_town() on every served ad (≈ 400k calls, each
-- normalising text twice) and the 20:05 run took over 3 minutes. Same rule, computed once: the town names of the
-- catalogue go into an indexed temp table and the index's own district_norm_tok (= norm_district_tok(district_ar),
-- checked equal on 20,000 rows) is compared to them. Patched on the live body.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_title_district()'::regprocedure);
  a_old constant text := $o$  create temp table _blank on commit drop as$o$;
  a_new constant text := $n$  create temp table _town on commit drop as
  select c.city_id, c.region_id, norm_district_tok('حي ' || c.city_ar) as dn
    from public.loc_catalog_city c where c.retired_at is null;
  create index on _town (dn);
  create temp table _blank on commit drop as$n$;
  b_old constant text := $o$          or public.district_is_other_town(s.city_id, s.district_ar));$o$;
  b_new constant text := $n$          or (exists (select 1 from _town tn
                       where tn.dn = s.district_norm_tok and tn.region_id = s.region_id and tn.city_id <> s.city_id)
              and not exists (select 1 from public.loc_catalog_district d0
                               where d0.city_id = s.city_id and d0.retired_at is null
                                 and d0.district_norm = s.district_norm_tok)));$n$;
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'refresh_title_district: fast-town anchors not found exactly once';
  end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end
$mig$;
