-- 2026-10-19, PRICE = SOURCE case (b), batch 5 (owner list): ksaaqar KSA131053426708087 (residential id 12225968), a sale
-- apartment in خميس مشيط. Read live 2026-10-19 03:40 UTC: the ad's own price field prints «750.00ريال (مُثَبَّت)»; the
-- seller's description says «بسعر750الف». The price field is what the source shows as the price, so 750 is served as
-- it stands (coordinator decision 2026-10-19: keep serving the source's price field) and listed for the owner.
set local lock_timeout = '5s';

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'ksaaqar_residential_listings', 12225968,
       'Price fidelity 2026-10-19. Read live 03:40 UTC: the price field shows «750.00ريال (مُثَبَّت)» = the stored price; '
       || 'the description says «بسعر750الف». The source shows 750 as the price — kept (PRICE = SOURCE), owner list.', now()
 where exists (select 1 from public.ksaaqar_residential_listings r
                where r.id = 12225968 and r.ad_number = 'KSA131053426708087' and r.price_total = 750)
   and not exists (select 1 from public.ops_price_source_verified o
                    where o.source_table = 'ksaaqar_residential_listings' and o.listing_id = 12225968);
