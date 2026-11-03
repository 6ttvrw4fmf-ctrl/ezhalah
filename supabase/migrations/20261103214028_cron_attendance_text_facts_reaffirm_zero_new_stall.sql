-- Four monitoring defects, one root each (cron-and-monitoring group, 2026-11-03).
--
-- 1. cron_health limb 5 (ATTENDANCE) judged a job's last 24 h against a schedule it did not have.
--    ops_cron_job_first_seen.schedule_changed_at was already stamped by this very function, and limb 3's
--    grace already respects it, but limb 5 passed only first_seen_at to mon_cron_attendance_expected()
--    and counted runs over a flat 24 h. Measured: gh-facts-words-nightly (jobid 188) went daily ->
--    hourly ':25' (~01:25) -> hourly ':01' (stamped 10:59) and raised cron_absent:188 (18 of 24) although
--    it had started every run due under each schedule. Fix: both the expected count and the actual count
--    start at greatest(first_seen_at, schedule_changed_at, now()-24h). A job whose schedule did not change
--    is judged exactly as before, so a genuinely dropped run still raises.
--
-- 2. mon-text-facts (jobid 189) was killed by statement_timeout. Its runtime doubled daily (30 s -> 38 ->
--    76 -> 127 -> killed) because facts_ai_is_read() looks up listing_facts by (platform, listing_key)
--    and must walk every word-checker row of that key before it finds an AI row: each nightly word run
--    adds ~1 row per key per fact (gathern sample: 47 word-checker rows per key vs 2 AI rows), so the
--    cost grows with the NUMBER OF RUNS, without bound. And section 8 called ops_ai_facts_unread_new()
--    twice whenever it raised (the abort came from the second pass). Fix: one pass into d, and a partial
--    index over the AI rows only (built CONCURRENTLY by a one-shot pg_cron job outside the 21-23 UTC heavy
--    window — a 4.5 GB heap cannot be indexed inside a migration transaction without blocking the writer).
--    The detector now also raises when that index is missing or invalid, so the dependency cannot rot
--    silently. The picker facts_ai_todo_ids() uses the same predicate and gains the same index.
--
-- 3. alert_reaffirmation: seven detectors guarded mon_raise() with `elsif not v_open then`, so an open
--    alert was never re-affirmed (pin_coverage_below_floor: last_affirmed_at NULL since it was raised).
--    mon_raise() already dedups; the guard is replaced by a plain `else` so the raise runs whenever the
--    condition is true. Nothing else in those bodies changes.
--
-- 4. zero_new_stall:aqaralsaudia stood open (last affirmed 2026-09-27) with a false condition: the
--    detector resolves only on two arms, and a platform whose prior fortnight has < 10 new listings runs
--    neither, so its key could never be closed or re-checked. Every key the run does not raise is now
--    resolved through mon_resolve_stale_keys(), the same evaluated-path sweep other detectors use.

do $mig$
declare
  d text;
  fn text;
  k int;
begin
  ---------------------------------------------------------------------------------------------------
  -- 1. mon_detect_cron_health limb 5
  ---------------------------------------------------------------------------------------------------
  d := pg_get_functiondef('public.mon_detect_cron_health()'::regprocedure);
  if position($a$public.mon_cron_attendance_expected(j.schedule, s.first_seen_at, now()) as expected_24h,$a$ in d) = 0
     or position($a$and d.start_time > now() - interval '24 hours')::int as actual_24h$a$ in d) = 0 then
    raise exception 'mon_detect_cron_health: limb-5 anchors not found — body changed, refusing to patch';
  end if;
  d := replace(d,
    $a$public.mon_cron_attendance_expected(j.schedule, s.first_seen_at, now()) as expected_24h,$a$,
    $a$public.mon_cron_attendance_expected(j.schedule, greatest(s.first_seen_at, s.schedule_changed_at), now()) as expected_24h,$a$);
  d := replace(d,
    $a$and d.start_time > now() - interval '24 hours')::int as actual_24h$a$,
    $a$and d.start_time > greatest(now() - interval '24 hours', s.first_seen_at, s.schedule_changed_at))::int as actual_24h$a$);
  execute d;

  ---------------------------------------------------------------------------------------------------
  -- 2. mon_detect_text_facts section 8: one pass; plus the read-index self-check
  ---------------------------------------------------------------------------------------------------
  d := pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure);
  if position($a$  select count(*) into n from public.ops_ai_facts_unread_new() g
   where g.failed is not null or (g.unread >= 25 and g.unread >= 0.05 * g.window_ads);$a$ in d) = 0
     or position($a$'detail', (select jsonb_agg(to_jsonb(g)) from public.ops_ai_facts_unread_new() g),$a$ in d) = 0
     or array_length(string_to_array(d, $a$  -- 5. the nightly reader
$a$), 1) - 1 <> 1 then
    raise exception 'mon_detect_text_facts: section-8 anchors not found — body changed, refusing to patch';
  end if;
  d := replace(d,
    $a$  select count(*) into n from public.ops_ai_facts_unread_new() g
   where g.failed is not null or (g.unread >= 25 and g.unread >= 0.05 * g.window_ads);$a$,
    $a$  select count(*) filter (where g.failed is not null or (g.unread >= 25 and g.unread >= 0.05 * g.window_ads)),
         jsonb_agg(to_jsonb(g))
    into n, d
    from public.ops_ai_facts_unread_new() g;   -- ONE pass: the second pass is what timed out (2026-11-03)$a$);
  d := replace(d,
    $a$'detail', (select jsonb_agg(to_jsonb(g)) from public.ops_ai_facts_unread_new() g),$a$,
    $a$'detail', d,$a$);
  d := replace(d, $a$  -- 5. the nightly reader
$a$, $a$  -- 9. the AI-read lookup stays index-backed. Without listing_facts_ai_read_idx facts_ai_is_read() walks every
  -- word-checker row of a key, a cost that grows with every nightly run until this job and the picker time out.
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'listing_facts_ai_read_idx' and i.indisvalid and i.indisready) then
    r := r + public.mon_raise('P2', 'ai_facts_read_index_missing', 'all', 'ai_facts_read_index_missing',
      jsonb_build_object('for', '🔧', 'why',
        'listing_facts_ai_read_idx is missing or INVALID, so every facts_ai_is_read() call scans all word-checker rows of its key. mon-text-facts and the facts-extract picker slow down with every nightly run until they are killed by statement_timeout (2026-11-03).',
        'action', 'create index concurrently if not exists listing_facts_ai_read_idx on public.listing_facts (platform, listing_key, text_hash) where model not like ''word-checker%'' -- from a session with no statement_timeout; drop an INVALID copy first. Never raise the job timeout instead.'));
  else
    perform public.mon_resolve('ai_facts_read_index_missing', 'all');
  end if;
  -- 5. the nightly reader
