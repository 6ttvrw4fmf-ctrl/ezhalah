-- Annual-Rent apartment guided flow (owner 2026-07-20): expose the source-advertised "rent now, pay
-- later" (installments) flag in the search index so the guided filter can query it.
--
-- FIDELITY + NEUTRALITY: rent_now_pay_later is a REAL per-listing attribute (Aqar + a couple of Al
-- Hoshan rows carry it; every other platform is false). We only surface/filter it as neutral listing
-- metadata — no payment calc, estimate, ranking, or advice, no payment processing. See
-- [[feedback_listing-fidelity-absolute-rule]] and PRD §6/§7 (to be amended to permit displaying
-- source financing metadata while still barring Ezhalah from offering financing/advice).
--
-- ARCHITECTURE: additive side-column maintained by refresh_rnpl_flags(), NOT threaded through the
-- v2/sync backbone — the same low-risk pattern as district_recovery. sync_search_listings_ar()'s
-- on-conflict list does NOT include this column, so a sync never clobbers it; brand-new rows insert
-- the default (false) and the scheduled refresh sets them on the next tick (a short, acceptable lag).

alter table public.search_listings_ar
  add column if not exists rent_now_pay_later boolean not null default false;

-- Small partial index: only ~16k rows are true out of ~180k, so a partial index keeps the RNPL
-- predicate cheap without bloating the table.
create index if not exists idx_search_listings_ar_rnpl
  on public.search_listings_ar (rent_now_pay_later) where rent_now_pay_later;

-- Faithful re-sync of the flag from the only source tables that carry it (Aqar + Al Hoshan, res+com).
-- ONE targeted UPDATE that copies the source boolean exactly (coalesce null→false), touching only rows
-- whose stored value differs — so it stays cheap and never invents a value. Rows in every other source
-- table keep the default false (those platforms genuinely have no installment product).
create or replace function public.refresh_rnpl_flags()
returns bigint
language plpgsql
as $$
declare v_updated bigint;
begin
  update public.search_listings_ar s
     set rent_now_pay_later = src.rnpl
    from (
      select 'aqar_residential_listings'::text     as tbl, id, coalesce(rent_now_pay_later, false) as rnpl from public.aqar_residential_listings
      union all select 'aqar_commercial_listings'::text,      id, coalesce(rent_now_pay_later, false) from public.aqar_commercial_listings
      union all select 'alhoshan_residential_listings'::text, id, coalesce(rent_now_pay_later, false) from public.alhoshan_residential_listings
      union all select 'alhoshan_commercial_listings'::text,  id, coalesce(rent_now_pay_later, false) from public.alhoshan_commercial_listings
    ) src
   where s.source_table = src.tbl
     and s.listing_id = src.id
     and s.rent_now_pay_later is distinct from src.rnpl;
  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

-- Backfill now.
select public.refresh_rnpl_flags();

-- Keep it fresh: hourly at :20 (after the district-recovery job at :10), guarded against re-runs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'refresh-rnpl-flags') then
      perform cron.unschedule('refresh-rnpl-flags');
    end if;
    perform cron.schedule('refresh-rnpl-flags', '20 * * * *', 'select public.refresh_rnpl_flags();');
  end if;
end $$;
