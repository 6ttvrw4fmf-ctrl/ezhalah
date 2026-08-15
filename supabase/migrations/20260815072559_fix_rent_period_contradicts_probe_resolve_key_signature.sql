-- mon_detect_rent_period_contradicts_probe() shipped minutes ago called mon_resolve_key with one
-- argument; the real signature is (p_kind text, p_dedup text). It crashed on its first roster sweep
-- and was correctly reported as detector_crash — a crashed detector is an UNMONITORED bug class,
-- which is worse than a known-failing one because it looks like silence (§11a), so it is fixed in
-- the same run that introduced it.

create or replace function public.mon_detect_rent_period_contradicts_probe()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; sample text;
begin
  select count(*), coalesce(string_agg(format('%s:%s', source_table, listing_id), ', '), '')
    into n, sample
    from (select * from public.mon_rent_period_contradicts_probe() limit 20) t;

  if n = 0 then
    perform public.mon_resolve_key('rent_period_contradicts_probe', 'rent_period_contradicts_probe');
    return 0;
  end if;

  return public.mon_raise(
    'P1', 'rent_period_contradicts_probe', 'all', 'rent_period_contradicts_probe',
    jsonb_build_object(
      'why', 'A stored rent period contradicts this row''s OWN live source probe, which recorded that '
             'the source publishes no period for it. The usual cause is importing a platform DEFAULT '
             'field as if it were source truth — e.g. aqar''s rent_period_text, which reads «سنوي» even '
             'on genuinely MONTHLY ads (6815491 is 600/month). That mislabels unknown-period rentals '
             'and understates monthly ones 12x.',
      'adjudicate', 'Do NOT resolve by deleting the probe. Either the import is wrong (revert it and '
                    'restore honest NULL), or the source genuinely started publishing a period — in '
                    'which case re-probe the row live and record the NEW observation in '
                    'ops_rent_period_source_probe, which clears this by itself.',
      'rows', n, 'sample', sample));
end $$;

-- Prove it runs and is honest in BOTH directions before trusting it (§11: never silence a barrier to
-- make it green — make it distinguish cases, and prove both).
do $$
declare v_clean int; v_dirty int;
begin
  -- Direction 1: current reality is clean (61 probed-'none' aqar rows all still period-NULL).
  select public.mon_detect_rent_period_contradicts_probe() into v_clean;
  if v_clean <> 0 then
    raise exception 'expected a clean baseline, detector raised %', v_clean;
  end if;

  -- Direction 2: it must actually SEE the contradiction it exists for. Simulate the exact trap —
  -- a probed-'none' row acquiring «سنوي» — inside a rolled-back savepoint so nothing is written.
  begin
    update public.search_listings_ar set rent_period_ar = 'سنوي'
     where source_table = 'aqar_residential_listings' and listing_id = 179621;
    select count(*) into v_dirty from public.mon_rent_period_contradicts_probe();
    if v_dirty < 1 then
      raise exception 'BARRIER IS BLIND: injected rent_period_text-style contradiction went undetected';
    end if;
    raise exception 'rollback_probe_ok';
  exception when others then
    if sqlerrm <> 'rollback_probe_ok' then raise; end if;
  end;
end $$;