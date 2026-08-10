-- THE PAIRED RETRACTION for the aqar area leak (Filter audit, 2026-08-10).
--
-- The parser fix (area read from the «تفاصيل الإعلان» spec table only, never from prose) stops NEW
-- fabrications. It cannot undo old ones: `_unknown_must_not_overwrite_known` deliberately refuses to
-- let a weaker read erase a stored value, so a wrong area survives every future crawl untouched.
-- That is the RETRACTION TRAP this project has now hit three times (alhoshan instalments, eastabha
-- EA21188, and here). Removing a fabrication from code is half the job.
--
-- WHY THESE FIVE AND NOT THE OTHER 26. Fleet-wide, 31 live rows have area_m2 exactly equal to the
-- asking price. Equality alone is NOT evidence of a defect: aqar ad 6594767 publishes «سعر المتر 1»,
-- so its total legitimately equals its area, and 1,024,400 is printed on the page. Only rows that
-- ALSO have no currency-marked figure anywhere in their capture are suspect, and of those, three
-- carry positive proof — the page states a different, physically plausible area:
--   6603069  stored 1,822,550 m²  — page: «مساحتها 364,51 متر مربع» and «قيمة الأرض … = 1,822,550 ريال»
--   6680418  stored 4,200,000 m²  — page: «910م² على شارع 25م»  (a 4.2 km² villa)
--   6664214  stored   450,000 m²  — page: «مساحة البناء (التأجيرية): 480 متر مربع»
--   6656704  stored   550,000 m²  — page states «السعر: 550,000 ريال» and no area at all
--   6327295  stored   460,000 m²  — likewise, area equal to the price with no area published
--
-- WHY NULL AND NOT THE PROSE NUMBER. 364.51 and 910 are real, but they are the SELLER'S DESCRIPTION.
-- Prose is not a source field — that is the same rule that forbids taking a price from a description,
-- and it does not bend just because the prose happens to look right. NULL is the honest state: we do
-- not have a published area for these listings. The re-crawl repopulates it from aqar's spec table.
--
-- NOT a trigger. A write-boundary guard that nulled any area equal to the price would destroy
-- 6594767, whose equality is source-real. This class needs adjudication, so it stays a monitor
-- (`mon_price_size_fidelity_barrier`), not an automatic rewrite.
do $$
declare v_before int; v_after int; v_control int;
begin
  select count(*) into v_before
  from public.aqar_residential_listings
  where ad_number in ('6603069','6680418','6664214','6656704','6327295')
    and area_m2 is not null;

  if v_before <> 5 then
    raise exception 'expected 5 rows still carrying the fabricated area, found %', v_before;
  end if;

  update public.aqar_residential_listings
     set area_m2         = null,
         price_per_meter = null   -- derived from the bogus area; it cannot outlive it
   where ad_number in ('6603069','6680418','6664214','6656704','6327295');

  select count(*) into v_after
  from public.aqar_residential_listings
  where ad_number in ('6603069','6680418','6664214','6656704','6327295')
    and area_m2 is not null;
  if v_after <> 0 then
    raise exception 'retraction did not take: % rows still carry an area', v_after;
  end if;

  -- CONTROL: the source-real equality must survive untouched. If this row ever loses its area, the
  -- repair has started eating published data and must be reverted.
  select count(*) into v_control
  from public.aqar_residential_listings
  where ad_number = '6594767' and area_m2 = 1024400;
  if v_control <> 1 then
    raise exception 'control row 6594767 lost its source-published area — aborting';
  end if;

  raise notice 'retracted 5 fabricated areas; control 6594767 intact';
end $$;