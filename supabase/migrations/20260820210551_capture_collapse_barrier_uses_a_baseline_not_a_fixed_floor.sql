-- Senior run #32b. Correction to mon_detect_published_amenity_capture_collapse, caught by its own
-- mutation test rather than by review.
--
-- The first version gated on "at least 100 fresh rows in 48h". Mutation-testing it produced
-- broken=0: aqar_commercial had 93 rows in that window, so the detector SKIPPED instead of firing.
-- A fixed floor over a 48h window makes the barrier depend on crawl timing -- on a slow day it goes
-- quiet precisely when a real capture cliff would be starting. That is the AGENTS.md failure class
-- (a detector that cannot fire reads as a clean bill of health), and it is why the mutation test is
-- run before the barrier is trusted, not after.
--
-- Replaced with a BASELINE-RELATIVE predicate that cannot be dodged by a quiet crawl:
--   * window widened to 7 days (a stable cohort across cadence jitter)
--   * requires >= 50 rows in the window, so a genuinely paused platform still cannot raise
--   * requires the column to have been ARRIVING BEFORE (>0 non-null in the preceding 30 days) --
--     so it fires on a CLIFF, never on a field that was always absent
--   * fires when the column is now 0 across the whole window
-- Verified live: aqar_commercial has 292 rows in 7 days with water_supply 292/292 -> reads 0.

create or replace function public.mon_detect_published_amenity_capture_collapse()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; r record; v_recent bigint; v_recent_known bigint; v_prior_known bigint;
        v_bad jsonb := '[]'::jsonb;
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
                        from public.%I where scraped_at > now() - interval '7 days'$q$,
                   r.column_name, r.source_table) into v_recent, v_recent_known;

    execute format($q$select count(*) filter (where %I is not null)
                        from public.%I
                       where scraped_at <= now() - interval '7 days'
                         and scraped_at >  now() - interval '37 days'$q$,
                   r.column_name, r.source_table) into v_prior_known;

    -- a cliff: it used to arrive, the cohort is big enough to speak, and now none of it arrives
    if v_recent >= 50 and v_recent_known = 0 and v_prior_known > 0 then
      v_bad := v_bad || jsonb_build_object('source_table', r.source_table, 'column', r.column_name,
                 'rows_last_7d', v_recent, 'with_value_last_7d', 0, 'with_value_prior_30d', v_prior_known);
    end if;
  end loop;

  if jsonb_array_length(v_bad) = 0 then
    perform public.mon_resolve_key('published_amenity_capture_collapse','published_amenity_capture_collapse');
    return 0;
  end if;

  n := public.mon_raise('P2','published_amenity_capture_collapse','aqar','published_amenity_capture_collapse',
    jsonb_build_object('offenders', v_bad,
      'why','A column the recorded source probe says this platform DOES publish with real values was '
         || 'arriving until recently and is now absent from every row in the last 7 days. That is a '
         || 'capture cliff -- a source shape change, a renamed key, or a parser/enricher that stopped '
         || 'reading it -- not a quiet market: the row count proves the crawl is still running.',
      'adjudicate','Re-probe live through production''s own oracle (_listing_json + _amenities) and '
         || 'VALIDATE THE HARNESS ON A KNOWN-GOOD CONTROL ROW first -- a failed fetch looks exactly '
         || 'like a source omission. Counting key presence is not enough: aqar sends the commercial '
         || 'extended_details amenity keys as always-null, which is UNKNOWN, not a published value. '
         || 'If the source really dropped the field, record the new verdict in '
         || 'ops_aqar_commercial_amenity_probe -- never backfill from prose to make this green.'));
  return n;
end $function$;
