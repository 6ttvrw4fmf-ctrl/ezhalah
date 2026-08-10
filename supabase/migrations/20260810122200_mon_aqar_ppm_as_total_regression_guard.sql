-- REGRESSION GUARD (2026-08-10, P1 class).
-- Defect: aqar renders an UNLABELED per-meter price chip in the page header, ABOVE the labeled
-- total. aqar_parse() collects every currency-marked number in document order and takes prices[1],
-- so the header chip (a RATE) becomes price_total and the explicit «السعر: N ريال» total is ignored.
-- Observed 2026-08-09 on ids 7026223 / 7032586: an 11,000,000 SAR building served at 2,690 SAR.
-- The 2026-08-03 per-meter strip in aqar_parse cannot catch this: it only removes a rate that sits
-- ADJACENT to the word «المتر»; the header chip carries no label at all.
-- Existing barriers were all structurally blind to it:
--   * mon_detect_price_fidelity.ppm_source_dropped -> raises only when > 200 rows (this class is small-N)
--   * price_fidelity()                             -> diffs two projections of the SAME raw row, so they agree
--   * price_size_impossible()                      -> upper bounds only; 1.29 SAR/m² has no floor to trip
-- This view is the regression test: it must stay EMPTY. It fires only on the proven-wrong signature
-- (stored total == source-published per-meter rate, WHILE the page also prints a different labeled
-- total), which is why the 18 rows where price_total merely coincides with a parsed ppm and no
-- competing labeled total exists are correctly NOT flagged.
create or replace view public.mon_aqar_ppm_as_total as
with src as (
  select 'aqar_residential_listings'::text as source_table, id, price_total, area_m2,
         source_capture->>'source_text' as txt
    from public.aqar_residential_listings
   where active and transaction_type = 'Buy' and price_total is not null
     and source_capture->>'source_text' is not null
  union all
  select 'aqar_commercial_listings'::text, id, price_total, area_m2,
         source_capture->>'source_text'
    from public.aqar_commercial_listings
   where active and transaction_type = 'Buy' and price_total is not null
     and source_capture->>'source_text' is not null
), calc as (
  select source_table, id, price_total, area_m2,
         public.aqar_published_ppm(txt) as published_ppm,
         round(public.safe_numeric(
           regexp_replace(
             (regexp_match(translate(txt,'٠١٢٣٤٥٦٧٨٩','0123456789'),
                           'السعر\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)'))[1],
             ',', '', 'g')))::bigint as labeled_total
    from src
)
select source_table, id, price_total, published_ppm, labeled_total, area_m2
  from calc
 where published_ppm is not null
   and price_total = published_ppm
   and labeled_total is not null
   and labeled_total <> price_total;

comment on view public.mon_aqar_ppm_as_total is
  'Regression test for the aqar per-meter-as-total defect (2026-08-10). MUST return 0 rows. Non-empty = a source-published per-meter RATE is being served as a property TOTAL.';

create or replace function public.mon_detect_aqar_ppm_as_total()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows bigint; v_target text; v_open_sev text; n int := 0;
begin
  select count(*) into v_rows from public.mon_aqar_ppm_as_total;

  -- No small-N exemption: PRICE = SOURCE has no threshold. One served row is one lie.
  if v_rows > 0 then v_target := 'P1'; else v_target := null; end if;

  select severity into v_open_sev from public.alert_event
   where dedup_key = 'aqar_ppm_as_total' and resolved_at is null
   order by created_at desc limit 1;

  if v_target is null then
    if v_open_sev is not null then perform public.mon_resolve('aqar_ppm_as_total','aqar'); end if;
  elsif v_open_sev is distinct from v_target then
    if v_open_sev is not null then perform public.mon_resolve('aqar_ppm_as_total','aqar'); end if;
    n := n + public.mon_raise(v_target, 'aqar_ppm_as_total', 'aqar', 'aqar_ppm_as_total',
      jsonb_build_object(
        'rows', v_rows,
        'sample', (select jsonb_agg(to_jsonb(t)) from (select * from public.mon_aqar_ppm_as_total limit 5) t),
        'why', 'A source-published PER-METER rate is stored as price_total while the same page prints an explicit «السعر: N ريال» total. Users see a multi-million property priced at the per-meter figure. Root cause: aqar_parse() takes the first currency-marked number in document order and aqar renders an unlabeled per-meter chip in the page header above the labeled total.'));
  end if;

  return n;
end
$function$;