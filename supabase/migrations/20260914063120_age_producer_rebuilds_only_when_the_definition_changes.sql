-- AN HOURLY NO-OP DDL ON A VIEW IN THE CORE READ PATH (routine #2, 2026-09-14).
--
-- pg_cron jobid 46 (rebuild-age-producer, '44 * * * *') calls rebuild_age_producer(), which ended in an
-- UNCONDITIONAL `CREATE OR REPLACE VIEW public.listing_age_resolved`. That view is depended on by
-- public.listing_native_location_v2 -- the view the search-index sync, the result-card path and a dozen
-- monitors read. CREATE OR REPLACE VIEW takes AccessExclusiveLock, and Postgres queues lock requests: a
-- rebuild that arrives while any reader holds AccessShareLock waits, and every reader that arrives after it
-- waits behind it too. So one slow reader turned an hourly bookkeeping job into a stall on the core read path.
--
-- Measured before this change:
--   * the rebuild was a NO-OP. The desired part-set (age_source_registry x age_source_health()) is 22 arms;
--     the live view already contained exactly those 22 -- set difference 0 in BOTH directions. So the
--     exclusive lock was being taken ~24x/day to write back a byte-identical definition.
--   * jobid 46's work is ~2s (median 2.0s, age_source_health() alone 363ms, max successful 18.6s over 7d).
--   * 2026-09-13 10:44:00Z the job ABORTED at 131.0s -- 65x the median -- on
--     `canceling statement due to statement timeout`, with the CREATE OR REPLACE VIEW named as the failing
--     statement. Compute cannot explain 131s for 2s of work; a lock wait can, and the command set no
--     lock_timeout, so the DDL sat in the queue burning the full 120s statement budget with readers behind it.
--   * CONFIRMED LIVE while applying this migration: a first attempt whose seeding step issued the DDL under
--     the new 5s lock_timeout failed with 55P03 `canceling statement due to lock timeout`. The lock really
--     is contended in normal operation. That attempt rolled back whole; this version needs no exclusive lock.
--
-- Three changes, all narrow:
--   1. The generation is lifted into age_producer_desired_sql() so the producer and this migration's seed
--      cannot disagree about what the definition should be -- one generator, two callers.
--   2. REBUILD ONLY WHEN THE DEFINITION ACTUALLY CHANGES. The DDL is skipped when the generated SQL is
--      unchanged AND the live view still matches what we last wrote. Both halves matter: the first catches
--      "the registry did not move", the second refuses to skip if anything changed the view out of band.
--      The resulting view definition is identical either way -- this changes WHEN the lock is taken, never
--      what the view says.
--   3. lock_timeout = 5s around the DDL. A rebuild that cannot get the lock now fails in 5s instead of
--      holding the queue for 120s. It is deliberately NOT caught: the job goes red (cron_health sees it)
--      and the detector below independently reports that the view is stale within 30 minutes. A silent
--      "deferred" return would be exactly the dark-monitor shape this repo has been burned by.
--
-- NOT touched: the cron schedule and command (a schedule change is owner-only), the view's definition, the
-- registry, and age_source_health(). No listing data is read or written by this migration, and it takes no
-- lock stronger than AccessShare.

create table if not exists public.ops_age_producer_rebuild (
  id                 boolean primary key default true check (id),
  last_generated_md5 text        not null,
  last_viewdef_md5   text        not null,
  last_rebuilt_at    timestamptz not null default now(),
  last_skipped_at    timestamptz,
  skipped_runs       bigint      not null default 0
);

comment on table public.ops_age_producer_rebuild is
  'One row. Lets rebuild_age_producer() skip its CREATE OR REPLACE VIEW when nothing changed, so an '
  'AccessExclusiveLock is not taken hourly on a view listing_native_location_v2 depends on. '
  'last_viewdef_md5 is the guard against skipping over an out-of-band change to the view.';

-- ---------------------------------------------------------------------------------------------------
-- 1. The generator, extracted. Pure: builds the SQL, executes nothing, locks nothing.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.age_producer_desired_sql()
returns jsonb
language plpgsql
as $function$
DECLARE
  parts text[] := '{}';
  included text[] := '{}';
  r record;
BEGIN
  -- canonical_column: read the smallint column directly; gated by the data-driven health verdict.
  FOR r IN
    SELECT reg.source_table, h.n_aged
    FROM age_source_registry reg
    JOIN public.age_source_health() h ON h.source_table = reg.source_table
    WHERE reg.strategy = 'canonical_column' AND reg.trusted = true AND h.verdict = 'ok'
    ORDER BY reg.source_table
  LOOP
    parts := parts || format(
      'SELECT %L::text AS source_table, id AS listing_id, property_age
         FROM public.%I WHERE active AND property_age BETWEEN 0 AND 100',
      r.source_table, r.source_table);
    included := included || (r.source_table || '(' || r.n_aged || ')');
  END LOOP;

  -- jsonb_text: extract from additional_info->>jsonb_key through the shared strict parser; unmapped -> NULL.
  FOR r IN
    SELECT reg.source_table, reg.jsonb_key
    FROM age_source_registry reg
    WHERE reg.strategy = 'jsonb_text' AND reg.trusted = true AND reg.jsonb_key IS NOT NULL
    ORDER BY reg.source_table
  LOOP
    parts := parts || format(
      'SELECT %L::text AS source_table, id AS listing_id,
              public.age_from_text_ar(additional_info->>%L) AS property_age
         FROM public.%I
        WHERE active AND jsonb_typeof(additional_info) = ''object''
          AND public.age_from_text_ar(additional_info->>%L) BETWEEN 0 AND 100',
      r.source_table, r.jsonb_key, r.source_table, r.jsonb_key);
    included := included || (r.source_table || '(jsonb:' || r.jsonb_key || ')');
  END LOOP;

  -- from_extra_attrs: reuse listing_extra_attrs's proven, scrape-proof parse (for bespoke additional_info
  -- shapes it already handles, e.g. wasalt's {key,value} array completionYear).
  FOR r IN
    SELECT reg.source_table
    FROM age_source_registry reg
    WHERE reg.strategy = 'from_extra_attrs' AND reg.trusted = true
    ORDER BY reg.source_table
  LOOP
    parts := parts || format(
      'SELECT %L::text AS source_table, listing_id, property_age
         FROM public.listing_extra_attrs
        WHERE source_table = %L AND property_age BETWEEN 0 AND 100',
      r.source_table, r.source_table);
    included := included || (r.source_table || '(extra_attrs)');
  END LOOP;

  IF array_length(parts,1) IS NULL THEN
    parts := ARRAY['SELECT NULL::text AS source_table, NULL::bigint AS listing_id, NULL::smallint AS property_age WHERE false'];
  END IF;

  RETURN jsonb_build_object(
    'sql', 'CREATE OR REPLACE VIEW public.listing_age_resolved AS ' || array_to_string(parts, ' UNION ALL '),
    'included', to_jsonb(included),
    'n', coalesce(array_length(included,1),0));
END $function$;

-- ---------------------------------------------------------------------------------------------------
-- 2. The producer: same view, rebuilt only when it would differ.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.rebuild_age_producer()
returns text
language plpgsql
as $function$
DECLARE
  v_gen       jsonb := public.age_producer_desired_sql();
  v_sql       text  := v_gen ->> 'sql';
  v_gen_md5   text  := md5(v_gen ->> 'sql');
  v_live_md5  text;
  v_state     public.ops_age_producer_rebuild;
  v_included  text;
BEGIN
  v_included := coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_gen -> 'included') t(x)), '(none)');

  -- Skip the DDL only when BOTH are true: we would generate the same SQL as last time, AND the live view
  -- is still exactly what that generation left behind. The second half is what makes the skip safe -- if
  -- anything replaced the view out of band, its digest moved and we rebuild rather than trusting a cache.
  IF to_regclass('public.listing_age_resolved') IS NOT NULL THEN
    v_live_md5 := md5(pg_get_viewdef('public.listing_age_resolved'::regclass, true));
    SELECT * INTO v_state FROM public.ops_age_producer_rebuild WHERE id;
    IF FOUND
       AND v_state.last_generated_md5 = v_gen_md5
       AND v_state.last_viewdef_md5   = v_live_md5 THEN
      UPDATE public.ops_age_producer_rebuild
         SET last_skipped_at = now(), skipped_runs = skipped_runs + 1
       WHERE id;
      RETURN 'listing_age_resolved unchanged (' || (v_gen ->> 'n')
             || ' source(s)) - DDL skipped, no AccessExclusiveLock taken';
    END IF;
  END IF;

  -- A rebuild that cannot get the lock promptly must fail fast rather than queue readers of
  -- listing_native_location_v2 behind it. Deliberately uncaught: red job + the drift detector below.
  PERFORM set_config('lock_timeout', '5s', true);
  EXECUTE v_sql;

  INSERT INTO public.ops_age_producer_rebuild (id, last_generated_md5, last_viewdef_md5, last_rebuilt_at)
  VALUES (true, v_gen_md5, md5(pg_get_viewdef('public.listing_age_resolved'::regclass, true)), now())
  ON CONFLICT (id) DO UPDATE
    SET last_generated_md5 = excluded.last_generated_md5,
        last_viewdef_md5   = excluded.last_viewdef_md5,
        last_rebuilt_at    = excluded.last_rebuilt_at;

  RETURN 'listing_age_resolved rebuilt from ' || (v_gen ->> 'n') || ' source(s): ' || v_included;
