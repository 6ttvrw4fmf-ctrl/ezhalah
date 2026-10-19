-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- THE FACADE A SOURCE STATES PLAINLY, DISCARDED BECAUSE IT SPELLED IT DIFFERENTLY
-- routine-8 (regression hunter), 2026-09-27. Class re-attack of e0ac981 (sirdab diagonals, the same
-- morning) and of 20260810224134_wasalt_english_panel_fallback_direction.
--
-- THE SEAM. Every surface here is correct inside its own boundary:
--   · the scraper is FAITHFUL — ramzalqasim publishes «Northern», akariyoun «شماليه», sadiqeltajer
--     «شرقى», and each stores exactly that. A field-fidelity check against source PASSES.
--   · the Advanced Filter is CORRECT — the rows canonicalise to NULL, so it treats them as UNKNOWN
--     and never turns an unknown into a No. Its option counts are honest about what it was handed.
--   · canon_direction_ar() is correct about the vocabularies it knows.
-- The defect exists only in the COMPOSITION: the canonicaliser's accepted-token set is a
-- hand-maintained list that grew once, for ONE platform's English panel (wasalt, 2026-08-10), and
-- two more vocabularies arrived behind it. Nobody owns "the set of spellings the fleet actually
-- writes" versus "the set of spellings the shared canonicaliser reads".
--
-- MEASURED ON PRODUCTION, 2026-09-27 (every *_listings table carrying a `direction` column):
--   Northern 42 · Western 39 · Eastern 38 · Southern 33   ramzalqasim   English «-ern» forms
--   شماليه 6 · شرقيه 2 · غربيه 2                          akariyoun     final ه for ة
--   شرقى 2 · شمالى 2 · غربى 1                             sadiqeltajer  final ى for ي
--   الغربي 1                                              raghdan       the definite article
--   ───────────────────────────────────────────────────────────────────────────────────────────────
--   168 rows, 128 of them ACTIVE. Each states ONE unambiguous compass facade. All 128 are absent
--   from listing_extra_attrs_mv.direction, so the «الواجهة» question cannot reach them and their
--   cards show no facade — while the source says north.
--
-- WHAT IS DELIBERATELY *NOT* RECOVERED (weird does not mean wrong; a guess is not a repair):
--   «جنوية»                  a typo. «جنوبية» is a guess, so it stays UNKNOWN.
--   «شرق غربي» (281 active)  two OPPOSITE bearings — a plot on two streets, not one of the eight.
--   «شمال جنوبي» (235)       same.
--   «شرقية - غربية», «3 شوارع», «ثلاث واجهات», «20م», «•», the aqar prose blobs — none is one facade.
--
-- ADDITIVE BY CONSTRUCTION, not merely by measurement. The pre-fix expression is extracted VERBATIM
-- into canon_direction_core_ar() and evaluated FIRST inside a coalesce, so a new arm can only turn a
-- NULL into a value — it can never change one of the 113,300 facades already canonicalised. Proven
-- both ways: structurally here, and by differential over every distinct raw value in production
-- (0 changed, 11 recovered) before this migration was written.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. the pre-fix decision, moved verbatim so it can be evaluated first and on its own ──────────
create or replace function public.canon_direction_core_ar(n text)
 returns text language sql immutable parallel safe
as $fn$
  select case n
    when 'شمال' then 'شمال'
    when 'جنوب' then 'جنوب'
    when 'شرق'  then 'شرق'
    when 'غرب'  then 'غرب'
    when 'شمال شرق'   then 'شمال شرقي'
    when 'شمال - شرق' then 'شمال شرقي'
    when 'شمال غرب'   then 'شمال غربي'
    when 'شمال - غرب' then 'شمال غربي'
    when 'جنوب شرق'   then 'جنوب شرقي'
    when 'جنوب - شرق' then 'جنوب شرقي'
    when 'جنوب غرب'   then 'جنوب غربي'
    when 'جنوب - غرب' then 'جنوب غربي'
    -- already-canonical inputs pass straight through
    when 'شمال شرقي' then 'شمال شرقي'
    when 'شمال غربي' then 'شمال غربي'
    when 'جنوب شرقي' then 'جنوب شرقي'
    when 'جنوب غربي' then 'جنوب غربي'
    -- English, as published by wasalt's panel
    when 'North' then 'شمال'      when 'South' then 'جنوب'
    when 'East'  then 'شرق'       when 'West'  then 'غرب'
    when 'North East' then 'شمال شرقي' when 'North West' then 'شمال غربي'
    when 'South East' then 'جنوب شرقي' when 'South West' then 'جنوب غربي'
    else null
  end;
$fn$;

