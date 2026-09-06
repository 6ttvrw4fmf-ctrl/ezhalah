-- mon_detect_rent_period_contract() was still enforcing a RETIRED owner rule (Data Integrity
-- run 2026-09-04).
--
-- WHAT CHANGED UNDER IT. The 2026-08-18 product fallback (confirmed rent + no monthly evidence ->
-- 'سنوي') was retired on 2026-09-03 by the owner restatement "Never infer Monthly or Yearly when the
-- source does not explicitly support it", implemented in migration 20260903175817. A source-silent
-- rent row now correctly carries NULL.
--
-- THE DEFECT. This detector's check (2) counts every rent row whose period is NULL as a contract
-- breach and adds it to the raise total. Since 2026-09-03 17:58 that has been 901 rows of CORRECT
-- behaviour, so the detector has raised P1 continuously and cannot ever go green again. Its three
-- checks that still matter -- explicit monthly lost (0), explicit annual lost (0), monthly-only
-- platform not monthly (0) -- are drowned underneath it, and because mon_raise() dedups on an open
-- key, a REAL breach appearing in any of them would raise nothing new. A permanently-red barrier is
-- not a loud barrier; it is a deaf one. Same class as the stale ops_qa_scope registry fixed earlier
-- in this run.
--
-- THE FIX, and it is strictly STRONGER, not weaker:
--   * NULL is no longer counted as a breach. It is still REPORTED as 'rent_without_period' so a
--     rise stays visible to a human (DATA_INTEGRITY_ENGINEER.md §22.1: "a rise is worth
--     investigating as a possible parser regression; the absolute count is not a defect").
--   * A garbage period (a value that is neither 'سنوي' nor 'شهري') still counts as a breach --
--     that direction was never about the fallback.
--   * NEW breach check, which is what the 2026-09-03 rule is actually about and which nothing
--     asserted before: a MANUFACTURED period -- the index carries a period the source never
--     published, on a platform that is not monthly-only. That is the "missing must never become a
--     value" rule, now enforced continuously instead of assumed.
-- Checks (3) (4) (5) are untouched.
--
-- GUARDED NEEDLE EDIT of the LIVE body -- never a hand-pasted rebuild, which has silently dropped
-- clauses three times in this repo (AGENTS.md).
do $do$
declare src text; fixed text; hits int; old_needle text; new_body text;
begin
  src := pg_get_functiondef('public.mon_detect_rent_period_contract()'::regprocedure);

  insert into public.ops_ddl_snapshot (label, obj_schema, obj_name, obj_kind, ordinal, ddl)
  values ('pre_rent_period_contract_retired_rule_20260904', 'public', 'mon_detect_rent_period_contract', 'function', 0, src);

  old_needle :=
    'select count(*) into bad from public.search_listings_ar' || E'\n' ||
    '   where deal_ar = ''إيجار'' and (rent_period_ar is null or rent_period_ar not in (''سنوي'',''شهري''));' || E'\n' ||
    '  total := total + bad; v := v || jsonb_build_object(''rent_without_period'', bad);';

  hits := (length(src) - length(replace(src, old_needle, ''))) / length(old_needle);
  if hits <> 1 then
    raise exception 'expected exactly 1 occurrence of the retired-rule check, found % — aborting', hits;
  end if;

  new_body :=
    '-- (2a) a period value that is neither سنوي nor شهري is garbage — still a breach.' || E'\n' ||
    '  select count(*) into bad from public.search_listings_ar' || E'\n' ||
    '   where deal_ar = ''إيجار'' and rent_period_ar is not null and rent_period_ar not in (''سنوي'',''شهري'');' || E'\n' ||
    '  total := total + bad; v := v || jsonb_build_object(''rent_period_garbage'', bad);' || E'\n' ||
    E'\n' ||
    '  -- (2b) INFORMATIONAL since the 2026-09-03 owner restatement: a source-silent rent row' || E'\n' ||
    '  -- correctly carries NULL. Reported so a RISE stays visible; deliberately NOT added to total.' || E'\n' ||
    '  select count(*) into bad from public.search_listings_ar' || E'\n' ||
    '   where deal_ar = ''إيجار'' and rent_period_ar is null;' || E'\n' ||
    '  v := v || jsonb_build_object(''rent_without_period'', bad);' || E'\n' ||
    E'\n' ||
    '  -- (2c) MANUFACTURED period — the index states a period the source never published, on a' || E'\n' ||
    '  -- platform that is not monthly-only. This is the 2026-09-03 rule, now enforced.' || E'\n' ||
    '  select count(*) into bad' || E'\n' ||
    '    from public.listing_native_location_v2 lv' || E'\n' ||
    '    join public.search_listings_ar s' || E'\n' ||
    '      on s.source_table = lv.source_table and s.listing_id = lv.listing_id' || E'\n' ||
    '   where lower(lv.transaction_type) = ''rent'' and lv.rent_period is null' || E'\n' ||
    '     and s.platform not in (''gathern'',''aqarmonthly'') and s.rent_period_ar is not null;' || E'\n' ||
    '  total := total + bad; v := v || jsonb_build_object(''period_manufactured'', bad);';

  fixed := replace(src, old_needle, new_body);
  if fixed = src then raise exception 'needle edit produced no change'; end if;
  execute fixed;
end
$do$;

-- PROVE IT, including that the new check is not vacuous.
do $$
declare v_manufactured bigint; v_null bigint; v_n int;
begin
  -- (1) the new predicate is LIVE: flipping only its final condition finds the 901 honest NULLs, so
  -- the join and filters reach real rows. A check that can never match anything is worthless.
  select count(*) into v_null
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period is null
     and s.platform not in ('gathern','aqarmonthly') and s.rent_period_ar is null;
  if v_null = 0 then raise exception 'vacuity proof failed: the manufactured-period predicate matches no rows in either direction'; end if;

  -- (2) and in the breach direction it is currently clean.
  select count(*) into v_manufactured
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period is null
     and s.platform not in ('gathern','aqarmonthly') and s.rent_period_ar is not null;
  if v_manufactured <> 0 then
    raise exception 'a manufactured rent period exists on % rows — investigate before shipping this barrier', v_manufactured;
  end if;

  -- (3) the detector must now be able to go green on correct behaviour.
  v_n := public.mon_detect_rent_period_contract();
  if v_n <> 0 then raise exception 'rent_period_contract still raises % after the fix', v_n; end if;
end $$;

select public.mon_resolve_key('rent_period_contract', 'rent_period_contract') as resolved;
