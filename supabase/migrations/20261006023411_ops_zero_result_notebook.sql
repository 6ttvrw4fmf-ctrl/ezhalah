-- THE NOTEBOOK (owner 2026-10-05: «how can we never get this issue — or anything like it»).
-- Every «no results» a real user is shown is written down — the place and the structured filters
-- only: no free text, no user id, no device id — so the nightly 🔧 Quality & Repair engineer can
-- re-check each one against the database and fix any that was not true (docs/ops/QUALITY_REPAIR_ENGINEER.md).
-- Written by src/data/zeroResultLog.ts; `clash` = the app's own shelf check (src/lib/shelfCheck.ts)
-- already proved this zero false.

create table if not exists public.ops_zero_result_log (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  entry jsonb not null
);
create index if not exists ops_zero_result_log_at_idx on public.ops_zero_result_log (at);
-- No policies: nobody reads or writes the table directly; only log_zero_result() below writes.
alter table public.ops_zero_result_log enable row level security;

create or replace function public.log_zero_result(p_entry jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or length(p_entry::text) > 4000 then
    return;
  end if;
  -- Flood guard: a broken client or a bot can never turn the notebook into database load.
  if (select count(*) from public.ops_zero_result_log where at > now() - interval '1 hour') >= 3000 then
    return;
  end if;
  insert into public.ops_zero_result_log (entry) values (p_entry);
end;
$$;
revoke all on function public.log_zero_result(jsonb) from public;
grant execute on function public.log_zero_result(jsonb) to anon, authenticated;

-- PDPL: the notebook keeps 30 days, no more.
select cron.unschedule('ops-zero-result-log-retention')
  where exists (select 1 from cron.job where jobname = 'ops-zero-result-log-retention');
select cron.schedule('ops-zero-result-log-retention', '41 3 * * *',
  $$delete from public.ops_zero_result_log where at < now() - interval '30 days'$$);
