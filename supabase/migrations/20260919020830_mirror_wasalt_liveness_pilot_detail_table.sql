-- MIRROR ONLY — a no-op against production, which has had this table since the wasalt liveness
-- pilot. It exists to close a real drift that verify-committed-sql-defines-what-it-calls surfaced
-- on 2026-09-19: `public.wasalt_liveness_pilot_detail` is REFERENCED by nine committed migrations
-- (20260812113726, 20260822072606, 20260831003901, the five served_despite_direct_404_* versions,
-- and 20260913171949) and CREATED by none of them. The table was only ever created directly in
-- production, so a rebuild from git would produce a database where all nine of those migrations
-- reference an object that does not exist.
--
-- It went unnoticed because those nine all reference it as `from public.wasalt_liveness_pilot_detail d`,
-- which the barrier does not read as a call. Migration 20260919010944 was the first committed SQL
-- to write to it (`insert into public.wasalt_liveness_pilot_detail (...)`), and that parses as one.
-- The trigger was a parser shape; the DRIFT is real and predates it.
--
-- DDL captured from production the same day: 9 columns, bigserial pk, run_at defaulting to now(),
-- RLS enabled with NO policies (so only service_role, which bypasses RLS, can reach it).
create table if not exists public.wasalt_liveness_pilot_detail (
    id                   bigserial primary key,
    run_at               timestamptz not null default now(),
    tbl                  text        not null,
    listing_id           bigint      not null,
    head_status          integer,
    get_status           integer,
    get_verdict          text        not null,
    has_property_details boolean,
    nbytes               integer
);

alter table public.wasalt_liveness_pilot_detail enable row level security;
