-- Correct the cost note on mon_af_new_listing_readiness (AF+Trending Data Integrity Engineer,
-- run 2026-08-25, same run as 20260825121615).
--
-- The migration applied minutes earlier justified keeping the new capture_state discriminator on the
-- raise path by saying the detector runs inside the twice-hourly mon_run_all_detectors() sweep, which
-- is near its statement_timeout. That reasoning was WRONG about the caller, and a future engineer
-- would have inherited the mistake:
--
--   mon_af_new_listing_readiness() is NOT in the mon_run_all_detectors() roster. It is reached by its
--   own dedicated daily pg_cron job 69 ('52 6 * * *' — 06:52 UTC), which sets statement_timeout to
--   600s and runs mon_rich_attrs_barrier() then this function. That is why today's two
--   af_new_listing_capture_regression alerts are stamped 06:52 and not on a :29/:59 boundary.
--   mon_detect_orphaned_detectors() already knows this detector is reached that way, so it is
--   deliberately outside the roster rather than orphaned.
--
-- The engineering decision does not change — a discriminator that runs per raise instead of per
-- segment × per field is still the right shape, and job 69's 600s budget is a real ceiling worth
-- staying well inside. Only the stated reason changes, from the wrong caller to the right one.
--
-- The function body below is byte-identical to 20260825121615 apart from that one inline comment, so
-- nothing about detection, severity, dedup keys or resolve behaviour moves. Re-applied (rather than
-- editing the earlier file in place) so the repo and supabase_migrations.schema_migrations.statements
-- agree on both versions, and the record of what was actually applied first stays intact.
create or replace function public.mon_af_new_listing_readiness()
 returns integer
 language plpgsql
as $function$
declare
  total int := 0; def text; missing text; t text; seg record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text; sel text; fresh_rate numeric; all_rate numeric;
  raw_aged bigint; resolved_aged bigint;
  never_fetched bigint; last_try timestamptz; fetch_state text; advice text;
