-- 2026-10-18, batch 3 of PRICE = SOURCE case (b) (batches 1-2: 20261018150434, 20261018161436). Served sale plots under
-- their city's floor whose own page shows that number as the price, every one read live today (22:50-23:10 UTC); none
-- states a per-metre rate for that figure. The rest of each list was a rate the extractor missed (fixed: amlakalahsa
-- #7559 and its price-label follow-up, ialqarawi QRW2823 rate-in-description, bossbih stale rate #7560).
--   bossbih 11 of 11 (the office's total labels «السعر/السوم/الحد», no «المتر» on the ad), amlakalahsa 2 (the REST
--   price label pw-prc-typ «سوم» / «السعر»), ialqarawi 2 («سعر السوم», no per-metre word in the ad).
set local lock_timeout = '5s';

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'bossbih_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 22:50 UTC from https://bossbihoffice.com.sa/%s: '
              '«المساحة %s م … %s %s ريال» = the stored price; no «المتر» on the ad. The source shows this number as the price — '
              'kept (PRICE = SOURCE), owner list.', nid, area, lbl, fig), now()
  from (values
  (12601800, '13792', 308, 'السوم', '1,000'),
  (12601812, '11295', 375, 'السوم', '1,200'),
  (12601828, '12202', 500, 'السوم', '1,600'),
  (12601866, '10867', 466, 'السوم', '1,350'),
  (12602022, '14472', 275, 'السعر', '1,600'),
  (12602110, '12398', 500, 'السوم', '1,700'),
  (12602514, '8076', 367, 'السعر', '1,350'),
  (12602518, '10431', 814, 'الحد', '1,600'),
  (12602750, '12348', 518, 'السعر', '2,000'),
  (14413572, '14562', 360, 'السعر', '1,200'),
  (17825188, '14657', 400, 'السعر', '350')
  ) v(id, nid, area, lbl, fig)
 where not exists (select 1 from public.ops_price_source_verified o
                    where o.source_table = 'bossbih_residential_listings' and o.listing_id = v.id);

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'amlakalahsa_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 22:55 UTC: %s prints «المساحة %s م … السعر %s%s», '
              'REST pw-prc-typ «%s» — a total label, not «سعر المتر». Kept (PRICE = SOURCE), owner list.', ad, area, fig, lblp, typ), now()
  from (values
  (11622421, 'AMH19198', 661, '1,600', ' سوم', 'سوم'),
  (17083389, 'AMH20045', 900, '499', '', 'السعر')
  ) v(id, ad, area, fig, lblp, typ)
 where not exists (select 1 from public.ops_price_source_verified o
                    where o.source_table = 'amlakalahsa_residential_listings' and o.listing_id = v.id);

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'ialqarawi_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 23:05 UTC from '
              'https://ialqarawi.com/index.php?router=card&id=%s: «مساحة الأرض %s … سعر السوم %s», no per-metre word in the ad. '
              'Kept (PRICE = SOURCE), owner list.', card, area, fig), now()
  from (values
  (12591112, '1792', '243.4', '140'),
  (13514601, '2210', '600م', '330')
  ) v(id, card, area, fig)
 where not exists (select 1 from public.ops_price_source_verified o
                    where o.source_table = 'ialqarawi_residential_listings' and o.listing_id = v.id);
