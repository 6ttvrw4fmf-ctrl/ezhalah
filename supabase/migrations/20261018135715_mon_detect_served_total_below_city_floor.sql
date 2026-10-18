-- APPLIED 2026-10-18 (owner session). P1 price accuracy (owner: «we can get sued»): a served SALE plot priced under its
-- city's own floor is OUR claim until a page read says the source shows that number.
--
-- THE GAP: rate_served_as_total reads a stated total in the listing's own text, so it is blind wherever the text says
-- nothing (wasalt 5813546 sat at «6,500» for 467 m² in حي النرجس while it read 0). Fleet-wide, 473 production_ready sale
-- plots of 200–5,000 m² were served under 2% of their city's median SAR/m² (wasalt 108, aqar 97, abwbna 61, dealapp 36,
-- alshawaf 26, sadiqeltajer 23, abralosol 22, haraj 19, mustqr 15, ksaaqar 14, …). Rendered pages, 2026-10-18:
--   (a) OUR bug — the page shows a per-m² rate or another number, we stored it as the total:
--       wasalt 67/108 (description total = price × area; 20261018135052 + trg_wrm_rate_is_not_the_total fix them as the
--       Arabic page is read), sadiqeltajer 5562 «550 ريال» + «الحد ( 550 ريال للمتر )», mustqr 4993 «السوم للمتر 1100»,
--       haraj 11189120675 «سعر الوحدة: 750» + title «المتر 1100», ksaaqar «جوهرة العروس» stored 230 = the VIEW COUNTER
--       («مشاهدات: 230»; the ad says «٣٢٠الف»), aqar 6924630 «سعر المتر 1 ريال» × area = our ≈ total.
--   (b) the SOURCE shows that small number as the price — PRICE = SOURCE, kept, but never silent:
--       wasalt 39/108 (22 show only the headline, e.g. 5948262 «6,200» «8 /متر مربع»; 17 state it again, e.g. عرعر
--       5907541 «سعرها 660 ر.س»), abwbna 53393 «1,600 سعر البيع», dealapp 584148 «480» «سعر المتر 1.19», 597858 «300»
--       «0.31», mustqr 4960 «السعر: 450 ريال».
--
-- THE RULE. Floor = 2% of the median served SAR/m² of the city's own priced sale plots (200–5,000 m²), only for cities
-- with ≥ 100 of them — a small place has no floor, rural land can be that cheap. Riyadh's floor is ≈ 62, Jeddah 38,
-- Buraydah 10, Hail 9; a rate typed as a total lands at 1–25. Below the floor:
--   · a row with a page read in ops_price_source_verified (the existing adjudication table) is case (b) → the owner list
--     view owner_price_source_shows_small_total (+ one P3 so it is never silent; the number is never changed);
--   · every other row is OUR unverified claim → P1 'served_total_below_city_floor' → 🔧 repair (ops_engineer_for_alert
--     default). Resolution is a page read: (a) fix the extractor + re-scrape, or (b) record the read. Never hide a price.
create or replace function public.served_total_below_city_floor_rows()
returns table (platform text, source_table text, listing_id bigint, city_ar text, served_total bigint, area_m2 integer,
               served_ppm numeric, city_floor_ppm numeric, derived_from_rate boolean, source_shows_it boolean)
language sql stable security definer set search_path to 'public'
as $$
  with land as (
    select s.platform, s.source_table, s.listing_id, s.city_id, s.city_ar, s.price_total_effective, s.price_total, s.area_m2,
           s.price_total_effective::numeric / s.area_m2 as ppm
      from public.search_listings_ar s
     where s.production_ready and s.deal_ar = 'بيع' and s.type_ar ~ 'أرض'
       and s.area_m2 between 200 and 5000 and s.price_total_effective > 0),
  city_floor as (
    select city_id, 0.02 * percentile_cont(0.5) within group (order by ppm) as floor_ppm
      from land group by city_id having count(*) >= 100)
  select l.platform, l.source_table, l.listing_id, l.city_ar, l.price_total_effective, l.area_m2,
         round(l.ppm, 2), round(f.floor_ppm::numeric, 2), l.price_total is null,
         exists (select 1 from public.ops_price_source_verified v
                  where v.source_table = l.source_table and v.listing_id = l.listing_id)
    from land l join city_floor f using (city_id)
   where l.ppm < f.floor_ppm
$$;

create or replace view public.owner_price_source_shows_small_total as
select r.platform, r.source_table, r.listing_id, r.city_ar, r.served_total, r.area_m2, r.served_ppm, r.city_floor_ppm,
       v.evidence, v.verified_at
  from public.served_total_below_city_floor_rows() r
  join public.ops_price_source_verified v on v.source_table = r.source_table and v.listing_id = r.listing_id;
comment on view public.owner_price_source_shows_small_total is
  'OWNER LIST (2026-10-18): served sale plots priced under 2% of their city''s median SAR/m² whose rendered page shows that '
  'same number as the price (PRICE = SOURCE — kept, never changed). Evidence = the page read. P3 source_shows_small_total.';

