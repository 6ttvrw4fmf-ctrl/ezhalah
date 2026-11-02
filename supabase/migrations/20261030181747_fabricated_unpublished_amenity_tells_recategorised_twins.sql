-- fabricated_unpublished_amenity tells a FABRICATED value from a RE-CATEGORISED ad (🔬, 2026-10-30, backlog 942).
--
-- Alarm 2958 (P1 since 09-14) named 12 values on 3 aqar_commercial_listings rows (air_conditioner, car_entrance,
-- elevator, kitchen, private_entrance), columns aqar's commercial form never publishes. Re-read from CI on 10-30 (source-reread run 41103994779): all three
-- ads now sit on aqar's RESIDENTIAL form (6795005 «استوديو» publishes ac:1 lift:0 car_entrance:0, 6895987 «شقة»
-- publishes lift:1 car_entrance:1) and our stored values equal aqar's. The advertiser moved the ad, the residential
-- crawl stored it again (aqar_residential_listings 14917660, 15120694, 15131263), and the commercial copy was never
-- retired. Nothing was invented; the defect is the twin, and 291 aqar ads are live in both tables, every one served.
--
-- So the detector now skips a commercial row whose ad_number is active in the sibling residential table, and raises
-- those twins under their own key (recategorised_twin, P2, for Lifecycle) instead of hiding them. Same function, so
-- the roster entry in mon_run_all_detectors still reaches both halves. The probe and the rest of the body are unchanged.
-- The alarm stays open on its other half: 513 aqar residential non-Villa maid/driver values, and 5 of 5 re-read pages
-- (source-reread run 41105321935) publish no maid or driver key, so that half is real and needs the owner's bulk repair.
create or replace function public.mon_detect_fabricated_unpublished_amenity()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; r record; v_cnt bigint; v_bad jsonb := '[]'::jsonb; v_total bigint := 0;
        v_sib text; v_twin text; t record; v_twins bigint;
begin
  for r in select source_table, column_name, cohort_column, cohort_values, cohort_mode, cohort_label
             from public.ops_aqar_commercial_amenity_probe
            where values_published = 0
            order by source_table, column_name, coalesce(cohort_label, '')
  loop
    -- the probe names the table/column; both are checked against the catalog before use
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=r.source_table and column_name=r.column_name) then
      continue;
    end if;
    -- a commercial row whose ad is live in the residential sibling is on the residential form now: its value is
    -- the source's, not ours (counted below as a twin, never here)
    v_sib := case when r.source_table like '%\_commercial\_listings'
                  then replace(r.source_table, '_commercial_listings', '_residential_listings') end;
    v_twin := case when v_sib is not null and to_regclass('public.' || v_sib) is not null
                   then format(' and not exists (select 1 from public.%I s where s.ad_number = t.ad_number and s.active)', v_sib)
                   else '' end;

    if r.cohort_mode = 'all' then
      execute format('select count(*) from public.%I t where %I is not null' || v_twin, r.source_table, r.column_name)
        into v_cnt;
    else
      -- a cohort narrows the segment; an unknown cohort column is skipped rather than guessed at
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=r.source_table and column_name=r.cohort_column) then
        continue;
      end if;
      execute format(
        'select count(*) from public.%I t where %I is not null and coalesce(%I::text, '''') %s ($1)' || v_twin,
        r.source_table, r.column_name, r.cohort_column,
        case when r.cohort_mode = 'in' then '= any' else '<> all' end)
        into v_cnt using r.cohort_values;
    end if;

    if v_cnt > 0 then
      v_total := v_total + v_cnt;
      v_bad := v_bad || jsonb_build_object('source_table', r.source_table, 'column', r.column_name,
                                           'cohort', coalesce(r.cohort_label, 'ALL ROWS'), 'rows', v_cnt);
    end if;
  end loop;

  -- the twins: one ad live in BOTH tables of a probed platform (the commercial copy outlived a re-categorisation)
  for t in select distinct source_table from public.ops_aqar_commercial_amenity_probe
            where source_table like '%\_commercial\_listings'
  loop
    v_sib := replace(t.source_table, '_commercial_listings', '_residential_listings');
    continue when to_regclass('public.' || t.source_table) is null or to_regclass('public.' || v_sib) is null;
    execute format('select count(*) from public.%I c join public.%I s on s.ad_number = c.ad_number
                     where c.active and s.active', t.source_table, v_sib) into v_twins;
    if v_twins = 0 then
      perform public.mon_resolve_key('recategorised_twin', 'recategorised_twin:' || t.source_table);
    else
      n := n + public.mon_raise('P2', 'recategorised_twin', split_part(t.source_table, '_', 1),
        'recategorised_twin:' || t.source_table,
        jsonb_build_object('rows', v_twins, 'table', t.source_table, 'sibling', v_sib,
          'why', 'The same source ad is active in BOTH tables: the advertiser moved it to the other category, the '
              || 'sibling crawl stored it again, and nothing retired the old copy, so search shows it twice, once '
              || 'with a type the source no longer states. db.retire_superseded_siblings() is the mechanism the '
              || 'single-run platforms use; aqar crawls each table in its own workflow and never calls it.',
          'adjudicate', 'Re-read the ad: the source page names ONE category. Retire the copy in the other table '
              || 'through the sanctioned path (deactivate only, adjudicated). Never by hand in bulk.'));
    end if;
  end loop;

  if v_total = 0 then
    perform public.mon_resolve_key('fabricated_unpublished_amenity','fabricated_unpublished_amenity');
    return n;
  end if;

  n := n + public.mon_raise('P1','fabricated_unpublished_amenity','aqar','fabricated_unpublished_amenity',
    jsonb_build_object('rows_total', v_total, 'offenders', v_bad,
      'why','A (column, cohort) the recorded source probe says this platform publishes NO value for has '
         || 'non-NULL values. Either the parser is fabricating (prose fallback, or defaulting an absent '
         || 'key to false -- the 2026-08-07 class that put a confident amenity on 4,176 aqar_commercial '
         || 'rows and 2,674 searchable listings), or the source genuinely started publishing it. '
         || 'A COHORT offender is the 2026-08-24 class: aqar publishes maid/driver on the VILLA form '
         || 'only, so every non-Villa true is prose residue that can never self-heal (an absent key '
         || 'yields None, and _unknown_must_not_overwrite_known DROPS a None so the stored value survives). '
         || 'A commercial row whose ad is live in the residential table is NOT counted here (recategorised_twin).',
      'adjudicate','Do NOT clear rows on this alert alone, and do NOT assume the source changed. Re-probe '
         || 'the live source THROUGH PRODUCTION''S OWN ORACLE (_listing_json + _amenities from '
         || 'scrapers/aqar/enrich_residential.py) and VALIDATE THE HARNESS ON A KNOWN-GOOD CONTROL ROW '
         || 'first -- a failed fetch is indistinguishable from a source omission, and counting KEY '
         || 'PRESENCE is not the same as a published VALUE (aqar sends the commercial extended_details '
         || 'amenity keys as always-null). If the source now publishes values, update '
         || 'ops_aqar_commercial_amenity_probe.values_published and this clears itself. Clearing rows '
         || 'in bulk is a RED-list bulk field rewrite (docs/ops/AGENT_AUTHORITY.md) -- ask the owner.'));
  return n;
end $function$;