$a$);
  execute d;

  ---------------------------------------------------------------------------------------------------
  -- 3. seven detectors: raise whenever the condition is true
  ---------------------------------------------------------------------------------------------------
  foreach fn in array array['mon_detect_district_carries_ad_block_text', 'mon_detect_district_guards_missing',
                            'mon_detect_district_served_twins', 'mon_detect_haraj_stated_age_not_stored',
                            'mon_detect_pin_coverage_below_floor', 'mon_detect_pin_district_unvouched',
                            'mon_detect_place_list_leaks'] loop
    d := pg_get_functiondef(('public.' || fn || '()')::regprocedure);
    k := array_length(string_to_array(d, 'elsif not v_open then'), 1) - 1;
    if k < 1 then
      raise exception '%: no `elsif not v_open then` guard found — body changed, refusing to patch', fn;
    end if;
    execute replace(d, 'elsif not v_open then', 'else');
  end loop;

  ---------------------------------------------------------------------------------------------------
  -- 4. mon_detect_zero_new_stall: a key whose condition is no longer true is resolved
  ---------------------------------------------------------------------------------------------------
  d := pg_get_functiondef('public.mon_detect_zero_new_stall()'::regprocedure);
  if position($a$declare rec record; n int := 0; v_cov numeric; v_fire boolean;$a$ in d) = 0
     or array_length(string_to_array(d, $a$        n := n + public.mon_raise('P1','zero_new_stall', rec.platform,$a$), 1) - 1 <> 1
     or array_length(string_to_array(d, $a$  return n;
end$a$), 1) - 1 <> 1 then
    raise exception 'mon_detect_zero_new_stall: anchors not found — body changed, refusing to patch';
  end if;
  d := replace(d, $a$declare rec record; n int := 0; v_cov numeric; v_fire boolean;$a$,
                  $a$declare rec record; n int := 0; v_cov numeric; v_fire boolean; live text[] := '{}';$a$);
  d := replace(d, $a$        n := n + public.mon_raise('P1','zero_new_stall', rec.platform,$a$,
                  $a$        live := live || ('zero_new_stall:' || rec.platform);
        n := n + public.mon_raise('P1','zero_new_stall', rec.platform,$a$);
  d := replace(d, $a$  return n;
end$a$, $a$  -- Every key this run did not raise has a false condition — including a platform whose prior
  -- fortnight fell under the >= 10 floor (neither arm above runs for it) or that left the loop. Without
  -- this, zero_new_stall:aqaralsaudia sat open from 2026-09-27 with nothing able to re-check or close it.
  perform public.mon_resolve_stale_keys('zero_new_stall', live);
  return n;
end$a$);
  execute d;
end $mig$;

-- The index build, outside the migration transaction and outside the 21:00-23:00 UTC heavy window.
-- CREATE INDEX CONCURRENTLY cannot run in a transaction block; pg_cron sends a single-statement command
-- on its own connection, so it can. The cleanup job drops an INVALID leftover (a failed concurrent build
-- leaves one that every write still maintains) and removes both one-shot jobs; mon_detect_text_facts
-- section 9 raises if the index is still not valid afterwards.
select cron.schedule('tmp-listing-facts-ai-read-idx', '55 23 3 11 *',
  $c$create index concurrently if not exists listing_facts_ai_read_idx on public.listing_facts (platform, listing_key, text_hash) where model not like 'word-checker%'$c$);

select cron.schedule('tmp-listing-facts-ai-read-idx-cleanup', '36 1 4 11 *',
  $c$do $x$ begin
  if exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
              where c.relname = 'listing_facts_ai_read_idx' and not i.indisvalid) then
    execute 'drop index public.listing_facts_ai_read_idx';
  end if;
  perform cron.unschedule(j.jobid) from cron.job j
   where j.jobname in ('tmp-listing-facts-ai-read-idx', 'tmp-listing-facts-ai-read-idx-cleanup');
end $x$$c$);
