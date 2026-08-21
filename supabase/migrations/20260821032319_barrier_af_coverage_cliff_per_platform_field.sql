-- Senior Production Engineer run #33 (2026-08-21), owner-directed.
--
-- The second half of the AF protection, and the half that works WITHOUT a registered mapping.
-- mon_detect_af_source_mapping_integrity proves the chain row-by-row for fields we have explicitly
-- declared. This one is the generic net: for EVERY (source_table x rich AF field) in the search
-- index -- ~29 fields across every platform, registered or not -- it detects a parser/mapping CLIFF,
-- the case where a field was arriving on new listings and abruptly stops.
--
-- That is the shape of the failure this run investigated: nothing errors, existing rows keep their
-- values, and only NEW listings quietly arrive without the attribute. Row-level inspection will not
-- surface it (each new row looks individually plausible); only the cohort trend does.
--
-- PREDICATE, per (source_table, field), measured on first_seen_at so it is genuinely about NEW
-- listings entering the system:
--   * >= 50 listings first seen in the last 7 days      (the crawl is demonstrably still running,
--                                                        so silence is not just a quiet platform)
--   * > 0 listings in the preceding 30 days carried it  (it WAS arriving -- fires on a cliff, never
--                                                        on a field the platform never publishes)
--   * 0 of the last 7 days' listings carry it           (it has stopped entirely)
-- A field that is legitimately absent for a platform is silent forever, by construction.
--
-- Measured across the whole index before wiring: 0 cliffs. Daily-slot gated -- it is one full scan
-- of search_listings_ar with ~60 aggregates, so it runs once per day, not twice an hour.

create or replace function public.mon_detect_af_coverage_cliff()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cols text[]; agg text; q text; r record; c text; rv bigint; pv bigint;
  n int := 0; v_bad jsonb := '[]'::jsonb; v_cliffs int := 0;
begin
  if not public.mon_claim_daily_slot('af_coverage_cliff') then return 0; end if;

  select array_agg(z.c order by z.c) into cols from (
    select unnest(public._rich_attr_columns()) c
    intersect
    select column_name from information_schema.columns
     where table_schema='public' and table_name='search_listings_ar') z;

  if cols is null or array_length(cols,1) < 20 then
    raise exception 'refusing to run: rich AF column set looks wrong (%)', cols;
  end if;

  select string_agg(format(
      'count(*) filter (where first_seen_at > now()-interval ''7 days'' and %I is not null) as r_%s,'
      ' count(*) filter (where first_seen_at <= now()-interval ''7 days'''
      ' and first_seen_at > now()-interval ''37 days'' and %I is not null) as p_%s', x, x, x, x), ', ')
    into agg from unnest(cols) x;

  q := format('select source_table,
                 count(*) filter (where first_seen_at > now()-interval ''7 days'') as recent_rows, %s
               from public.search_listings_ar group by 1', agg);

  for r in execute q loop
    if (to_jsonb(r)->>'recent_rows')::bigint >= 50 then
      foreach c in array cols loop
        rv := (to_jsonb(r)->>('r_'||c))::bigint;
        pv := (to_jsonb(r)->>('p_'||c))::bigint;
        if rv = 0 and pv > 0 then
          v_cliffs := v_cliffs + 1;
          v_bad := v_bad || jsonb_build_object(
            'source_table', r.source_table, 'af_field', c,
            'new_listings_last_7d', (to_jsonb(r)->>'recent_rows')::bigint,
            'with_value_last_7d', 0, 'with_value_prior_30d', pv);
        end if;
      end loop;
    end if;
  end loop;

  update public.ops_detector_last_full_run set last_result = v_cliffs where detector = 'af_coverage_cliff';

  if v_cliffs = 0 then
    perform public.mon_resolve_key('af_coverage_cliff','af_coverage_cliff');
    return 0;
  end if;

  n := public.mon_raise('P2','af_coverage_cliff','all','af_coverage_cliff',
    jsonb_build_object('cliffs', v_cliffs, 'offenders', v_bad,
      'why','An Advanced Filter field was arriving on this platform''s new listings and has stopped '
         || 'completely, while the platform is still producing listings. That is a parser, mapping or '
         || 'source-shape break -- not a quiet market, because the row count proves the crawl is running. '
         || 'Every new listing since the cliff is unreachable by that AF predicate.',
      'adjudicate','Find the LAYER that stopped: compare the raw payload of a new listing against the '
         || 'same platform''s listing_rich_attrs branch and then against search_listings_ar. Fix the '
         || 'layer, never the rows. If the SOURCE genuinely stopped publishing it, prove that with a '
         || 'live probe read through the production parser AND validated on a known-good control row '
         || 'first -- a failed fetch is indistinguishable from a source omission -- then record the '
         || 'verdict so this stays quiet honestly.'));
  return n;
end $function$;

insert into public.ops_detector_last_full_run(detector, last_run_at, last_result)
values ('af_coverage_cliff', now() - interval '21 hours', 0)
on conflict (detector) do nothing;

comment on function public.mon_detect_af_coverage_cliff() is
  'P2. Generic per (platform x AF field) cliff detector over new listings (first_seen_at). Fires only '
  'when the field WAS arriving and stopped while the crawl keeps running. Senior run #33.';

do $$
declare v_def text; v_new text; v_anchor text; n_anchor int; n_before int; n_after int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='mon_run_all_detectors';
  if position('mon_detect_af_coverage_cliff' in v_def) > 0 then raise notice 'already wired'; return; end if;
  v_anchor := '    ''mon_detect_af_source_mapping_integrity'',
';
  n_anchor := (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  if n_anchor <> 1 then raise exception 'REFUSED: roster anchor not found exactly once (found %)', n_anchor; end if;
  n_before := (length(v_def)-length(replace(v_def,'''mon_detect_','')))/length('''mon_detect_');
  v_new := replace(v_def, v_anchor, v_anchor || '    ''mon_detect_af_coverage_cliff'',
');
  n_after := (length(v_new)-length(replace(v_new,'''mon_detect_','')))/length('''mon_detect_');
  if n_after <> n_before + 1 then raise exception 'REFUSED: roster count moved % -> % (expected +1)', n_before, n_after; end if;
  execute v_new;
end $$;
