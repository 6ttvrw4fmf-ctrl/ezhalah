-- Follow-up to 20260923232344, found by MEASURING the function I had just installed rather than
-- by trusting that it was cheap. `select count(*) from public.ops_cron_start_instants()` took
-- 42,372 ms. The detector calls it TWICE, so the version shipped minutes earlier would have added
-- ~85 s to every 30-minute sweep — and sweep duration is a direct term in P0 delivery latency
-- (docs/ops/SYSTEMS_SEAM_ENGINEER.md: alert_event.created_at is transaction start, so the whole
-- sweep runtime is spent before dispatch begins; 5 of 48 sweeps already forecast a breach at
-- 332 s). Fixing a blind detector by making the P0 lane slower is not a fix.
--
-- ROOT CAUSE: the `w` CTE regex-scans every pg_proc body in the public schema, and it is
-- referenced exactly once — from a CORRELATED subquery inside `j`. Postgres therefore inlined it
-- and re-executed the whole scan once per cron job: `Rows Removed by Filter: 563` × 81 job rows.
-- Nothing about the logic was wrong; the plan was.
--
-- FIX: `as materialized` on both CTEs, which is an optimizer fence — `w` is computed once (9 rows)
-- and `j` once per job (81 rows, each doing a 9-row CTE scan). Measured after: **13.7 ms**, a
-- 3,090× improvement, with byte-identical output. The predicate, the thresholds, the fail-open
-- clauses and the writer discovery are all unchanged; only the evaluation strategy moved.
--
-- The general lesson, which is this routine's own beat: a set-returning helper published for reuse
-- is a SEAM. Its cost becomes every caller's cost, and a correlated reference to a CTE that scans
-- catalogs is the cheap-looking shape that multiplies. Measure a new helper against the budget of
-- the job that will call it, in the same run that installs it.

create or replace function public.ops_cron_start_instants()
returns table(jobid bigint, jobname text, schedule text, hour int, minute int, writer_fn text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with w as materialized (
    -- Functions that TAKE the single-writer lock. The trailing `(` is the discriminator: a
    -- predicate on the bare name also matches search_index_writer_lock itself and every detector
    -- whose body merely names it, which is how a sibling check once matched itself (#3511).
    -- MATERIALIZED is load-bearing, not styling: see this migration's header.
    select p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosrc ~ 'search_index_writer_lock\s*\('
       and p.proname <> 'search_index_writer_lock'
       and p.proname !~ '^mon_detect'
  ),
  j as materialized (
    select c.jobid,
           c.jobname,
           c.schedule,
           split_part(c.schedule, ' ', 1) as mf,
           split_part(c.schedule, ' ', 2) as hf,
           (select string_agg(w.proname, ',' order by w.proname)
              from w
             where position(w.proname || '(' in c.command) > 0) as writer_fn
      from cron.job c
     where c.active
  ),
  m as (
    select j.*, g.minute
      from j cross join generate_series(0, 59) g(minute)
     where (j.mf = '*')
        or (j.mf ~ '^\d+$' and g.minute = j.mf::int)
        or (j.mf ~ '^\d+(,\d+)+$' and g.minute::text = any(string_to_array(j.mf, ',')))
        or (j.mf ~ '^\*/\d+$' and g.minute % split_part(j.mf, '/', 2)::int = 0)
        or (j.mf ~ '^\d+-\d+(/\d+)?$'
            and g.minute >= split_part(j.mf, '-', 1)::int
            and g.minute <= split_part(split_part(j.mf, '-', 2), '/', 1)::int
            and (g.minute - split_part(j.mf, '-', 1)::int)
                % coalesce(nullif(split_part(j.mf, '/', 2), ''), '1')::int = 0)
        -- FAIL OPEN: a minute field in none of the shapes above occupies EVERY minute.
        or (j.mf !~ '^(\*|\d+(,\d+)*|\*/\d+|\d+-\d+(/\d+)?)$')
  )
  select m.jobid, m.jobname, m.schedule, h.hour, m.minute, m.writer_fn
    from m cross join generate_series(0, 23) h(hour)
   where (m.hf = '*')
      or (m.hf ~ '^\d+$' and h.hour = m.hf::int)
      or (m.hf ~ '^\d+(,\d+)+$' and h.hour::text = any(string_to_array(m.hf, ',')))
      or (m.hf ~ '^\*/\d+$' and h.hour % split_part(m.hf, '/', 2)::int = 0)
      or (m.hf ~ '^\d+-\d+(/\d+)?$'
          and h.hour >= split_part(m.hf, '-', 1)::int
          and h.hour <= split_part(split_part(m.hf, '-', 2), '/', 1)::int
          and (h.hour - split_part(m.hf, '-', 1)::int)
              % coalesce(nullif(split_part(m.hf, '/', 2), ''), '1')::int = 0)
      -- FAIL OPEN: an hour field in none of the shapes above occupies EVERY hour. This is the
      -- clause whose ABSENCE was ops_incident #389.
      or (m.hf !~ '^(\*|\d+(,\d+)*|\*/\d+|\d+-\d+(/\d+)?)$')
$$;