END $function$;

-- ---------------------------------------------------------------------------------------------------
-- 3. The independent oracle. Deliberately does NOT share the producer's md5 bookkeeping: it re-derives
--    what the view SHOULD contain from the registry and reads what it DOES contain out of the live
--    catalog. So if the skip in (2) is ever wrong, this is what says so.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.age_producer_view_drift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_def          text;
  v_want         text[];
  v_have         text[];
  v_want_arms    int;
  v_have_arms    int;
  v_missing_keys text[] := '{}';
  r              record;
begin
  if to_regclass('public.listing_age_resolved') is null then
    return jsonb_build_object('drift', true, 'reason', 'view_absent');
  end if;
  v_def := pg_get_viewdef('public.listing_age_resolved'::regclass, true);

  select array_agg(source_table order by source_table), count(*)
    into v_want, v_want_arms
  from (
    select reg.source_table
      from age_source_registry reg
      join public.age_source_health() h on h.source_table = reg.source_table
     where reg.strategy = 'canonical_column' and reg.trusted and h.verdict = 'ok'
    union all
    select reg.source_table from age_source_registry reg
     where reg.strategy = 'jsonb_text' and reg.trusted and reg.jsonb_key is not null
    union all
    select reg.source_table from age_source_registry reg
     where reg.strategy = 'from_extra_attrs' and reg.trusted
  ) w;
  v_want := coalesce(v_want, '{}');

  select array_agg(distinct t order by t) into v_have
  from (select (regexp_matches(v_def, '''([a-z0-9_]+)''::text AS source_table', 'g'))[1] as t) s;
  v_have := coalesce(v_have, '{}');

  -- one arm == one `AS source_table` alias in the rendered definition
  v_have_arms := (length(v_def) - length(replace(v_def, 'AS source_table', ''))) / length('AS source_table');

  -- a strategy can change without the table set changing, so each jsonb arm's key must still be present
  for r in select source_table, jsonb_key from age_source_registry
            where strategy = 'jsonb_text' and trusted and jsonb_key is not null loop
    if position(quote_literal(r.jsonb_key) in v_def) = 0 then
      v_missing_keys := v_missing_keys || (r.source_table || ':' || r.jsonb_key);
    end if;
  end loop;

  return jsonb_build_object(
    'drift', (select count(*) from (select unnest(v_want) except select unnest(v_have)) a) > 0
          or (select count(*) from (select unnest(v_have) except select unnest(v_want)) b) > 0
          or v_want_arms <> v_have_arms
          or array_length(v_missing_keys, 1) > 0,
    'want_arms', v_want_arms,
    'have_arms', v_have_arms,
    'only_in_registry', coalesce((select jsonb_agg(x) from (select unnest(v_want) except select unnest(v_have)) t(x)), '[]'::jsonb),
    'only_in_view',     coalesce((select jsonb_agg(x) from (select unnest(v_have) except select unnest(v_want)) t(x)), '[]'::jsonb),
    'missing_jsonb_keys', to_jsonb(v_missing_keys));
end $function$;

create or replace function public.mon_detect_age_producer_view_drift()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v jsonb;
begin
  v := public.age_producer_view_drift();
  if (v ->> 'drift')::boolean then
    return public.mon_raise('P2', 'age_producer_view_drift', 'all',
      'age_producer_view_drift',
      v || jsonb_build_object(
        'why', 'public.listing_age_resolved no longer matches what age_source_registry x '
            || 'age_source_health() say it should contain. property_age reaches the Advanced Filter '
            || 'through listing_native_location_v2, which depends on this view, so a stale definition '
            || 'means a platform''s ages are silently missing from (or wrongly present in) search.',
        'action', 'select public.rebuild_age_producer();  -- then re-read public.age_producer_view_drift(). '
            || 'If the rebuild is failing, check cron.job_run_details for jobid 46: a lock_timeout there '
            || 'means the DDL could not get AccessExclusiveLock and the view is genuinely stale.'));
  end if;
  perform public.mon_resolve_key('age_producer_view_drift', 'age_producer_view_drift');
  return 0;
end $function$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Roster the detector in the SAME migration (AGENTS.md: a detector nothing reaches is decoration,
--    and mon_detect_orphaned_detectors() fires on one). Edited by rewriting the live definition rather
--    than retyping 13KB of roster, with both directions asserted.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_def    text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  v_anchor text := 'array[' || chr(10) || '    ''mon_detect_rent_period_inferred_when_source_silent'',';
  v_new    text;
begin
  if position('mon_detect_age_producer_view_drift' in v_def) > 0 then
    raise notice 'already rostered';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'ROSTER ANCHOR NOT FOUND in mon_run_all_detectors() - refusing to guess where the array starts';
  end if;
  v_new := replace(v_def, v_anchor,
    'array[' || chr(10) || '    ''mon_detect_age_producer_view_drift'',' || chr(10)
             || '    ''mon_detect_rent_period_inferred_when_source_silent'',');
  if v_new = v_def then
    raise exception 'ROSTER EDIT WAS A NO-OP';
  end if;
  execute v_new;
  if position('mon_detect_age_producer_view_drift'
              in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'ROSTER EDIT DID NOT PERSIST';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Seed the state row WITHOUT issuing the DDL -- the view is already provably what the generator
--    produces (proven below), so there is nothing to rebuild and no exclusive lock to take. Then prove
--    the skip works, and prove BOTH directions of the oracle by EXECUTING it: clean on the real state,
--    firing on a perturbation applied and rolled back inside a subtransaction.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_gen  jsonb := public.age_producer_desired_sql();
  v_msg  text;
  v      jsonb;
  v_tbl  text;
begin
  -- The oracle must agree the live view already equals the generator's intent BEFORE we seed a digest
  -- that will let the producer skip. Seeding on a stale view would freeze the staleness in place.
  v := public.age_producer_view_drift();
  if (v ->> 'drift')::boolean then
    raise exception 'REFUSING TO SEED A SKIP DIGEST OVER A DRIFTED VIEW: %', v::text;
  end if;
  if (v ->> 'want_arms')::int = 0 then
    raise exception 'ORACLE IS VACUOUS: want_arms = 0, so it would pass over an empty view';
  end if;
  raise notice 'oracle clean before seed: want_arms=% have_arms=%', v ->> 'want_arms', v ->> 'have_arms';

  insert into public.ops_age_producer_rebuild (id, last_generated_md5, last_viewdef_md5, last_rebuilt_at)
  values (true, md5(v_gen ->> 'sql'),
          md5(pg_get_viewdef('public.listing_age_resolved'::regclass, true)), now())
  on conflict (id) do update
    set last_generated_md5 = excluded.last_generated_md5,
        last_viewdef_md5   = excluded.last_viewdef_md5,
        last_rebuilt_at    = excluded.last_rebuilt_at;

  -- the producer must now SKIP -- that is the whole point of this migration
  v_msg := public.rebuild_age_producer();
  if position('DDL skipped' in v_msg) = 0 then
    raise exception 'SKIP PROOF FAILED: the producer still issued the DDL (%)', v_msg;
  end if;
  raise notice 'skip proof: %', v_msg;

  -- direction B: the oracle FIRES when the registry and the view disagree. Real mutation, rolled back.
  begin
    select source_table into v_tbl from age_source_registry
     where trusted and strategy = 'jsonb_text' and jsonb_key is not null order by source_table limit 1;
    update age_source_registry set trusted = false where source_table = v_tbl;
    v := public.age_producer_view_drift();
    if not (v ->> 'drift')::boolean then
      raise exception 'MUTATION PROOF FAILED: dropping % from the registry did not register as drift (%)',
        v_tbl, v::text;
    end if;
    raise notice 'oracle fires on perturbation (%): %', v_tbl, v::text;
    raise exception 'ezhalah_rollback_mutation_proof';
  exception when others then
    if sqlerrm <> 'ezhalah_rollback_mutation_proof' then raise; end if;
  end;

  -- and the perturbation really is gone
  v := public.age_producer_view_drift();
  if (v ->> 'drift')::boolean then
    raise exception 'MUTATION PROOF DID NOT ROLL BACK: %', v::text;
  end if;
end $$;