-- ── 2. the same Arabic word, spelled the way people actually type it ─────────────────────────────
-- ى for ي and ه for final ة are the two commonest Arabic orthographic variants in Saudi listing
-- data, and «الشمالية» is the same bearing as «شمالية». norm_direction_ar() folds the ADJECTIVE
-- suffixes but is anchored on spaces, so a leading article or a substituted letter slips past it.
-- This does NOT invent a bearing: it only rewrites a spelling of a word that is already there.
create or replace function public.fold_direction_variants_ar(t text)
 returns text language sql immutable parallel safe
as $fn$
  select replace(replace(replace(replace(
           replace(' ' || translate(coalesce(t, ''), 'ى', 'ي') || ' ', 'يه ', 'ية '),
           ' الشمال', ' شمال'), ' الجنوب', ' جنوب'), ' الشرق', ' شرق'), ' الغرب', ' غرب');
$fn$;

-- ── 3. the English vocabulary a SECOND platform publishes ────────────────────────────────────────
-- 2026-08-10 added an English arm for wasalt's panel («North», «North East»). ramzalqasim's JSON
-- states the adjectival forms («Northern», «North Eastern») — a different vocabulary, not a
-- different language, and outside that arm by one suffix. Case- and separator-insensitive so the
-- next site writing «north-eastern» or «NORTHERN» is covered without a third migration.
create or replace function public.canon_direction_en_extended_ar(t text)
 returns text language sql immutable parallel safe
as $fn$
  select case regexp_replace(lower(btrim(coalesce(t, ''))), '[\s\-_]+', ' ', 'g')
    when 'northern' then 'شمال'  when 'southern' then 'جنوب'
    when 'eastern'  then 'شرق'   when 'western'  then 'غرب'
    when 'north eastern' then 'شمال شرقي'  when 'northeastern' then 'شمال شرقي'
    when 'north western' then 'شمال غربي'  when 'northwestern' then 'شمال غربي'
    when 'south eastern' then 'جنوب شرقي'  when 'southeastern' then 'جنوب شرقي'
    when 'south western' then 'جنوب غربي'  when 'southwestern' then 'جنوب غربي'
    else null
  end;
$fn$;

-- ── 4. the canonicaliser: OLD ARM FIRST, so nothing already decided can move ─────────────────────
create or replace function public.canon_direction_ar(t text)
 returns text language sql immutable
as $fn$
  select coalesce(
    -- exactly the pre-2026-09-27 behaviour, evaluated before anything new
    public.canon_direction_core_ar(public.norm_direction_ar(nullif(btrim(coalesce(t, '')), ''))),
    -- the same Arabic bearing, spelled with ى / final ه / the definite article
    public.canon_direction_core_ar(public.norm_direction_ar(
      nullif(btrim(public.fold_direction_variants_ar(t)), ''))),
    -- the adjectival English forms
    public.canon_direction_en_extended_ar(t));
$fn$;

-- ── 5. the class barrier: WHICH spellings the fleet writes that the canonicaliser cannot read ─────
-- The predicate takes a TABLE NAME so it can be executed against an injected fixture rather than
-- believed (the shape AGENTS.md requires: a barrier for this class must EXECUTE, never grep). It
-- flags a value that LOOKS like exactly one compass facade and canonicalises to nothing:
--   short, no digit, no list separator, mentions a compass root, and not two OPPOSITE bearings.
-- The last clause is what keeps it honest — «شرق غربي» (281 active) and «شمال جنوبي» (235) are plots
-- on two streets, correctly not one of the eight, and a detector that cried wolf over them would be
-- switched off within a week. Calibrated 2026-09-27: 11 values / 128 active rows before the fix
-- above, exactly 0 after, with every deliberate non-recovery left alone.
create or replace function public.facade_lost_to_vocabulary(p_table text)
 returns table(raw text, n_active bigint)
 language plpgsql stable security definer set search_path to 'public'
as $fn$
begin
  return query execute format($q$
    select t.direction::text, count(*) filter (where t.active)::bigint
      from public.%I t
     where t.direction is not null
       and btrim(t.direction) <> ''
       and public.canon_direction_ar(t.direction) is null
       and length(btrim(t.direction)) <= 30
       and btrim(t.direction) !~ '[0-9٠-٩]'
       and btrim(t.direction) !~ '[-،,/|]'
       and (btrim(t.direction) ~ '(شمال|جنوب|شرق|غرب)'
            or lower(btrim(t.direction)) ~ '(north|south|east|west)')
       and not (btrim(t.direction) ~ 'شمال' and btrim(t.direction) ~ 'جنوب')
       and not (btrim(t.direction) ~ 'شرق'  and btrim(t.direction) ~ 'غرب')
       and not (lower(btrim(t.direction)) ~ 'north' and lower(btrim(t.direction)) ~ 'south')
       and not (lower(btrim(t.direction)) ~ 'east'  and lower(btrim(t.direction)) ~ 'west')
     group by 1
     having count(*) filter (where t.active) > 0
  $q$, p_table);
