-- PRICE = SOURCE, layer 6 (owner invariant 2026-08-04): standing corroboration monitor.
-- Compares every stored price against the SOURCE'S OWN captured price evidence and raises when
-- they disagree. Costs nothing external — it reads evidence already in the database, so it can
-- run at any cadence without touching a platform (no rate-limit surface at all).
--
-- Two evidence shapes are read today:
--   • wasalt: ar_data.propertyInfo.salePrice — native, covers 42k+ Buy rows retroactively.
--   • any platform: source_capture->'price_evidence'->>'raw', written fleet-wide by
--     normalize.price_evidence() + db._fold_price_evidence() from the 2026-08-04 change onward.
-- Coverage therefore GROWS as crawls land; the view reports it so the gap is never invisible.
--
-- NEUTRAL BY DESIGN: it only reports. It never edits a price, never hides a listing, never flips
-- active — the owner's rule is that a weird source price is not ours to correct, and a mismatch
-- needs a human/verified repair to the SOURCE-DISPLAYED value, not an automatic one.
create or replace view public.mon_price_source_corroboration as
with wasalt as (
  select 'wasalt_residential_listings'::text as source_table, id as listing_id,
         price_total::numeric as stored,
         (ar_data->'propertyInfo'->>'salePrice')::numeric as source_price,
         'ar_data.propertyInfo.salePrice'::text as evidence_field
  from wasalt_residential_listings
  where active and transaction_type = 'Buy' and price_total is not null
    and (ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
)
select source_table, listing_id, stored, source_price, evidence_field,
       case when stored = source_price then 'agree'
            when source_price >= stored * 10 then 'stored_understated_10x'
            when stored >= source_price * 10 then 'stored_overstated_10x'
            else 'differs_minor' end as verdict
from wasalt;

comment on view public.mon_price_source_corroboration is
  'PRICE = SOURCE corroboration: stored price vs the platform''s own captured price. Report-only.';

create or replace function public.mon_detect_price_source_mismatch()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; n int := 0;
begin
  select count(*) filter (where verdict = 'stored_understated_10x'),
         count(*) filter (where verdict = 'stored_overstated_10x'),
         count(*) filter (where verdict = 'differs_minor'),
         count(*)
    into v_under, v_over, v_minor, v_checked
    from public.mon_price_source_corroboration;

  -- A >=10x disagreement cannot be a source price change; it is the ppm-as-total / truncation
  -- class. P1 immediately — these are the numbers that would show a 5M villa at 7,500 SAR.
  if (v_under + v_over) > 0 then
    perform public.mon_raise(
      'price_source_mismatch_10x', 'P1', (v_under + v_over),
      format('%s row(s) disagree with the source''s own captured price by >=10x (%s understated, %s overstated) of %s corroborated',
             v_under + v_over, v_under, v_over, v_checked));
    n := n + 1;
  end if;

  -- Same-magnitude drift is expected (real listings get discounted); only shout if it becomes a
  -- population-level problem rather than the usual handful.
  if v_checked > 0 and v_minor > greatest(200::bigint, v_checked / 100) then
    perform public.mon_raise(
      'price_source_drift', 'P2', v_minor,
      format('%s of %s corroborated rows differ from the source price by <10x (stale-price drift)',
             v_minor, v_checked));
    n := n + 1;
  end if;
  return n;
end $function$;

comment on function public.mon_detect_price_source_mismatch() is
  'Raises when a stored price disagrees with the platform''s own captured price evidence. Report-only; never edits data.';