create or replace function public.mon_detect_served_total_below_city_floor()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_owner bigint; v_by jsonb; v_ex jsonb; r int := 0;
begin
  with x as (select * from public.served_total_below_city_floor_rows())
  select count(*) filter (where not x.source_shows_it), count(*) filter (where x.source_shows_it),
         coalesce((select jsonb_agg(jsonb_build_object('platform', z.platform, 'rows', z.n, 'derived_from_rate', z.d) order by z.n desc)
                     from (select y.platform, count(*) n, count(*) filter (where y.derived_from_rate) d
                             from x y where not y.source_shows_it group by y.platform) z), '[]'::jsonb),
         (select jsonb_agg(to_jsonb(e)) from (select y.platform, y.source_table, y.listing_id, y.city_ar, y.served_total,
                                                     y.area_m2, y.served_ppm, y.city_floor_ppm
                                                from x y where not y.source_shows_it order by y.served_ppm limit 12) e)
    into v_rows, v_owner, v_by, v_ex from x;

  if v_rows = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'served_total_below_city_floor' and resolved_at is null) then
      perform public.mon_resolve('served_total_below_city_floor', 'price_fidelity');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'served_total_below_city_floor' and resolved_at is null) then
    r := r + public.mon_raise('P1', 'served_total_below_city_floor', 'price_fidelity', 'served_total_below_city_floor',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by, 'examples', v_ex, 'for', '🔧',
        'owner_list_rows', v_owner,
        'why', 'We serve a sale plot under 2% of its city''s median SAR/m² and no page read backs it — OUR claim (owner 10-18, «we can get sued»). Open the ad: (a) the page shows a per-m² rate, a placeholder, a view count or another number and we stored it as the total → fix the extractor and re-scrape (wasalt: wasalt_description_total + trg_wrm_rate_is_not_the_total; others: the per-site scraper); (b) the page itself shows that small number as the price → PRICE = SOURCE: keep it and record the read in ops_price_source_verified (it moves to owner_price_source_shows_small_total). Never hide or «fix» a price by plausibility.'));
  end if;

  if v_owner = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'source_shows_small_total' and resolved_at is null) then
      perform public.mon_resolve('source_shows_small_total', 'price_fidelity');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'source_shows_small_total' and resolved_at is null) then
    r := r + public.mon_raise('P3', 'source_shows_small_total', 'price_fidelity', 'source_shows_small_total',
      jsonb_build_object('rows', v_owner, 'for', '👑 owner list', 'list', 'select * from owner_price_source_shows_small_total',
        'why', 'Sale plots whose own page shows a price under 2% of the city''s median SAR/m². Shown exactly as the source shows them (PRICE = SOURCE); listed so it never passes silently.'));
  end if;
  return r;
end $function$;

-- Roster (an unrostered detector is decoration).
do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_served_total_below_city_floor''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_served_total_below_city_floor'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_served_total_below_city_floor''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- OWNER LIST SEED — the case-(b) page reads of 2026-10-18 (rendered pages; the number is never changed).
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'wasalt_residential_listings', v.id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 13:40–13:55 UTC from https://wasalt.sa/en/property/land-%s and its /ar page: salePrice = %s = the stored price; %s. The source shows this number as the price — kept (PRICE = SOURCE), owner list.',
              v.ad, v.sp, case v.k when 'd' then format('its own description states the same total («Price: %s SAR» / «سعرها %s ر.س»)', v.sp, v.sp)
                                   else format('neither description states a total; wasalt shows its own «%s /متر مربع» under it', v.avg) end),
       now()
  from (values (453006,5847956,'1100',2,'p'),(459722,5847954,'1150',2,'p'),(449185,5847967,'1750',2,'p'),(16531802,5948613,'11200',14,'p'),
               (16531800,5948625,'7500',9,'p'),(16531801,5948621,'5000',6,'p'),(15179996,5932431,'7500',19,'p'),(15179993,5932451,'7500',16,'p'),
               (16532199,5948367,'9100',11,'p'),(16532208,5948324,'6700',8,'p'),(16532377,5948280,'10500',13,'p'),(16532382,5948262,'6200',8,'p'),
               (16532207,5948330,'2500',1,'p'),(15921265,5943071,'370',1,'d'),(15179995,5932441,'11952',23,'p'),(16234339,5945100,'4999',19,'d'),
               (16234092,5946781,'1388.1',3,'p'),(16234095,5946778,'10000',13,'p'),(2407215,5882424,'400',1,'p'),(453167,5850927,'1400',5,'p'),
               (16234097,5946777,'1550',3,'p'),(15179994,5932445,'3875',10,'p'),(16234094,5946779,'5500',2,'p'),(459723,5848507,'1300',3,'p'),
               (11941574,5907533,'630',1,'d'),(11941575,5907521,'720',1,'d'),(11939956,5907529,'720',1,'d'),(11939958,5907526,'720',1,'d'),
               (11939960,5907525,'660',1,'d'),(11939961,5907518,'630',1,'d'),(11939934,5907548,'704',1,'d'),(11939939,5907544,'630',1,'d'),
               (11939947,5907542,'770',1,'d'),(11939953,5907532,'660',1,'d'),(11939932,5907553,'1250',1,'d'),(11939933,5907552,'630',1,'d'),
               (11939695,5907523,'735',1,'d'),(11939685,5907541,'660',1,'d'),(11939699,5907515,'630',1,'d')) v(id, ad, sp, avg, k)
  join public.wasalt_residential_listings w on w.id = v.id and floor(v.sp::numeric) = w.price_total
