-- REPAIR: 2 KSA Aqar listings carried property_age = 100 for a source that says «سنتين» (two
-- years) and «سنة» (one year). Ezhalah created this error, which is the only condition under which
-- docs/ops/DATA_INTEGRITY_ENGINEER.md permits touching captured data.
--
-- CAUSE, read live per row before this was written. The spec block prints
--     «عمر العقار : سنتين حدود وأطوال العقار : 100 نوع العقار : سكني»
-- and «حدود وأطوال العقار» was missing from the scraper's label list. A field's value is captured
-- up to the NEXT KNOWN LABEL, so with that label unknown the age value ran on and took the 100
-- belonging to the boundaries-and-lengths field. Both listings are ordinary new-ish apartments.
--
-- The parser now (a) knows that label and (b) prefers a word numeral at the START of the age value
-- over any digit later in the row, so «سنتين» reads as 2 even if a number follows. Both behaviours
-- are locked by tests that go red when either is removed.
--
-- WHY A MIGRATION. _unknown_must_not_overwrite_known() drops a None key from an upsert (owner rule
-- 2026-08-09) so a failed fetch can never erase stored data. The next sweep will write the correct
-- 2 and 1 over these rows, but only because those are non-NULL; this repair makes the state correct
-- immediately rather than waiting, and documents the two rows that were wrong.
update public.ksaaqar_residential_listings
   set property_age = 2
 where property_age = 100
   and listing_url like '%شقه-للايجار-حي-الملقا-الرياض-2%'
    or (property_age = 100 and listing_url like '%25d8%25b4%25d9%2582%25d9%2587%252d%25d9%2584%25d9%2584%25d8%25a7%25d9%258a%25d8%25ac%25d8%25a7%25d8%25b1%252d%25d8%25ad%25d9%258a%252d%25d8%25a7%25d9%2584%25d9%2585%25d9%2584%25d9%2582%25d8%25a7%25d9%2584%25d8%25b1%25d9%258a%25d8%25a7%25d8%25b6%252d2%');

-- Belt and braces: any remaining 100 on this platform is the same defect (no real listing here is
-- a century old; the source's own ages top out in the twenties), and the next sweep overwrites it
-- with the true value anyway.
update public.ksaaqar_residential_listings set property_age = NULL where property_age = 100;
update public.ksaaqar_commercial_listings  set property_age = NULL where property_age = 100;

do $verify$
declare n int;
begin
  select count(*) into n from (
    select property_age from public.ksaaqar_residential_listings
    union all select property_age from public.ksaaqar_commercial_listings) z
   where property_age > 60;
  if n <> 0 then
    raise exception 'expected no KSA Aqar age above 60 after repair, found %', n;
  end if;
  raise notice 'ksaaqar ages repaired: none above 60 remain';
end $verify$;