end
$fn$;

-- Every platform table is DISCOVERED at run time from the catalogue. A platform onboarded tomorrow
-- is inside this sweep the moment its table exists — never a list someone has to remember to extend
-- (the staleness trap that made mon_detect_amlakalahsa_direction_ppm_regressed a one-platform guard).
create or replace function public.mon_facade_vocabulary_losses()
 returns table(tbl text, raw text, n_active bigint)
 language plpgsql stable security definer set search_path to 'public'
as $fn$
declare r record;
begin
  for r in
    -- ::text — information_schema hands back sql_identifier, which RETURN QUERY rejects outright
    select c.table_name::text as table_name from information_schema.columns c
      join information_schema.tables t
        on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     where c.column_name = 'direction' and c.table_schema = 'public'
       and c.table_name like '%\_listings' and c.table_name not like '%backup%'
  loop
    return query select r.table_name, f.raw, f.n_active
                   from public.facade_lost_to_vocabulary(r.table_name) f;
  end loop;
end
$fn$;

create or replace function public.mon_detect_facade_lost_to_vocabulary()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare n int := 0; losses jsonb; rows_lost bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'raw', raw, 'active', n_active)
                            order by n_active desc), '[]'::jsonb),
         coalesce(sum(n_active), 0)
    into losses, rows_lost
    from public.mon_facade_vocabulary_losses();

  if rows_lost > 0 then
    n := public.mon_raise('P2', 'cross_surface_scraper_af', 'fleet', 'facade_lost_to_vocabulary',
      jsonb_build_object('active_rows_lost', rows_lost, 'values', losses,
        'means', 'these listings state ONE compass facade at source and canon_direction_ar() reads '
              || 'none of it, so «الواجهة» cannot reach them and their cards show no facade. The '
              || 'scraper is faithful and the Advanced Filter is honest — the gap is between them.',
        'fix', 'extend fold_direction_variants_ar / canon_direction_en_extended_ar for the spelling, '
            || 'never the one platform; then refresh listing_extra_attrs_mv and sync_search_listings_ar'));
  else
    perform public.mon_resolve('cross_surface_scraper_af', 'fleet');
  end if;
  return n;
end
$fn$;

