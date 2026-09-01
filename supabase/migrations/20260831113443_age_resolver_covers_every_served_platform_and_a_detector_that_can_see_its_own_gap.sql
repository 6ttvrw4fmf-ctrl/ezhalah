-- The age resolver's hand-maintained table list had fallen behind the platforms we actually serve,
-- and the detector that exists to catch discarded ages could not see it.
--
-- FOUND (routine #5, 2026-08-31, full platform x AF-field index-fidelity sweep):
-- 7 production_ready listings publish a plausible property_age in their own raw table (0, 0, 9, 3,
-- 1, 10, 10) while search_listings_ar serves NULL for them. Advanced Filter's property-age question
-- can therefore never reach those listings, and the tri-state law in
-- docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md calls that exact shape "trapping": a value the source DID
-- publish that stops upstream and never reaches the user.
--
-- ROOT CAUSE: listing_native_location_v2 takes property_age EXCLUSIVELY from listing_age_resolved,
-- which is a hand-written UNION ALL enumerating one block per source table. Three platforms had
-- their *_residential half added and their *_commercial half forgotten (aldarim, erapulse, mizlaj),
-- and eastabha was never added at all. Nothing about a missing block fails loudly -- the age simply
-- becomes NULL, which is indistinguishable from "the source didn't publish one".
--
-- WHY NO BARRIER CAUGHT IT: mon_detect_v2_discards_captured_attrs already watches for discarded
-- ages, but its oracle is listing_age_resolved itself --
--     join listing_age_resolved car on car.source_table = v.source_table ...
--     where car.property_age is not null and v.property_age is null
-- It can only see "the resolver HAS it and v2 dropped it". A table missing from the resolver
-- produces no row to join to, so the gap is invisible BY CONSTRUCTION and the detector reads green.
-- That is the same failure mode this repo has been burned by before: a monitor that cannot fire
-- reads as a clean bill of health.
--
-- THE FIX IS IN TWO PARTS, because the instance and the class are different problems:
--   1. Add the four omitted blocks, in the identical shape the existing flat-column blocks use
--      (active AND property_age between 0 and 100). No new semantics.
--   2. Add mon_detect_age_resolver_platform_gap(), whose oracle is the RAW upstream column rather
--      than the resolver -- so it can see a gap in the resolver itself. This is the half that
--      prevents the next platform from silently losing age.

begin;

-- ── 1. Extend listing_age_resolved ────────────────────────────────────────────────────────────
-- The existing definition is preserved BYTE-EXACTLY and only appended to: the new text is built
-- from pg_get_viewdef() rather than retyped, so this cannot silently alter an existing block.
do $mig$
declare
  cur text; addition text := ''; newdef text; t text;
  before_rows bigint; after_rows bigint; before_tabs int; after_tabs int;
  expected_add bigint := 0; c bigint; diffs bigint;
  missing text[] := array['aldarim_commercial_listings','eastabha_residential_listings',
                          'erapulse_commercial_listings','mizlaj_commercial_listings'];
begin
  create temp table _before_age on commit drop as
    select source_table, count(*) n from public.listing_age_resolved group by 1;
  select coalesce(sum(n),0), count(*) into before_rows, before_tabs from _before_age;

  cur := pg_get_viewdef('public.listing_age_resolved'::regclass, true);

  foreach t in array missing loop
    -- Idempotence + a guard against racing another session that added the table differently.
    if position(quote_literal(t) in cur) > 0 then
      raise exception 'PRECONDITION FAILED: listing_age_resolved already covers %', t;
    end if;
    execute format('select count(*) from public.%I where active and property_age >= 0 and property_age <= 100', t)
      into c;
    expected_add := expected_add + c;
    addition := addition || format(
      E'\nUNION ALL\n SELECT %L::text AS source_table,\n    %I.id AS listing_id,\n    %I.property_age\n   FROM %I\n  WHERE %I.active AND %I.property_age >= 0 AND %I.property_age <= 100',
      t, t, t, t, t, t, t);
  end loop;

  newdef := rtrim(cur, E' \n\t;') || addition;
  execute 'create or replace view public.listing_age_resolved as ' || newdef;

  create temp table _after_age on commit drop as
    select source_table, count(*) n from public.listing_age_resolved group by 1;
  select coalesce(sum(n),0), count(*) into after_rows, after_tabs from _after_age;

  select count(*) into diffs
    from _before_age b join _after_age a using (source_table) where a.n <> b.n;

  -- Fail closed on anything but the exact intended change.
  if after_rows - before_rows <> expected_add then
    raise exception 'row delta % <> expected %', after_rows - before_rows, expected_add;
  end if;
  if after_tabs <> before_tabs + 4 then
    raise exception 'source_table count % <> % + 4', after_tabs, before_tabs;
  end if;
  if diffs <> 0 then
    raise exception '% previously-covered tables changed row count', diffs;
  end if;

  raise notice 'listing_age_resolved: % -> % tables, +% rows', before_tabs, after_tabs, expected_add;
end
$mig$;

-- ── 2. The detector that can see a gap in the resolver ────────────────────────────────────────
create or replace function public.mon_detect_age_resolver_platform_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0; v_total bigint := 0; v_rows jsonb := '[]'::jsonb; v_open text;
  r record; c bigint; v_def text;
begin
  -- Oracle is the RAW upstream column, deliberately NOT listing_age_resolved: a detector whose
  -- oracle is the thing it audits cannot see that thing's own omissions (see header).
  v_def := pg_get_viewdef('public.listing_age_resolved'::regclass, true);

  for r in
    select c.table_name as st
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'property_age'
       and c.table_name in (select distinct source_table from public.search_listings_ar)
       and position(quote_literal(c.table_name) in v_def) = 0
  loop
    -- Only tables ALREADY missing from the resolver are scanned, so the healthy case costs nothing.
    execute format('select count(*) from public.%I where active and property_age >= 0 and property_age <= 100', r.st)
      into c;
    if c > 0 then
      v_total := v_total + c;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('source_table', r.st, 'published_ages', c));
    end if;
  end loop;

  select severity into v_open from public.alert_event
   where dedup_key = 'age_resolver_platform_gap' and resolved_at is null
   order by created_at desc limit 1;

  if v_total = 0 then
    if v_open is not null then
      perform public.mon_resolve_key('age_resolver_platform_gap', 'age_resolver_platform_gap');
    end if;
    return 0;
  end if;

  n := public.mon_raise('P2', 'age_resolver_platform_gap', 'all', 'age_resolver_platform_gap',
    jsonb_build_object(
      'trapped_rows', v_total,
      'tables', v_rows,
      'why', 'These source tables are SERVED in search_listings_ar and publish a plausible '
          || 'property_age (active, 0..100) in their own raw column, but listing_age_resolved has no '
          || 'block for them. listing_native_location_v2 takes property_age exclusively from that '
          || 'resolver, so the published age never reaches the search index and Advanced Filter can '
          || 'never match these listings on age. This is "trapping" under '
          || 'docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md: a value the source DID publish that stops '
          || 'upstream.',
      'adjudicate', 'Add one UNION ALL block per listed table to listing_age_resolved in the same '
          || 'shape as the existing flat-column blocks (active AND property_age between 0 and 100), '
          || 'then run sync_search_listings_ar(). Do NOT repair search_listings_ar rows by hand -- the '
          || 'next sync overwrites them. Do NOT silence this by nulling the raw column. '
          || 'Precedent: this migration (2026-08-31), which added aldarim/erapulse/mizlaj commercial '
          || 'and eastabha residential. Note mon_detect_v2_discards_captured_attrs cannot catch this '
          || 'case: its oracle IS listing_age_resolved.'));
  return n;
