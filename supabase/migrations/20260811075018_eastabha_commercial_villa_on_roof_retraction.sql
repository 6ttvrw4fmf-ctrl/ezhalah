-- THE OTHER HALF OF A REPAIR THAT ONLY EVER GOT APPLIED TO ONE TABLE.
--
-- PR #449 (merged 2026-08-10) removed the «سطح خاص» (private roof) -> villa_on_roof mapping as
-- simply wrong — scrapers/eastabha/run.py:183 now records it as a NEGATIVE:
--     «سطح خاص (private roof) ✗ villa_on_roof — having roof access is not being a rooftop dwelling»
-- and retracted the rows it had fabricated. It retracted eastabha_RESIDENTIAL only.
-- eastabha_commercial_listings still holds 6 active rows at villa_on_roof = false.
--
-- This is DATA_INTEGRITY_ENGINEER.md §20 (a check or repair scoped to <platform>_residential_listings
-- silently scopes away half the platform) meeting §21 (the retraction trap:
-- db._unknown_must_not_overwrite_known() refuses to let a weaker read erase a stored value, so once
-- the code stops fabricating, the old fabricated value survives every future crawl with all tests
-- green). The mapping is gone, so nothing will ever rewrite these 6 on its own.
--
-- EVIDENCE, all six rows, before touching anything:
--   • villa_on_roof = true appears NOWHERE on eastabha — 0 in residential, 0 in commercial. A column
--     that never says "yes" anywhere is not reading anything; every value it holds is manufactured.
--   • eastabha's features_ar is a POSITIVE-ONLY tag list. Three rows (EA36013, EA33138, EA21188)
--     carry features_ar = null — the seller listed no features at all, and we recorded a confident
--     "this property does NOT have a rooftop villa". The other three list tags
--     (كراج ملحق / كهرباء / ماء / مرافق العامة / فناء / شُرفة / مطبخ مجهز) and NONE mentions «سطح خاص».
--     Absence of a tag is seller silence, not a denial — the standing tri-state rule.
--   • The attribute is not even coherent for the cohort: EA33138 is a petrol station
--     («محطة بنزين للبيع»), EA21188 is bare land («أرض فضاء»), EA35100 is a shop («محل تجاري»).
--
-- Retracted to NULL, never to a value read from prose (§21). This restores the honest "unknown" that
-- the tri-state rule requires; it does not assert the opposite.
do $mig$
declare
  v_before int;
  v_after  int;
  v_true   int;
  v_res_false int;
  v_other_cols int;
begin
  select count(*) into v_before from public.eastabha_commercial_listings where villa_on_roof is false;
  if v_before <> 6 then
    raise exception 'expected exactly 6 fabricated rows, found % — cohort changed, aborting', v_before;
  end if;

  -- CONTROL (§21): there is no source-real `true` on this column to pin, and that absence IS the
  -- evidence. Pin it explicitly so a future sweep cannot quietly widen: if a real `true` ever exists,
  -- this migration's premise is void and it must not run.
  select count(*) into v_true from public.eastabha_commercial_listings where villa_on_roof is true;
  if v_true <> 0 then
    raise exception 'villa_on_roof=true exists (%) — the column does read something after all; abort', v_true;
  end if;

  update public.eastabha_commercial_listings
     set villa_on_roof = null
   where villa_on_roof is false;

  select count(*) into v_after from public.eastabha_commercial_listings where villa_on_roof is not null;
  if v_after <> 0 then
    raise exception 'retraction incomplete: % rows still carry a value', v_after;
  end if;

  -- the residential half PR#449 already fixed must be exactly as it was (0 false / 0 true)
  select count(*) into v_res_false from public.eastabha_residential_listings
   where villa_on_roof is not null;
  if v_res_false <> 0 then
    raise exception 'eastabha_residential villa_on_roof is no longer clean (% rows) — investigate', v_res_false;
  end if;

  -- BLAST-RADIUS CONTROL: this must have touched ONE column. balcony_terrace was the other column
  -- PR#449 corrected on this platform; assert it was not disturbed by this migration.
  select count(*) into v_other_cols from public.eastabha_commercial_listings
   where balcony_terrace is false;
  raise notice 'retracted % eastabha_commercial villa_on_roof rows to NULL; balcony_terrace false rows untouched at %',
    v_before, v_other_cols;
end $mig$;
