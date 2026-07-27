-- Precomputed audit counts (2026-07-27). The nightly audit's not-ready + stale-index checks count
-- over listing_native_location_v2 / mon_search_index_city_drift. Doing that at REQUEST time via
-- PostgREST trips the short per-request statement_timeout (57014) whenever a matview refresh is
-- contending — the previous SET-LOCAL RPC couldn't help (the whole RPC is one statement under the
-- caller's timeout). Dashboard-first fix: a pg_cron background worker (no request timeout) computes
-- the counts every 30 min into a 1-row table; the nightly check reads that row instantly.
create table if not exists public.mon_audit_counts (
  id boolean primary key default true check (id),
  not_ready_total int,
  not_ready_unexplained int,
  search_index_drift int,
  computed_at timestamptz not null default now()
);

create or replace function public.refresh_mon_audit_counts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c jsonb;
begin
  c := public.audit_location_counts();  -- reuses the count SQL; runs on the cron worker (no PostgREST timeout)
  insert into public.mon_audit_counts (id, not_ready_total, not_ready_unexplained, search_index_drift, computed_at)
  values (true, (c->>'not_ready_total')::int, (c->>'not_ready_unexplained')::int, (c->>'search_index_drift')::int, now())
  on conflict (id) do update set
    not_ready_total       = excluded.not_ready_total,
    not_ready_unexplained = excluded.not_ready_unexplained,
    search_index_drift    = excluded.search_index_drift,
    computed_at           = excluded.computed_at;
end
$$;

select public.refresh_mon_audit_counts();  -- seed immediately

select cron.schedule('refresh-mon-audit-counts', '*/30 * * * *', $$select public.refresh_mon_audit_counts();$$);
