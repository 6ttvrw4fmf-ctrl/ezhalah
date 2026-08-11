-- Coverage ledger for the 🧪 Search & Matching QA Engineer (owner spec 2026-08-11, §39).
-- One row per (dimension, key): dimension = what kind of thing is covered (property_type, city,
-- district_combo, price_shape, sort_mode, journey, …), key = the specific value («شقة», «الرياض»,
-- 'multi_district_3', 'price_exact_boundary', …). The routine upserts after each test and reads
-- stalest-first to pick tomorrow's priorities, so random exploration can never leave the same
-- obscure نوع عقار untested for weeks. Postgres, not a file — every engineer/session sees the same
-- ledger (dashboard-first rule), and it survives any session.
create table if not exists public.ops_qa_coverage_ledger(
  dimension       text not null,
  key             text not null,
  first_tested_at timestamptz,
  last_tested_at  timestamptz,
  times_tested    int not null default 0,
  last_result     text,            -- PASS / BUG_FIXED / HONEST_ZERO / BLOCKED / …
  notes           text,
  primary key (dimension, key)
);

comment on table public.ops_qa_coverage_ledger is
  'Coverage ledger for the Search & Matching QA Engineer (docs/ops/SEARCH_MATCH_QA_ENGINEER.md §39). '
  'Upserted per tested (dimension, key); read stalest-first to prioritize tomorrow''s coverage. The '
  'daily report splits tested-today / tested-recently / not-yet-covered from this table.';

alter table public.ops_qa_coverage_ledger enable row level security;
do $$ begin
  create policy qa_ledger_read on public.ops_qa_coverage_ledger for select to anon using (true);
exception when duplicate_object then null; end $$;

-- Upsert helper so routine code stays one line per record.
create or replace function public.ops_qa_ledger_record(
  p_dimension text, p_key text, p_result text, p_notes text default null)
returns void language sql security definer set search_path to 'public' as $function$
  insert into public.ops_qa_coverage_ledger as l
    (dimension, key, first_tested_at, last_tested_at, times_tested, last_result, notes)
  values (p_dimension, p_key, now(), now(), 1, p_result, p_notes)
  on conflict (dimension, key) do update
    set last_tested_at = now(),
        times_tested   = l.times_tested + 1,
        last_result    = p_result,
        notes          = coalesce(p_notes, l.notes);
$function$;
