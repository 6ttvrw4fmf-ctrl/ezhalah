-- LIVE SEARCH & MATCHING SWEEP — rotation + recording (owner 2026-08-23).
--
-- The 16 static barriers added by the hardening pass assert against SOURCE and the DB. They cannot
-- see what a real browser renders, so the owner made the live browser sweep a permanent layer of the
-- Senior Search & Matching routine. These two functions are its bookkeeping:
--
--   ops_qa_sweep_plan()      — what to test THIS run. Returns the STALEST keys per dimension so the
--                              sweep rotates instead of re-testing Riyadh every night.
--   ops_qa_record_coverage() — write back what was actually tested and how it went.
--
-- SECURITY DEFINER + anon so the scheduled workflow needs only the public anon key (repo rule:
-- verify via the anon key, never the service role). This table is pure QA bookkeeping — no listing
-- data, no PII — and the writer validates/caps every field so an anon caller cannot bloat it.

create or replace function public.ops_qa_sweep_plan(
  p_dimension text default null,
  p_limit int default 20
) returns table(dimension text, key text, last_tested_at timestamptz, times_tested int, staleness_days numeric)
language sql stable security definer set search_path to 'public' as $$
  select l.dimension, l.key, l.last_tested_at, l.times_tested,
         round(extract(epoch from (now() - coalesce(l.last_tested_at, 'epoch'::timestamptz))) / 86400.0, 1)
  from public.ops_qa_coverage_ledger l
  where (p_dimension is null or l.dimension = p_dimension)
  -- stalest first, then least-tested: an untested key outranks one covered last night.
  order by coalesce(l.last_tested_at, 'epoch'::timestamptz) asc, l.times_tested asc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

create or replace function public.ops_qa_record_coverage(
  p_dimension text,
  p_key text,
  p_result text default 'pass',
  p_notes text default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_dim text; v_key text;
begin
  -- Validate + cap. An anon caller may only append ordinary bookkeeping, never oversized blobs.
  v_dim := nullif(btrim(p_dimension), '');
  v_key := nullif(btrim(p_key), '');
  if v_dim is null or v_key is null then
    raise exception 'ops_qa_record_coverage: dimension and key are required';
  end if;
  if length(v_dim) > 80 or length(v_key) > 200 then
    raise exception 'ops_qa_record_coverage: dimension/key too long';
  end if;
  if coalesce(p_result, '') not in ('pass', 'fail', 'skip', '') then
    raise exception 'ops_qa_record_coverage: result must be pass | fail | skip';
  end if;

  insert into public.ops_qa_coverage_ledger as l (dimension, key, first_tested_at, last_tested_at, times_tested, last_result, notes)
  values (v_dim, v_key, now(), now(), 1, coalesce(nullif(p_result, ''), 'pass'), left(coalesce(p_notes, ''), 500))
  on conflict (dimension, key) do update
    set last_tested_at = now(),
        times_tested   = l.times_tested + 1,
        last_result    = coalesce(nullif(excluded.last_result, ''), l.last_result),
        notes          = left(coalesce(excluded.notes, l.notes), 500);
end $$;

grant execute on function public.ops_qa_sweep_plan(text, int) to anon;
grant execute on function public.ops_qa_record_coverage(text, text, text, text) to anon;
