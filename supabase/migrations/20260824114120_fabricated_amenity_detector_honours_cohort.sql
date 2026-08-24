-- Teach the existing detector the cohort dimension added alongside this migration.
-- Behaviour for every EXISTING evidence row (cohort_mode='all') is unchanged.
--
-- Injection safety: source_table / column_name / cohort_column are all validated against
-- information_schema before use and interpolated with %I; the cohort VALUES are never
-- interpolated -- they are bound as a text[] parameter.
create or replace function public.mon_detect_fabricated_unpublished_amenity()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; r record; v_cnt bigint; v_bad jsonb := '[]'::jsonb; v_total bigint := 0;
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

    if r.cohort_mode = 'all' then
      execute format('select count(*) from public.%I where %I is not null', r.source_table, r.column_name)
        into v_cnt;
    else
      -- a cohort narrows the segment; an unknown cohort column is skipped rather than guessed at
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=r.source_table and column_name=r.cohort_column) then
        continue;
      end if;
      execute format(
        'select count(*) from public.%I where %I is not null and coalesce(%I::text, '''') %s ($1)',
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

  if v_total = 0 then
    perform public.mon_resolve_key('fabricated_unpublished_amenity','fabricated_unpublished_amenity');
    return 0;
  end if;

  n := public.mon_raise('P1','fabricated_unpublished_amenity','aqar','fabricated_unpublished_amenity',
    jsonb_build_object('rows_total', v_total, 'offenders', v_bad,
      'why','A (column, cohort) the recorded source probe says this platform publishes NO value for has '
         || 'non-NULL values. Either the parser is fabricating (prose fallback, or defaulting an absent '
         || 'key to false -- the 2026-08-07 class that put a confident amenity on 4,176 aqar_commercial '
         || 'rows and 2,674 searchable listings), or the source genuinely started publishing it. '
         || 'A COHORT offender is the 2026-08-24 class: aqar publishes maid/driver on the VILLA form '
         || 'only, so every non-Villa true is prose residue that can never self-heal (an absent key '
         || 'yields None, and _unknown_must_not_overwrite_known DROPS a None so the stored value survives).',
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