begin
  -- A. every cohort platform must have a listing_extra_attrs branch
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
     and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_new_listing_unmapped_platform', 1,
            'Certified-cohort platforms with NO listing_extra_attrs branch (new listings '
         || 'cannot reach the interview chips): ' || missing);
    perform public.mon_raise('P1','af_new_listing_unmapped_platform','search_index',
      'af_new_listing_unmapped_platform',
      jsonb_build_object('platforms', missing,
        'why','Certified-cohort platforms with no listing_extra_attrs branch: their NEW '
            || 'listings are searchable but arrive blind to every Advanced-Filter chip.'));
  else
    perform public.mon_resolve_key('af_new_listing_unmapped_platform','af_new_listing_unmapped_platform');
  end if;

  -- B. capture regression on fresh listings, per COHORT SEGMENT x platform x interview field.
  -- Grouped per enabled registry row (pooled version masked دور 0% behind شقة 90% — live miss
  -- 2026-08-15). PROVEN source-side changes acknowledged in ops_amenity_capture_verified.
  select string_agg(format(
    '%L, jsonb_build_array(avg((s.%I is not null)::int) filter (where raw.scraped_at > now() - interval ''48 hours''), avg((s.%I is not null)::int))',
    x, x, x), ', ') into sel from unnest(fields) x;
  for t in select distinct s.source_table from public.search_listings_ar s
            where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
  loop
    continue when not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='scraped_at');
    for seg in execute format($f$
      select c.deal_ar, coalesce(c.rent_period_ar,'*') as period_key, c.type_ar,
             count(*) filter (where raw.scraped_at > now() - interval '48 hours') as fresh_n,
             jsonb_build_object(%s) as stats
        from public.search_listings_ar s
        join public.%I raw on raw.id = s.listing_id
        join public.af_cohort_registry c
          on c.enabled and c.deal_ar = s.deal_ar and c.type_ar = s.type_ar
         and (c.rent_period_ar is null or c.rent_period_ar = s.rent_period_ar)
       where s.source_table = %L and s.production_ready
       group by 1,2,3
    $f$, sel, t, t) loop
      foreach f in array fields loop
        fresh_rate := nullif(seg.stats->f->>0, '')::numeric;
        all_rate   := nullif(seg.stats->f->>1, '')::numeric;
        if seg.fresh_n >= 20 and all_rate >= 0.20 and coalesce(fresh_rate, 0) < all_rate * 0.5
           and not exists (select 1 from public.ops_amenity_capture_verified w
                            where w.source_table = t and w.field = f and w.deal_ar = seg.deal_ar
                              and w.rent_period_key = seg.period_key and w.type_ar = seg.type_ar) then
          total := total + 1;

          -- ── WHICH failure is this? ───────────────────────────────────────────────────────────────
          -- A field can be NULL because the detail page was never fetched (upstream block) or because
          -- it WAS fetched and the value is gone (parser/source). Those need opposite responses, and
          -- the raw row knows which one happened.
          -- RAISE PATH ONLY, deliberately: this whole function runs under pg_cron job 69
          -- ('52 6 * * *') with statement_timeout 600s. Raises are rare (2 in today's run), so one
          -- extra query per raise is free, while one per segment × per field would not be.
          never_fetched := null; last_try := null;
          if exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name=t and column_name='detail_enriched')
             and exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name=t and column_name='enrich_attempted_at')
          then
            execute format($d$
              select count(*) filter (where not coalesce(raw.detail_enriched,false)),
                     max(raw.enrich_attempted_at)
                from public.search_listings_ar s
                join public.%I raw on raw.id = s.listing_id
               where s.source_table = %L and s.production_ready
                 and raw.scraped_at > now() - interval '48 hours'
                 and s.deal_ar = %L and s.type_ar = %L
                 and (%L = '*' or s.rent_period_ar = %L)
            $d$, t, t, seg.deal_ar, seg.type_ar, seg.period_key, seg.period_key)
            into never_fetched, last_try;
          end if;
          fetch_state := case
            when never_fetched is null then 'unknown_no_fetch_columns'
            when never_fetched >= greatest(1, (seg.fresh_n * 0.5)::int) then 'upstream_fetch_incomplete'
            else 'fetched_but_field_absent' end;
          advice := case fetch_state
            when 'upstream_fetch_incomplete' then
              'MOST fresh rows in this segment were never successfully detail-fetched '
              || '(detail_enriched=false), so the field''s absence is NOT evidence the source '
              || 'stopped publishing it — the page was never read. Treat this as an UPSTREAM '
              || 'FETCH/BLOCK problem (check proxy_block_spike / rows_collapse / '
              || 'silent_partial_success for this platform) and fix egress. Do NOT rewrite a '
              || 'parser, and do NOT acknowledge it in ops_amenity_capture_verified: a source-side '
              || 'waiver is permanent and would mask the real regression once egress recovers.'
            when 'fetched_but_field_absent' then
              'Fresh rows in this segment WERE detail-fetched and the field is still absent — this '
              || 'is a genuine parser/selector regression (fix it) OR a real source-side change. '
              || 'Only ever the latter with a recorded probe of the live source; only then '
              || 'acknowledge in ops_amenity_capture_verified WITH that evidence.'
            else
              'This platform has no detail_enriched/enrich_attempted_at columns, so fetch state '
              || 'cannot be read from the row. Probe the live source before concluding anything.'
            end;

          insert into public.location_pipeline_alerts(alert_type, metric, detail)
          values ('af_new_listing_capture_regression', seg.fresh_n,
                  format('%s: field %s known on %s%% of fresh 48h listings vs %s%% all-time in cohort '
                      || '%s/%s/%s [%s: %s of %s fresh rows never detail-fetched] — %s',
                      t, f, round(coalesce(fresh_rate,0)*100), round(all_rate*100),
                      seg.deal_ar, seg.period_key, seg.type_ar,
                      fetch_state, coalesce(never_fetched::text,'?'), seg.fresh_n, advice));
          perform public.mon_raise('P2','af_new_listing_capture_regression', t,
            'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar,
            jsonb_build_object('source_table', t, 'field', f, 'deal_ar', seg.deal_ar,
              'rent_period_key', seg.period_key, 'type_ar', seg.type_ar,
              'fresh_48h_rows', seg.fresh_n,
              'fresh_known_pct', round(coalesce(fresh_rate,0)*100),
              'alltime_known_pct', round(all_rate*100),
              'capture_state', fetch_state,
              'fresh_rows_never_detail_fetched', never_fetched,
              'last_enrich_attempt_at', last_try,
              'adjudicate', advice,
              'why','This certified cohort segment: the field stopped arriving on new listings.'));
        else
          perform public.mon_resolve_key('af_new_listing_capture_regression',
            'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar);
        end if;
      end loop;
    end loop;
    -- retire the pre-2026-08-15 pooled key format so no stale open alert lingers
    foreach f in array fields loop
      perform public.mon_resolve_key('af_new_listing_capture_regression',
        'af_new_listing_capture_regression:'||t||':'||f);
    end loop;
  end loop;

  -- C. the source publishes an age, the pipeline drops all of it (age_source_registry is a MANUAL
  --    table with no other monitor). Fires only when raw has ages AND none reach listing_age_resolved,
  --    so a genuinely age-silent platform stays quiet.
  for t in select distinct s.source_table from public.search_listings_ar s
            where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
  loop
    begin
      execute format('select count(*) from public.%I where active and property_age is not null', t)
        into raw_aged;
    exception when undefined_column or undefined_table then continue; end;
    select count(*) into resolved_aged
      from public.listing_age_resolved a where a.source_table = t;
    if raw_aged >= 20 and resolved_aged = 0 then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_age_source_unregistered', raw_aged,
              format('%s publishes property_age on %s active row(s) but contributes 0 rows to '
                  || 'listing_age_resolved — no age_source_registry entry, so the age chips call '
                  || 'every one of its listings "unknown" until a human adds one.', t, raw_aged));
      perform public.mon_raise('P2','af_age_source_unregistered', t,
        'af_age_source_unregistered:'||t,
        jsonb_build_object('source_table', t, 'raw_rows_with_age', raw_aged,
          'fix','insert the platform into public.age_source_registry (strategy/trusted), then '
             || 'rebuild_age_producer() picks it up on the next hourly run (jobid 46).'));
    else
      perform public.mon_resolve_key('af_age_source_unregistered','af_age_source_unregistered:'||t);
    end if;
  end loop;

  return total;
end
$function$;
