-- refresh_rnpl_flags() manufactured a negative at the SEARCH layer.
--
-- It projected `coalesce(rent_now_pay_later, false)`, so every listing whose
-- source never stated anything about instalments arrived in search_listings_ar
-- as an explicit `false`. Because this runs on cron (jobid 47, every :20) it also
-- would have silently reverted the raw-layer repair within 20 minutes.
--
-- Faithful propagation instead: NULL stays NULL. Verified behaviour-identical —
-- every consumer already treats NULL as "not RNPL":
--   location_search_candidates_ar routing : coalesce(s.rent_now_pay_later, false)
--   location_search_candidates_ar amenity : `or s.rent_now_pay_later`  (NULL -> excluded)
--   sync_payment_monthly / enforce_price_size_sanity : not coalesce(..., false)
-- so no result set changes; we simply stop asserting a "no" no source published.
--
-- Preserved from the previous definition (asserted by
-- scripts/verify-rnpl-guard-replay.ts): fleet-wide table discovery from
-- information_schema, no hardcoded platform names, and the null-union early
-- return so the function can never silently clear flags.
create or replace function public.refresh_rnpl_flags()
returns bigint
language plpgsql
as $function$
declare
  v_updated bigint := 0;
  v_sql     text;
  v_union   text;
begin
  -- every source table that (1) actually feeds search_listings_ar and (2) exposes the flag
  select string_agg(
           format('select %L::text as tbl, id, rent_now_pay_later as rnpl from public.%I',
                  t.source_table, t.source_table),
           ' union all ')
    into v_union
  from (
    select distinct s.source_table
    from public.search_listings_ar s
    where exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name   = s.source_table
        and c.column_name  = 'rent_now_pay_later')
  ) t;

  if v_union is null then
    return 0;   -- nothing to do; never silently "clear" flags
  end if;

  v_sql := format($f$
    update public.search_listings_ar s
       set rent_now_pay_later = src.rnpl
      from (%s) src
     where s.source_table = src.tbl
       and s.listing_id   = src.id
       and s.rent_now_pay_later is distinct from src.rnpl
  $f$, v_union);

  execute v_sql;
  get diagnostics v_updated = row_count;
  return v_updated;
end $function$;

comment on function public.refresh_rnpl_flags() is
  'Propagates rent_now_pay_later from every source table into search_listings_ar FAITHFULLY - NULL stays NULL. Never coalesce to false: source silence is not a published "no".';
