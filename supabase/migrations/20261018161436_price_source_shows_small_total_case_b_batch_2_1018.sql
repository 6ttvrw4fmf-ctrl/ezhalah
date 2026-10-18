-- 2026-10-18, batch 2 of PRICE = SOURCE case (b) (batch 1: 20261018150434). Served sale plots under their city's floor
-- whose own page shows that number as the price, every one read live today (2026-10-18 16:00-16:15 UTC); none states a
-- per-metre rate for that figure. The rest of each platform's list was a rate the extractor missed (fixed: abralosol
-- #7542, sadiqeltajer #7543, haraj #7544, alshawaf #7539) or a placeholder that waits for the owner.
--   alshawaf 24 of 25 (the ad's own «سعر السوم/سعر البيع» field), abralosol 19 of 21 («السعر/السوم/الحد»),
--   sadiqeltajer 4 of 14, mustqr 8 of 8 (price_som/price_had; no per-metre word in the description, nor in
--   the ad text — matched server-side, the text is PII and never fetched), haraj 9 of 20 («سعر الوحدة» with no
--   per-metre marker anywhere: a total by the owner's default).
set local lock_timeout = '5s';

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'alshawaf_' || case k when 'r' then 'residential' else 'commercial' end || '_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 16:00 UTC from https://alshawaf.com.sa/%s: the ad''s own '
              'field «%s %s» on %s m² = the stored price; no «المتر» on it. The source shows this number as the price — kept (PRICE = SOURCE), owner list.',
              ad, lbl, fig, area), now()
  from (values
  (12605038, 'r', 20888, 'سعر البيع', '1,900', 601),
  (12605039, 'r', 21922, 'سعر السوم', '1,550', 325),
  (12605053, 'r', 20348, 'سعر السوم', '1,420', 424),
  (12605160, 'r', 21274, 'سعر السوم', '1,450', 550),
  (12605197, 'r', 21668, 'سعر السوم', '1,400', 544),
  (12605205, 'r', 22008, 'سعر السوم', '1,650', 488),
  (12605304, 'r', 21624, 'سعر السوم', '850', 585),
  (12605306, 'r', 20986, 'سعر السوم', '1,200', 750),
  (12605307, 'r', 22163, 'سعر السوم', '1,600', 600),
  (12605312, 'r', 22076, 'سعر السوم', '1,850', 250),
  (12605318, 'r', 22007, 'سعر السوم', '1,650', 468),
  (12605325, 'r', 18207, 'سعر السوم', '1,000', 600),
  (12605343, 'r', 20471, 'سعر السوم', '1,800', 400),
  (12605352, 'r', 21173, 'سعر السوم', '800', 507),
  (12605355, 'r', 19065, 'سعر السوم', '1,400', 466),
  (12605421, 'r', 20281, 'سعر السوم', '1,850', 487),
  (12605482, 'r', 21003, 'سعر السوم', '1,200', 514),
  (12605549, 'r', 21068, 'سعر السوم', '1,600', 661),
  (12605891, 'c', 17193, 'سعر السوم', '2,700', 500),
  (12605892, 'c', 18336, 'سعر السوم', '2,400', 500),
  (12605895, 'c', 19187, 'سعر السوم', '1,400', 800),
  (12605910, 'c', 20479, 'سعر السوم', '1,800', 626),
  (12605925, 'c', 16718, 'سعر السوم', '1,900', 1338),
  (12605926, 'c', 18335, 'سعر السوم', '2,400', 612)
  ) as v(id, k, ad, lbl, fig, area)
union all
select 'abralosol_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 16:05 UTC from https://abralosol.com/%s: the ad''s own '
              'price field «%s %s ريال» on %s m² = the stored price; its text states no per-metre rate. The source shows this number as the '
              'price — kept (PRICE = SOURCE), owner list.', ad, lbl, fig, area), now()
  from (values
  (10297467, 7297, 'السعر', 1850, 410),
  (10297499, 6697, 'الحد', 1300, 625),
  (10297618, 6962, 'السعر', 1250, 640),
  (10297726, 6728, 'السعر', 1650, 390),
  (10297772, 6578, 'السعر', 1200, 400),
  (10297837, 6369, 'السوم', 500, 734),
  (10297931, 6011, 'السوم', 1600, 500),
  (10297973, 5831, 'السوم', 1400, 450),
  (10298122, 5427, 'السعر', 600, 600),
  (10298191, 5038, 'السوم', 1650, 510),
  (10298209, 4002, 'السوم', 2000, 1083),
  (10298277, 4696, 'الحد', 425, 625),
  (10298280, 4677, 'السعر', 614, 307),
  (10302859, 6384, 'السعر', 450, 625),
  (10302860, 6382, 'السعر', 450, 625),
  (10302876, 5342, 'السعر', 425, 630),
  (10811842, 7788, 'السعر', 1450, 500),
  (12021283, 7880, 'السعر', 1100, 465),
  (13896690, 7927, 'السعر', 1500, 341)
  ) as v(id, ad, lbl, fig, area)
