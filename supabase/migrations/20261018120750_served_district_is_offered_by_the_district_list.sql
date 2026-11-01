-- 2026-10-18. A DISTRICT A CARD SHOWS IS A DISTRICT THE FILTER OFFERS (owner: every served district is searchable
-- via Filter and AF; the district list must list every district of the city, 2026-10-03).
--
-- THE DEFECT. The Filter district list is district_options_ar(), which offers exactly loc_canonical_district for the
-- picked city (and its cluster). refresh_loc_canonical_district() already adds every served production_ready word
-- (source 'live' — that is how «ديراب» got in), but it runs only inside district-recovery-pipeline at :10, while
-- sync-search-listings-ar publishes new districts at :22. So each district a sync carries in is on the cards and in
-- search but cannot be picked for ~48 minutes of every hour, and for good if the pipeline stops. Found live on
-- 2026-10-18: المدينة المنورة, typed «العنبرية» → «لا توجد أحياء مطابقة» while 41 rakez cards say «العنبرية».
-- Measured 11:55 UTC, production_ready rows whose (city, district) the list does not offer: 197 pairs / 932 ads —
--   48 pairs / 119 ads the list rule accepts (only waiting for the next :10 rebuild; rakez «العنبرية» ×41 among them);
--   148 pairs / 807 ads carry a word the list rule refuses (district_ar_looks_bogus: «مخطط …», «حكومي», «شارع …»,
--   3+ digit codes) and 1 pair / 6 ads a surviving digit. Those stay refused here: offering them is an owner decision.
--
-- THE FIX. Rebuild the list again right after the sync, at :33 (contract floor 9 min = the sync's measured max
-- runtime of 8.1 min, the same floor contract 1 uses). No function is redefined: refresh_loc_canonical_district() and
-- district_options_ar() stay exactly as their owners left them. The rebuild TRUNCATEs, so it runs with lock_timeout
-- 5s: if a long reader holds the table it gives up instead of queueing every customer's district list behind its
-- ACCESS EXCLUSIVE request (the :59 detector sweep holds the table up to 15 min — 10:59 today ran 900 s, and the :10
-- pipeline's own rebuild then waited: 292 s against a usual 60 s). A skipped :33 is caught by the :10 rebuild and by
-- the detector below.
--
-- THE GUARD. served_district_not_offered() lists every served (city, district) the list does not offer, with the list
-- rule that refuses it (null = nothing refuses it = a bug). mon_detect_served_district_not_offered() raises P1 when
-- any such row exists, daily at 04:36, three minutes after the :33 rebuild. The ordering is a row in
-- ops_cron_ordering_contract, so mon_detect_cron_ordering_contract reports anyone who moves the rebuild into the
-- sync's runtime or drops it.
set local statement_timeout = '300s';
set local lock_timeout = '5s';

create or replace function public.served_district_not_offered()
returns table(platform text, city_id integer, city_ar text, district_ar text, ads bigint, list_rule text)
language sql stable security definer set search_path to 'public'
as $$
  with clus as (
    select c1.city_id, m.city_id as member
      from public.loc_city_cluster c1 join public.loc_city_cluster m on m.cluster_key = c1.cluster_key
  ), miss as (
    select s.platform, s.city_id, s.city_ar, s.district_ar,
           -- the reasons the LIST refuses a served word: the `liv` arm of refresh_loc_canonical_district(), verbatim
           case
             when s.district_ar in ('غير محدد','اخرى','أخرى') then 'placeholder'
             when public.district_ar_looks_bogus(s.district_ar) then 'bogus_shape'
             when s.district_ar ~ '[0-9٠-٩]' and s.district_ar !~ '^[^0-9٠-٩]+\s[0-9٠-٩]+$' then 'digit'
             when exists (select 1 from public.district_recovery dr
                           where dr.source_table = s.source_table and dr.listing_id = s.listing_id
                             and dr.verbatim is false) then 'rewritten_recovery'
           end as list_rule
      from public.search_listings_ar s
     where s.production_ready and s.city_id is not null and btrim(coalesce(s.district_ar, '')) <> ''
       and not exists (select 1 from public.loc_canonical_district c
                        where c.city_id = s.city_id and c.district_norm = s.district_norm_tok)
       and not exists (select 1 from clus join public.loc_canonical_district c on c.city_id = clus.member
                        where clus.city_id = s.city_id and c.district_norm = s.district_norm_tok)
  )
  select platform, city_id, city_ar, district_ar, count(*) as ads, list_rule
    from miss group by platform, city_id, city_ar, district_ar, list_rule;
$$;

create or replace function public.mon_detect_served_district_not_offered()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n_pairs int; n_ads bigint; v_top jsonb; v_refused jsonb; v_open text; r int := 0;
begin
  with w as (select * from public.served_district_not_offered())
  select count(*) filter (where list_rule is null),
         coalesce(sum(ads) filter (where list_rule is null), 0),
         (select jsonb_agg(jsonb_build_object('platform', t.platform, 'city', t.city_ar, 'district', t.district_ar, 'ads', t.ads))
            from (select * from w where list_rule is null order by ads desc limit 25) t),
         (select jsonb_object_agg(t.list_rule, t.n) from (select list_rule, sum(ads) n from w where list_rule is not null group by 1) t)
    into n_pairs, n_ads, v_top, v_refused
    from w;
  select severity into v_open from public.alert_event
   where dedup_key = 'served_district_not_offered' and resolved_at is null order by created_at desc limit 1;
  if n_ads = 0 then
    if v_open is not null then perform public.mon_resolve('served_district_not_offered', 'district_catalog'); end if;
  elsif v_open is null then
    r := public.mon_raise('P1', 'served_district_not_offered', 'district_catalog', 'served_district_not_offered',
      jsonb_build_object('pairs', n_pairs, 'ads', n_ads, 'top', v_top, 'refused_by_list_rule_ads', v_refused,
        'why', 'A card shows this district but the Filter district list (district_options_ar ← loc_canonical_district) does not offer it, so the customer cannot pick it. Check that refresh-district-list-after-sync ran after the sync and that refresh_loc_canonical_district() still adds every served word (source live).'));
  end if;
  return r;
end $function$;

select cron.schedule('refresh-district-list-after-sync', '33 * * * *',
  $c$set statement_timeout to '300s'; set lock_timeout to '5s'; select public.refresh_loc_canonical_district();$c$);
select cron.schedule('mon-served-district-not-offered', '36 4 * * *',
  $c$set statement_timeout to '120s'; select public.mon_detect_served_district_not_offered();$c$);

insert into public.ops_cron_ordering_contract (upstream_job, downstream_job, min_gap_minutes, why)
select 'sync-search-listings-ar', 'refresh-district-list-after-sync', 9,
       'refresh_loc_canonical_district() adds every district word the sync served (source live) to the Filter district list. Run before the sync finishes, it misses the words that sync carried in and the customer cannot pick a district the cards show until the next rebuild (2026-10-18: «العنبرية», المدينة المنورة, 41 ads). Floor 9 min = the sync''s measured max runtime 8.1 min, as in contract 1.'
 where not exists (select 1 from public.ops_cron_ordering_contract
                    where upstream_job = 'sync-search-listings-ar' and downstream_job = 'refresh-district-list-after-sync');

-- SELF-TEST (mutation proof, runs at apply): take one served district out of the list and the work list names it as a
-- bug (no list rule refuses it); the mutation is rolled back. No rebuild here: the first :33 run is the live proof.
do $$
declare v_city int; v_tok text;
begin
  select c.city_id, c.district_norm into v_city, v_tok
    from public.loc_canonical_district c
   where c.source = 'live'
     and not exists (select 1 from public.loc_city_cluster k where k.city_id = c.city_id)
     and exists (select 1 from public.search_listings_ar s
                  where s.production_ready and s.city_id = c.city_id and s.district_norm_tok = c.district_norm)
   order by c.city_id, c.district_norm limit 1;
  if v_city is null then raise exception 'self-test: no served live district to mutate'; end if;
  begin
    delete from public.loc_canonical_district where city_id = v_city and district_norm = v_tok;
    if not exists (select 1 from public.served_district_not_offered() w
                    where w.city_id = v_city and public.norm_district_tok(w.district_ar) = v_tok and w.list_rule is null) then
      raise exception 'self-test: a served district missing from the list must be reported';
    end if;
    raise exception '__served_district_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__served_district_selftest_rollback__' then raise; end if;
  end;
  if not exists (select 1 from public.loc_canonical_district where city_id = v_city and district_norm = v_tok) then
    raise exception 'self-test: the mutation was not rolled back';
  end if;
end $$;
