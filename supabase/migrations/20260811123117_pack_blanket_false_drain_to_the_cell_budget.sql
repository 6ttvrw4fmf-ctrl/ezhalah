-- Builds directly on 20260811111532 (concurrent session, 11:15) — its diagnosis and its 25,000-cell
-- cap are both correct and are preserved here unchanged. Only the batching shape changes.
--
-- THE PROBLEM: the drain returned after the FIRST (table, column) pair it repaired, so one
-- five-minute cron slot was spent no matter how small that pair was. Measured 2026-08-11 12:28Z:
--     128 pairs / 453,758 cells remaining
--     100 of those pairs hold FEWER THAN 1,000 cells — 13,446 cells total, 3% of the work,
--     but under one-pair-per-invocation they consume 100 slots = 8.3 HOURS
--     packed to the 25,000-cell cap the whole backlog is 19 invocations
-- So the finish line was ~11 hours away for work the database does in about two seconds: every
-- invocation so far has completed in 0.1s against a 120s statement timeout.
--
-- That mattered for more than tidiness. CI reads the MATERIALISED snapshot
-- (mon_safety_barrier_state, refreshed on cron), and the snapshot was last written at 09:59 —
-- BEFORE 20260811111532 widened barrier_attribute_columns(). So the barrier was reporting
-- manufactured_pairs = 0 while 453,758 manufactured cells sat in production: green CI on a stale
-- reading, which is the "always red carries no signal" failure of 2026-08-08 wearing the opposite
-- mask. Draining fast enough that the next refresh is honestly 0 is the fix.
--
-- WHAT IS NOT CHANGED: the >=1 `true` guard (a platform that publishes a real positive is never
-- touched), the repair target (NULL, never a value), the 25,000-cell ceiling per invocation that
-- exists because the 2026-08-10 outage was a single 849k-cell statement, and the self-terminating
-- property (nothing left to repair => zero rows touched, zero rows returned).
create or replace function public.repair_blanket_false_batch(p_limit integer default 25000)
returns table(tbl text, col text, cells bigint)
language plpgsql
as $function$
declare t text; c text; n bigint; v_true bigint; budget bigint := p_limit;
begin
  for t, c in
    select ic.table_name, ic.column_name
      from information_schema.columns ic
     where ic.table_schema = 'public' and ic.table_name like '%\_listings'
       and ic.column_name = any(public.barrier_attribute_columns())
       and ic.table_name not like '%backup%'
     order by ic.table_name, ic.column_name
  loop
    exit when budget <= 0;                    -- the cell ceiling, enforced across the whole call

    -- only when the platform never publishes a TRUE for this column anywhere (unchanged)
    execute format('select count(*) filter (where %I) from public.%I', c, t) into v_true;
    continue when v_true > 0;

    execute format($f$
      update public.%I set %I = null
       where ctid in (select ctid from public.%I where %I is false limit %s)
    $f$, t, c, t, c, budget);
    get diagnostics n = row_count;

    if n > 0 then
      tbl := t; col := c; cells := n; return next;
      budget := budget - n;                   -- keep going into the next pair with what is left
    end if;
  end loop;
end
$function$;

comment on function public.repair_blanket_false_batch(int) is
  'Repairs manufactured negatives (a column false everywhere with no true anywhere on the platform) '
  'to NULL, at most p_limit CELLS per invocation across as many (table,column) pairs as that budget '
  'covers. Packing added 2026-08-11: returning after the first pair spent a whole cron slot on as '
  'few as 9 cells (100 of 128 pairs held <1,000), putting the backlog ~11h out for ~2s of DB work. '
  'Self-terminating: nothing to repair => no rows touched.';

do $selftest$
declare
  v_cells bigint;
  v_pairs int;
  v_aqar_true_before bigint;
  v_aqar_true_after bigint;
begin
  -- CONTROL: aqar genuinely publishes these four concepts and has real `true` values. It must be
  -- untouched by any drain, forever — that guard is the only thing separating a repair from a sweep.
  select count(*) filter (where apartment_in_project) into v_aqar_true_before
    from public.aqar_residential_listings;
  if v_aqar_true_before = 0 then
    raise exception 'precondition void: aqar has no apartment_in_project=true to use as a control';
  end if;

  -- the cell ceiling must hold ACROSS pairs, not per pair — this is the whole point of the change
  select coalesce(sum(cells),0), count(*) into v_cells, v_pairs
    from public.repair_blanket_false_batch(500);
  if v_cells > 500 then
    raise exception 'cell ceiling breached: % cells returned for a 500-cell budget', v_cells;
  end if;

  select count(*) filter (where apartment_in_project) into v_aqar_true_after
    from public.aqar_residential_listings;
  if v_aqar_true_after <> v_aqar_true_before then
    raise exception 'CONTROL LOST: aqar apartment_in_project true went % -> %',
      v_aqar_true_before, v_aqar_true_after;
  end if;

  raise notice 'packed drain ok: % cells across % pair(s) for a 500-cell budget; aqar controls intact at %',
    v_cells, v_pairs, v_aqar_true_after;
end $selftest$;
