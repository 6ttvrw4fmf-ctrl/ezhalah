-- Guards THE REPAIR of 20260830140110, which the symptom detector cannot.
--
-- mon_detect_url_collisions_res_vs_com() answers "does a collision exist right now?". This answers
-- a different and more specific question: "did a row we deliberately retired come back?"
--
-- That distinction matters because the two failures look identical in the index but have opposite
-- causes. A NEW collision is a new ad flipping category. A RESURRECTED one means the upstream fix
-- (scrapers/common/db.py::retire_superseded_siblings) stopped working — the scraper re-upserted the
-- orphan into the table it had left, and the upsert's `setdefault("active", True)` reactivated it.
-- Without this, that regression would surface only as a fresh symptom alert with no hint that a
-- previously-adjudicated repair had been undone.

create or replace function public.mon_detect_res_com_collision_repair_regression()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_rows int;
  v_sample jsonb;
begin
  -- A row this repair retired is active again AND its commercial sibling is still live → the same
  -- ad is once more eligible in both tables. Checked against the raw tables, not the index, so it
  -- fires on the first sync-independent reactivation rather than waiting for the index to catch up.
  with retired as (
    select platform, ad_number, res_id, com_id
      from public.ops_res_com_collision_adjudication
     where verdict = 'REPAIRABLE'
  ), back as (
    select r.platform, r.ad_number
      from retired r
      join public.sadin_residential_listings t on t.id = r.res_id and t.active
     where r.platform = 'sadin'
    union all
    select r.platform, r.ad_number
      from retired r
      join public.dealapp_residential_listings t on t.id = r.res_id and t.active
     where r.platform = 'dealapp'
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'ad', ad_number)
                            order by ad_number), '[]'::jsonb)
    into v_rows, v_sample
    from (select platform, ad_number from back order by ad_number limit 20) x;

  if v_rows > 0 then
    n := n + public.mon_raise(
      'P2', 'res_com_collision_repair_regression', null,
      'res_com_collision_repair_regression',
      jsonb_build_object(
        'reactivated_rows', v_rows,
        'sample', v_sample,
        'why', 'A residential row retired by the 2026-08-30 res/com collision repair is ACTIVE '
               'again. The same source ad is eligible in both the residential and commercial '
               'tables, so the Normal Filter will render it as two cards on one URL. This is not a '
               'new collision: it means the upstream supersession step '
               '(scrapers/common/db.py::retire_superseded_siblings, called by the sadin and dealapp '
               'scrapers before prune_unseen) did not run or did not take effect, and the upsert '
               'reactivated the orphan. Check that scraper''s last run log for the '
               '"cross-table superseded" count before touching any data.'));
  else
    perform public.mon_resolve_key('res_com_collision_repair_regression',
                                   'res_com_collision_repair_regression');
  end if;
  return n;
end $function$;

comment on function public.mon_detect_res_com_collision_repair_regression() is
  'Added 2026-08-30 with the res/com URL-collision repair. Fires when a residential row that repair '
  'retired is active again while its commercial sibling still is — i.e. the upstream supersession '
  'step regressed. Distinct from mon_detect_url_collisions_res_vs_com, which detects the symptom '
  '(any collision) rather than the undoing of an adjudicated repair.';

-- ── Roster wiring in the SAME migration (needle-edit off the live body) ─────────────
do $$
declare
  v_def text;
  v_before text;
  fn constant text := 'mon_detect_res_com_collision_repair_regression';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already carries %', fn;
    return;
  end if;
  execute v_def;
end $$;

-- ── Selftests: the detector must be reachable, read 0 on the repaired data, and be able to fire ──
do $$
declare
  v_def text;
  v_raised int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_res_com_collision_repair_regression' in v_def) = 0 then
    raise exception 'detector is not on the roster — mon_detect_orphaned_detectors would flag it';
  end if;

  -- Clean read on the repaired data.
  v_raised := public.mon_detect_res_com_collision_repair_regression();
  if v_raised <> 0 then
    raise exception 'expected 0 on repaired data, got %', v_raised;
  end if;

  -- MUTATION: reactivate one retired row, prove the detector sees it, then put it back.
  update public.sadin_residential_listings set active = true
   where id = (select res_id from public.ops_res_com_collision_adjudication
                where platform = 'sadin' and verdict = 'REPAIRABLE' order by res_id limit 1);
  v_raised := public.mon_detect_res_com_collision_repair_regression();
  if v_raised < 1 then
    raise exception 'detector did NOT fire on a reactivated retired row — it cannot protect anything';
  end if;
  update public.sadin_residential_listings set active = false
   where id = (select res_id from public.ops_res_com_collision_adjudication
                where platform = 'sadin' and verdict = 'REPAIRABLE' order by res_id limit 1);
  perform public.mon_resolve_key('res_com_collision_repair_regression',
                                 'res_com_collision_repair_regression');
  raise notice 'selftest OK: reachable, reads 0 clean, fires on a reactivated row';
end $$;