union all
select t.st, t.id, t.ev, now()
  from (values
    ('abwbna_residential_listings', 11631602::bigint, 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 2026-10-18 from https://www.abwbna.com/properties/53393: the page shows «1,600» as «سعر البيع» = the stored price for 300 m². The source shows this number as the price — kept (PRICE = SOURCE), owner list.'),
    ('dealapp_residential_listings', 18565466, 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 2026-10-18 from https://dealapp.sa/ar/ad-details/584148: the page shows «480» as the price and its own «سعر المتر 1.19» for 403 m² = the stored price. The source shows this number as the price — kept (PRICE = SOURCE), owner list.'),
    ('dealapp_residential_listings', 17347133, 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 2026-10-18 from https://dealapp.sa/ar/ad-details/597858: the page shows «300» as the price and its own «سعر المتر 0.31» for 964 m² = the stored price. The source shows this number as the price — kept (PRICE = SOURCE), owner list.'),
    ('mustqr_residential_listings', 16097413, 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 2026-10-18 from https://mustqr.sa/property/4960: «السعر: 450 ريال» for 393.75 m², description «لاسوم ولا حد», no per-metre wording = the stored price. The source shows this number as the price — kept (PRICE = SOURCE), owner list.')
  ) t(st, id, ev)
on conflict (source_table, listing_id) do nothing;

-- PROOF: live counts, a planted big-city «total» is flagged P1-side, a page read moves it to the owner list, a small
-- place has no floor, the seed landed, and the detector is rostered.
do $proof$
declare base_p1 bigint; base_owner bigint; lid bigint; rural record; got record; seeded bigint;
begin
  select count(*) filter (where not source_shows_it), count(*) filter (where source_shows_it)
    into base_p1, base_owner from public.served_total_below_city_floor_rows();
  select count(*) into seeded from public.owner_price_source_shows_small_total where platform in ('wasalt','abwbna','dealapp','mustqr');
  if seeded < 40 then raise exception 'PROOF: only % seeded page reads reached the owner list (want ≥ 40)', seeded; end if;
  select w.id into lid from public.wasalt_residential_listings w
   where w.listing_url ~ '-5848132$' and w.price_total is null and w.price_per_meter = 8000;
  if lid is null then raise exception 'PROOF: the repaired ad 5848132 is not in its repaired state'; end if;
  begin
    -- planted: the repaired Riyadh plot served at its rate again (8,000 for 1,225 m² = 6.5 SAR/m², Riyadh floor ≈ 62)
    update public.search_listings_ar set price_total = 8000, area_m2 = 1225
     where source_table = 'wasalt_residential_listings' and listing_id = lid;
    select * into got from public.served_total_below_city_floor_rows() x where x.listing_id = lid and x.source_table = 'wasalt_residential_listings';
    if got is null or got.source_shows_it then raise exception 'PROOF: a Riyadh plot served at 6.5 SAR/m² was not flagged as our claim'; end if;
    insert into public.ops_price_source_verified (source_table, listing_id, evidence) values ('wasalt_residential_listings', lid, 'proof');
    if not exists (select 1 from public.owner_price_source_shows_small_total where listing_id = lid) then
      raise exception 'PROOF: a page read did not move the row to the owner list';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  -- a place with fewer than 100 priced plots has no floor: the same planted price there is not flagged
  select s.source_table, s.listing_id into rural from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع' and s.type_ar ~ 'أرض' and s.area_m2 between 200 and 5000 and s.price_total_effective > 0
     and s.city_id in (select city_id from public.search_listings_ar where production_ready and deal_ar = 'بيع' and type_ar ~ 'أرض'
                        and area_m2 between 200 and 5000 and price_total_effective > 0 group by city_id having count(*) between 5 and 99)
   limit 1;
  if rural.listing_id is null then raise exception 'PROOF: no small-place plot to plant on (the no-floor case would pass vacuously)'; end if;
  begin
    update public.search_listings_ar set price_total = 8000, area_m2 = 1225 where source_table = rural.source_table and listing_id = rural.listing_id;
    if exists (select 1 from public.served_total_below_city_floor_rows() x where x.source_table = rural.source_table and x.listing_id = rural.listing_id) then
      raise exception 'PROOF: a plot in a small place (no floor) was flagged';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_served_total_below_city_floor') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: % served plots below their city floor are our unverified claim (P1), % are on the owner list', base_p1, base_owner;
end $proof$;