-- ── 6. the self-test: the truth table, EXECUTED, in both directions ──────────────────────────────
-- Half of it is the regression guard the 2026-08-10 English arm never got: a CREATE OR REPLACE that
-- drops an arm is exactly how this comes back, and it comes back silently. The other half proves the
-- DETECTOR can still fire, against an injected fixture, so a predicate quietly narrowed to nothing
-- cannot read as a clean fleet.
create or replace function public.canon_direction_selftest()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_result text := 'PASS';
  v_bad    text;
  v_fired  bigint;
  -- (input, expected) — the arms that existed BEFORE 2026-09-27 must keep their exact answers,
  -- the recoveries must land on the right bearing, and a guess must stay NULL.
  v_cases  text[][] := array[
    -- pre-existing Arabic
    ['شمال','شمال'], ['شمالية','شمال'], ['جنوبي','جنوب'], ['شرقية','شرق'], ['غربي','غرب'],
    ['شمال شرق','شمال شرقي'], ['جنوب - غرب','جنوب غربي'], ['جنوب شرقي','جنوب شرقي'],
    -- pre-existing English (wasalt's panel)
    ['North','شمال'], ['South','جنوب'], ['East','شرق'], ['West','غرب'],
    ['North East','شمال شرقي'], ['South West','جنوب غربي'],
    -- RECOVERED 2026-09-27 — ramzalqasim's adjectival English
    ['Northern','شمال'], ['Southern','جنوب'], ['Eastern','شرق'], ['Western','غرب'],
    ['North Eastern','شمال شرقي'], ['northeastern','شمال شرقي'],
    ['South Western','جنوب غربي'], ['NORTHERN','شمال'], ['north-western','شمال غربي'],
    -- RECOVERED — akariyoun's final ه, sadiqeltajer's final ى, raghdan's definite article
    ['شماليه','شمال'], ['شرقيه','شرق'], ['غربيه','غرب'], ['جنوبيه','جنوب'],
    ['شمالى','شمال'], ['شرقى','شرق'], ['غربى','غرب'],
    ['الغربي','غرب'], ['الشمالية','شمال'], ['الشماليه','شمال'],
    -- STILL NULL, on purpose: a typo, two opposite bearings, a street count, a facade LIST
    ['جنوية', null], ['شرق غربي', null], ['شمال جنوبي', null], ['3 شوارع', null],
    ['ثلاث واجهات', null], ['شرقية - غربية', null], ['20م', null], ['•', null],
    ['Northerly', null], ['4 Streets', null]
  ];
  i int;
begin
  for i in 1 .. array_length(v_cases, 1) loop
    if public.canon_direction_ar(v_cases[i][1]) is distinct from v_cases[i][2] then
      v_bad := coalesce(v_bad || ' ; ', '')
            || format('%s → %s (expected %s)', v_cases[i][1],
                      coalesce(public.canon_direction_ar(v_cases[i][1]), 'NULL'),
                      coalesce(v_cases[i][2], 'NULL'));
    end if;
  end loop;
  if v_bad is not null then
    return 'FAIL: canon_direction_ar disagrees with the facade vocabulary contract: ' || v_bad;
  end if;

  -- the detector half: an injected table holding one unreadable bearing MUST be reported.
  begin
    create table public.canon_direction_selftest_rows (direction text, active boolean);
    insert into public.canon_direction_selftest_rows values
      ('Northeasterly', true),      -- a bearing no arm reads → MUST be flagged
      ('شمال', true),               -- readable → must NOT be flagged
      ('شرق غربي', true),           -- two opposite bearings → must NOT be flagged
      ('3 شوارع', true),            -- a street count → must NOT be flagged
      ('Northeasterly', false);     -- inactive → must not be counted
    select coalesce(sum(n_active), 0) into v_fired
      from public.facade_lost_to_vocabulary('canon_direction_selftest_rows');
    if v_fired <> 1 then
      v_result := format('FAIL: the loss predicate reported %s active rows on a fixture holding '
                      || 'exactly ONE unreadable active bearing — it can no longer catch this class',
                         v_fired);
    end if;
    raise exception 'selftest rollback';          -- always: no residue, ever
  exception when others then
    if sqlerrm <> 'selftest rollback' then
      v_result := 'FAIL: ' || sqlerrm;
    end if;
  end;
  return v_result;
end
$fn$;

create or replace function public.mon_detect_canon_direction_contract()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare v text; n int := 0;
begin
  v := public.canon_direction_selftest();
  if v <> 'PASS' then
    n := public.mon_raise('P2', 'monitor_integrity', 'fleet', 'canon_direction_contract_broken',
      jsonb_build_object('selftest', v,
        'means', 'canon_direction_ar() no longer answers the facade vocabulary contract, or the '
              || 'loss predicate can no longer catch an unreadable bearing. Either way facades are '
              || 'being discarded or lost silently again (routine-8, 2026-09-27).'));
  else
    perform public.mon_resolve('monitor_integrity', 'fleet');
  end if;
  return n;
end
$fn$;

-- ── 7. both detectors join the roster IN THIS MIGRATION (AGENTS.md: a detector nothing reaches is
--       decoration, and mon_detect_orphaned_detectors() fires on it). Needle-edited from the LIVE
--       body, never pasted: mon_run_all_detectors is redefined by many migrations.
do $roster$
declare
  src     text;
  anchor  constant text := '  fns text[] := array[' || E'\n' || '    ''mon_detect_price_drift_predicate_is_blind'',';
  added   constant text := '  fns text[] := array[' || E'\n'
    || '    ''mon_detect_facade_lost_to_vocabulary'',' || E'\n'
    || '    ''mon_detect_canon_direction_contract'',' || E'\n'
    || '    ''mon_detect_price_drift_predicate_is_blind'',';
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_facade_lost_to_vocabulary' in src) > 0 then
    raise notice 'facade detectors are already on the roster — nothing to patch';
    return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the detector roster head was not found exactly once in the live body — refusing to guess';
  end if;
  execute replace(src, anchor, added);
end
$roster$;

-- ── 8. the contract must hold the moment this migration lands, not at the next sweep ─────────────
do $prove$
declare v text; lost bigint;
begin
  v := public.canon_direction_selftest();
  if v <> 'PASS' then
    raise exception 'facade vocabulary selftest did not pass: %', v;
  end if;
  select coalesce(sum(n_active), 0) into lost from public.mon_facade_vocabulary_losses();
  if lost <> 0 then
    raise exception 'facades are still being lost to a vocabulary the canonicaliser cannot read: % active rows', lost;
  end if;
  if position('mon_detect_facade_lost_to_vocabulary'
              in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'the facade detector is not reachable from mon_run_all_detectors';
  end if;
  raise notice 'facade vocabulary: contract PASS, 0 active rows lost, both detectors on the roster';
end
$prove$;