end
$fn$;

-- ── 3. Roster entry, in the SAME migration (AGENTS.md: a detector nothing reaches is decoration) ──
do $roster$
declare def text; newdef text; before_n int; after_n int;
begin
  def := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);

  if position('mon_detect_age_resolver_platform_gap' in def) > 0 then
    raise exception 'PRECONDITION FAILED: detector already rostered';
  end if;
  if position(E'''mon_detect_af_coverage_cliff'',' in def) = 0 then
    raise exception 'PRECONDITION FAILED: anchor entry not found in roster';
  end if;

  before_n := (length(def) - length(replace(def, 'mon_detect_', ''))) / length('mon_detect_');

  newdef := replace(def,
    E'''mon_detect_af_coverage_cliff'',',
    E'''mon_detect_af_coverage_cliff'',\n    ''mon_detect_age_resolver_platform_gap'',');

  execute newdef;

  def := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  after_n := (length(def) - length(replace(def, 'mon_detect_', ''))) / length('mon_detect_');

  if position('mon_detect_age_resolver_platform_gap' in def) = 0 then
    raise exception 'roster rewrite did not take';
  end if;
  if after_n <> before_n + 1 then
    raise exception 'roster mention count % <> % + 1 (rewrite touched more than one entry)', after_n, before_n;
  end if;
end
$roster$;

commit;
