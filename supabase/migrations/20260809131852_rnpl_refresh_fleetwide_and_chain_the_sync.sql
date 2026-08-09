-- Two remaining pieces of the RNPL/Monthly window, on the DATA side.
--
-- (a) refresh_rnpl_flags() enumerated FOUR HARDCODED TABLES (aqar + alhoshan, res + com). That is the
--     same banned shape as the platform-name clause removed in 20260809120630: the day any other
--     platform starts publishing rent-now-pay-later, its rows keep rent_now_pay_later=false and get
--     bucketed Monthly — a manufactured period. Now DYNAMIC over every source_table actually present
--     in search_listings_ar that exposes the column, so new platforms are covered automatically and
--     no platform is named.
--
-- (b) The flag arrived 5 minutes after the row: sync at :15, refresh at :20. Chaining the three
--     steps into the :15 job makes the row, its RNPL flag and payment_monthly converge in the same
--     run instead of across two cron ticks. The standalone :20 refresh and the 10-minute
--     sync_payment_monthly sweep stay as independent backstops.
--
-- The read layer (migration monthly_bucket_excludes_rnpl_at_read_time) already guarantees a stale
-- flag can never surface an instalment listing under شهري; this makes the stored data converge too.
CREATE OR REPLACE FUNCTION public.refresh_rnpl_flags()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  v_updated bigint := 0;
  v_sql     text;
  v_union   text;
begin
  -- every source table that (1) actually feeds search_listings_ar and (2) exposes the flag
  select string_agg(
           format('select %L::text as tbl, id, coalesce(rent_now_pay_later,false) as rnpl from public.%I',
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

-- (b) chain: row → RNPL flag → payment_monthly, all inside the :15 run.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'sync-search-listings-ar'),
  command => $cmd$set statement_timeout to '600s'; select * from public.sync_search_listings_ar(); select public.refresh_rnpl_flags(); select public.sync_payment_monthly();$cmd$
);