union all
select 'sadiqeltajer_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 16:08 UTC from https://sadiq-eltajer.sa/ads/%s: the '
              'header prints %s ريال = the stored price; neither the header nor the description states a per-metre rate. The source shows '
              'this number as the price — kept (PRICE = SOURCE), owner list.', slug, fig), now()
  from (values
  (12217864, 'ard-bhy-albsatyn-shrk-bryd-16', 600),
  (12217990, 'ard-hy-albsatyn-mokaa-mmyz', 850),
  (12218099, 'llbyaa-ard-bhy-albsatyn-alghrby-khlf-fyafy-dyrty', 800),
  (12218181, 'thlath-ktaa-sknyh-hy-albsatyn', 800)
  ) as v(id, slug, fig)
union all
select 'mustqr_' || case k when 'r' then 'residential' else 'commercial' end || '_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read 16:10 UTC from mustqr''s public API for property %s: '
              '«%s» %s on %s m² = the stored price; the description and the ad text carry no per-metre word (the text matched '
              'server-side, never fetched). The source shows this number as the price — kept (PRICE = SOURCE), owner list.',
              pid, lbl, fig, area), now()
  from (values
  (614904, 'r', 3197, 'الحد', 1000, 432.7),
  (614905, 'r', 3198, 'السوم', 220, 3593),
  (614924, 'r', 3232, 'الحد', 850, 569),
  (614985, 'r', 3317, 'السوم', 700, 504),
  (614992, 'r', 3327, 'السوم', 300, 889.79),
  (615041, 'r', 3401, 'السوم', 850, 1200),
  (615110, 'r', 3492, 'السوم', 1100, 241),
  (615551, 'c', 3216, 'السوم', 1700, 668)
  ) as v(id, k, pid, lbl, fig, area)
union all
select 'haraj_' || case k when 'r' then 'residential' else 'commercial' end || '_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 16:12 UTC from https://haraj.com.sa/%s: the licence '
              'box prints «سعر الوحدة: %s» on %s m² = the stored price, and no mention of the figure carries a per-metre word. A total '
              'by the owner''s default for «سعر الوحدة» (2026-10-18), owner list.', hid, fig, area), now()
  from (values
  (18483143, 'r', 11190618745, 400, 986),
  (18483893, 'r', 11190613152, 1400, 480),
  (18484510, 'r', 11190539822, 500, 500),
  (18540877, 'r', 11190475017, 1350, 500),
  (18592011, 'c', 11190024827, 750, 770),
  (18659320, 'r', 11189467928, 2400, 578),
  (18706322, 'r', 11189184277, 750, 1008),
  (18706345, 'r', 11189120675, 750, 1008),
  (18708691, 'r', 11188946310, 2300, 780)
  ) as v(id, k, hid, fig, area)
on conflict (source_table, listing_id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.ops_price_source_verified
   where evidence like 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read%' and verified_at >= now() - interval '1 minute';
  if n <> 64 then raise exception 'PROOF: expected 64 owner-list rows written, found %', n; end if;
end $$;