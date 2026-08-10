-- Materialised Safety Barrier state.
--
-- detect_manufactured_negatives() full-scans ~66 tables x 18 columns, which is far
-- too slow to call from a request path (it times out through PostgREST). Per the
-- dashboard-first rule the state lives in Postgres and is refreshed on a schedule;
-- CI and the dashboard read the cheap table, not the expensive scan.
create table if not exists public.mon_safety_barrier_state (
  id                  integer primary key default 1,
  checked_at          timestamptz not null default now(),
  manufactured_pairs  integer     not null,
  default_columns     integer     not null,
  rnpl_yes            integer     not null,
  rnpl_no             integer     not null,
  rnpl_unknown        integer     not null,
  detail              jsonb       not null default '[]'::jsonb,
  constraint mon_safety_barrier_state_singleton check (id = 1)
);

comment on table public.mon_safety_barrier_state is
  'Field-level Safety Barrier health. manufactured_pairs and default_columns MUST both be 0; rnpl_unknown MUST be > 0 (the column has to stay able to say "the source never told us").';

create or replace function public.refresh_safety_barrier_state()
returns public.mon_safety_barrier_state
language plpgsql as $$
declare r public.mon_safety_barrier_state;
begin
  insert into public.mon_safety_barrier_state as m
    (id, checked_at, manufactured_pairs, default_columns, rnpl_yes, rnpl_no, rnpl_unknown, detail)
  select 1, now(),
    (select count(*) from public.detect_manufactured_negatives()),
    (select count(*) from public.detect_boolean_column_defaults()),
    (select count(*) from public.search_listings_ar
      where deal_ar='إيجار' and rent_period_ar='سنوي' and type_ar='شقة' and production_ready and rent_now_pay_later is true),
    (select count(*) from public.search_listings_ar
      where deal_ar='إيجار' and rent_period_ar='سنوي' and type_ar='شقة' and production_ready and rent_now_pay_later is false),
    (select count(*) from public.search_listings_ar
      where deal_ar='إيجار' and rent_period_ar='سنوي' and type_ar='شقة' and production_ready and rent_now_pay_later is null),
    coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'col', col, 'n_false', n_false))
              from public.detect_manufactured_negatives()), '[]'::jsonb)
  on conflict (id) do update set
    checked_at = excluded.checked_at,
    manufactured_pairs = excluded.manufactured_pairs,
    default_columns = excluded.default_columns,
    rnpl_yes = excluded.rnpl_yes,
    rnpl_no = excluded.rnpl_no,
    rnpl_unknown = excluded.rnpl_unknown,
    detail = excluded.detail
  returning m.* into r;
  return r;
end $$;

comment on function public.refresh_safety_barrier_state() is
  'Recomputes the Safety Barrier tripwires into mon_safety_barrier_state. Expensive (full attribute scan) - run on a schedule, never in a request path.';

grant select on public.mon_safety_barrier_state to anon;
