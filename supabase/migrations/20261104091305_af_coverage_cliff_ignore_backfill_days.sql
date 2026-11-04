-- af_coverage_cliff: a BACKFILL day is not new-listing flow (🔬 2026-11-04, alert 12665).
-- muktamel_residential_listings «بيع» read as a car_entrance cliff (144 of 724 prior → 0 of 55) because 550 of the
-- 724 prior rows were ONE re-import day (2026-09-29, 128 car_entrance yeses); the real arrival rate is ~1 in 15
-- and the next new sale ad (2026-11-04) carried it again. A prior day whose new-row count exceeds
-- max(20, 10 × the side's recent daily average) is a backfill / re-key / launch day and is left out of the
-- baseline, so the detector compares new arrivals with new arrivals.
CREATE OR REPLACE FUNCTION public.mon_detect_af_coverage_cliff()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  MIN_PRIOR_ROWS  constant int := 30;
  MIN_PRIOR_PCT   constant numeric := 10.0;
  BACKFILL_FACTOR constant numeric := 10.0;  -- a prior day > 10x the recent daily flow is a backfill, not arrivals
  cols text[]; agg text; q text; r record; c text;
  rv bigint; pv bigint; prior_rows bigint; rate numeric;
  n int := 0; v_bad jsonb := '[]'::jsonb; v_cliffs int := 0;
begin
  if not public.mon_claim_daily_slot('af_coverage_cliff') then return 0; end if;

  select array_agg(z.c order by z.c) into cols from (
    select distinct m[1] c
      from (select public.af_eligibility_clause() t) src,
           regexp_matches(src.t, 's\.([a-z_0-9]+)', 'g') m
    intersect
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'search_listings_ar') z;

  if cols is null or array_length(cols, 1) < 20 then
    raise exception 'refusing to run: AF predicate column set looks wrong (%)', cols;
  end if;

  select string_agg(format(
      'count(*) filter (where s.first_seen_at > now()-interval ''7 days'' and s.%I is not null) as r_%s,'
      ' count(*) filter (where s.first_seen_at <= now()-interval ''7 days'''
      ' and s.first_seen_at > now()-interval ''37 days'' and k.dy is null and s.%I is not null) as p_%s', x, x, x, x), ', ')
    into agg from unnest(cols) x;

  q := format('with d as (select source_table, deal_ar, first_seen_at::date dy, count(*) n
                            from public.search_listings_ar
                           where first_seen_at > now()-interval ''37 days'' group by 1, 2, 3),
                    rec as (select source_table, deal_ar,
                                   coalesce(sum(n) filter (where dy > (now()-interval ''7 days'')::date), 0) r
                              from d group by 1, 2),
                    spike as (select d.source_table, d.deal_ar, d.dy
                                from d join rec using (source_table, deal_ar)
                               where d.dy <= (now()-interval ''7 days'')::date
                                 and d.n > greatest(20, %s * rec.r / 7.0))
               select s.source_table, s.deal_ar,
                 count(*) filter (where s.first_seen_at > now()-interval ''7 days'') as recent_rows,
                 count(*) filter (where s.first_seen_at <= now()-interval ''7 days''
                   and s.first_seen_at > now()-interval ''37 days'' and k.dy is null) as prior_rows, %s
               from public.search_listings_ar s
               left join spike k on k.source_table = s.source_table
                                and k.deal_ar is not distinct from s.deal_ar
                                and k.dy = s.first_seen_at::date
               group by 1, 2', BACKFILL_FACTOR, agg);

  for r in execute q loop
    if (to_jsonb(r)->>'recent_rows')::bigint >= 50 then
      prior_rows := (to_jsonb(r)->>'prior_rows')::bigint;
      foreach c in array cols loop
        rv := (to_jsonb(r)->>('r_'||c))::bigint;
        pv := (to_jsonb(r)->>('p_'||c))::bigint;
        rate := round(100.0 * pv / nullif(prior_rows, 0), 2);
        if rv = 0 and pv >= MIN_PRIOR_ROWS and coalesce(rate, 0) >= MIN_PRIOR_PCT then
          v_cliffs := v_cliffs + 1;
          v_bad := v_bad || jsonb_build_object(
            'source_table', r.source_table, 'deal_ar', r.deal_ar, 'af_field', c,
            'new_listings_last_7d', (to_jsonb(r)->>'recent_rows')::bigint,
            'with_value_last_7d', 0,
            'with_value_prior_30d', pv,
            'prior_rows_30d', prior_rows,
            'prior_rate_pct', rate);
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
      'monitored_fields', array_length(cols, 1),
      'floor', jsonb_build_object('min_prior_rows', MIN_PRIOR_ROWS, 'min_prior_pct', MIN_PRIOR_PCT,
                                  'backfill_day_factor', BACKFILL_FACTOR),
      'why','An Advanced Filter PREDICATE field was arriving on this platform''s new listings of one deal side from a '
         || 'real baseline and has stopped completely, while the platform is still producing '
         || 'listings on that side. That is a parser, mapping or source-shape break -- not a quiet market, '
         || 'because the row count proves the crawl is running. Every new listing since the cliff is '
         || 'unreachable by that AF predicate. The monitored set is derived from '
         || 'af_eligibility_clause() itself, so every field named here IS filterable. Backfill / re-import '
         || 'days (a prior day above 10x the recent daily flow) are left out of the baseline.',
      'adjudicate','Find the LAYER that stopped: compare the raw payload of a new listing against the '
         || 'same platform''s listing_rich_attrs branch and then against search_listings_ar. Fix the '
         || 'layer, never the rows. If the SOURCE genuinely stopped publishing it, prove that with a '
         || 'live probe read through the production parser AND validated on a known-good control row '
         || 'first -- a failed fetch is indistinguishable from a source omission -- then record the '
         || 'verdict so this stays quiet honestly.'));
  return n;
end
$function$;