-- Senior run #32b. Two barriers for the aqar-commercial amenity class, both keyed off the RECORDED
-- source probe (ops_aqar_commercial_amenity_probe) rather than a hardcoded column list -- owner
-- permanent rule #2: a "the source doesn't publish it" claim must be FK-gated to a probe and
-- re-checked by a detector, never asserted in code.
--
-- They are deliberately a matched PAIR, because this defect class has two opposite failure modes and
-- guarding only one invites the other:
--   (1) we invent a value the source never published  -> mon_detect_fabricated_unpublished_amenity
--   (2) we stop capturing a value the source DOES publish -> mon_detect_published_amenity_capture_collapse
-- Run #32b hit (1) on 4,176 rows. The residential/commercial contrast that made it look like (2) is
-- exactly why both directions need a detector: a single one-sided barrier would have "confirmed"
-- whichever story its author already believed.

-- (1) FABRICATION. For every (source_table, column) the probe recorded as publishing NO values,
-- assert the raw table holds none. This is the direct guard on the impossible NULL->false conversion:
-- the pre-2026-08-09 parser defaulted absent amenities to False, and 2,588 commercial rows shipped a
-- confident `false` the source never stated (plus 86 shipping `true`). It also catches a future
-- parser change that re-introduces prose fallback for a structured column.
create or replace function public.mon_detect_fabricated_unpublished_amenity()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; r record; v_cnt bigint; v_bad jsonb := '[]'::jsonb; v_total bigint := 0;
begin
  for r in select source_table, column_name from public.ops_aqar_commercial_amenity_probe
            where values_published = 0 order by source_table, column_name
  loop
    -- the probe names the table/column; both are checked against the catalog before use
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=r.source_table and column_name=r.column_name) then
      continue;
    end if;
    execute format('select count(*) from public.%I where %I is not null', r.source_table, r.column_name)
      into v_cnt;
    if v_cnt > 0 then
      v_total := v_total + v_cnt;
      v_bad := v_bad || jsonb_build_object('source_table', r.source_table, 'column', r.column_name, 'rows', v_cnt);
    end if;
  end loop;

  if v_total = 0 then
    perform public.mon_resolve_key('fabricated_unpublished_amenity','fabricated_unpublished_amenity');
    return 0;
  end if;

  n := public.mon_raise('P1','fabricated_unpublished_amenity','aqar','fabricated_unpublished_amenity',
    jsonb_build_object('rows_total', v_total, 'offenders', v_bad,
      'why','A column the recorded source probe says this platform publishes NO value for has acquired '
         || 'non-NULL values. Either the parser is fabricating (prose fallback, or defaulting an absent '
         || 'key to false -- the 2026-08-07 class that put a confident amenity on 4,176 aqar_commercial '
         || 'rows and 2,674 searchable listings), or the source genuinely started publishing it.',
      'adjudicate','Do NOT clear rows on this alert alone, and do NOT assume the source changed. Re-probe '
         || 'the live source THROUGH PRODUCTION''S OWN ORACLE (_listing_json + _amenities from '
         || 'scrapers/aqar/enrich_residential.py) and VALIDATE THE HARNESS ON A KNOWN-GOOD CONTROL ROW '
         || 'first -- a failed fetch is indistinguishable from a source omission, and counting KEY '
         || 'PRESENCE is not the same as a published VALUE (aqar sends the commercial extended_details '
         || 'amenity keys as always-null). If the source now publishes values, update '
         || 'ops_aqar_commercial_amenity_probe.values_published and this clears itself.'));
  return n;
end $function$;

-- (2) CAPTURE COLLAPSE. The mirror image: for every column the probe says IS published with real
-- values, fire if fresh rows have stopped carrying it entirely. Gated on a meaningful fresh cohort
-- (>=100 rows in 48h) so a quiet crawl cannot raise it -- a platform-cadence pause is not a defect.
create or replace function public.mon_detect_published_amenity_capture_collapse()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; r record; v_fresh bigint; v_known bigint; v_bad jsonb := '[]'::jsonb;
begin
  for r in select source_table, column_name from public.ops_aqar_commercial_amenity_probe
            where values_published > 0 order by source_table, column_name
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=r.source_table and column_name=r.column_name)
    or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=r.source_table and column_name='scraped_at') then
      continue;
    end if;
    execute format($q$select count(*), count(*) filter (where %I is not null)
                        from public.%I where scraped_at > now() - interval '48 hours'$q$,
                   r.column_name, r.source_table)
      into v_fresh, v_known;
    if v_fresh >= 100 and v_known = 0 then
      v_bad := v_bad || jsonb_build_object('source_table', r.source_table, 'column', r.column_name,
                                           'fresh_48h_rows', v_fresh, 'with_value', 0);
    end if;
  end loop;

  if jsonb_array_length(v_bad) = 0 then
    perform public.mon_resolve_key('published_amenity_capture_collapse','published_amenity_capture_collapse');
    return 0;
  end if;

  n := public.mon_raise('P2','published_amenity_capture_collapse','aqar','published_amenity_capture_collapse',
    jsonb_build_object('offenders', v_bad,
      'why','A column the recorded source probe says this platform DOES publish with real values has '
         || 'gone to zero on every fresh row. That is a capture cliff -- a source shape change, a '
         || 'renamed key, or a parser/enricher that stopped reading it -- not a quiet market.',
      'adjudicate','Re-probe live through production''s own oracle with a control row, exactly as for '
         || 'the fabrication barrier. If aqar renamed or dropped the key, record the new verdict in '
         || 'ops_aqar_commercial_amenity_probe -- never backfill the column from prose to make this green.'));
  return n;
end $function$;

comment on function public.mon_detect_fabricated_unpublished_amenity() is
  'P1. Probe-gated: fires when a column the source is recorded as NOT publishing acquires values. Senior run #32b.';
comment on function public.mon_detect_published_amenity_capture_collapse() is
  'P2. Probe-gated mirror image: fires when a column the source IS recorded as publishing goes to zero on fresh rows. Senior run #32b.';

-- Roster wiring: guarded needle-edit, both entries in the SAME migration as the detectors.
do $$
declare v_def text; v_new text; v_anchor text; n_anchor int; n_before int; n_after int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='mon_run_all_detectors';
  if position('mon_detect_fabricated_unpublished_amenity' in v_def) > 0 then
    raise notice 'already wired; no-op'; return;
  end if;

  v_anchor := '    ''mon_detect_v2_discards_captured_attrs'',
';
  n_anchor := (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  if n_anchor <> 1 then raise exception 'REFUSED: roster anchor not found exactly once (found %)', n_anchor; end if;

  n_before := (length(v_def)-length(replace(v_def,'''mon_detect_','')))/length('''mon_detect_');
  v_new := replace(v_def, v_anchor, v_anchor
    || '    ''mon_detect_fabricated_unpublished_amenity'',
'   || '    ''mon_detect_published_amenity_capture_collapse'',
');
  n_after := (length(v_new)-length(replace(v_new,'''mon_detect_','')))/length('''mon_detect_');
  if n_after <> n_before + 2 then
    raise exception 'REFUSED: roster count moved % -> % (expected +2)', n_before, n_after;
  end if;
  execute v_new;
end $$;
