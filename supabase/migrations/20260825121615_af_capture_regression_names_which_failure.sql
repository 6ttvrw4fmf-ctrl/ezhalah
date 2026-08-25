-- af_new_listing_capture_regression must say WHICH failure it found (AF+Trending Data Integrity
-- Engineer, run 2026-08-25).
--
-- WHY. On 2026-08-25 this detector correctly raised on wasalt_commercial_listings/property_age for
-- two certified segments (إيجار/سنوي/مكتب and .../معرض): fresh-48h known 19–22% against 91–94%
-- all-time. Its alert says "the scraper likely stopped capturing it" and offers exactly ONE escape
-- hatch — acknowledge it in ops_amenity_capture_verified "if PROVEN source-side". Both of those
-- readings were WRONG here, and both would have caused damage:
--
--   * it is not a parser regression — wasalt's enrich pass never got the detail page at all. All 94
--     rows added since 2026-08-22 carry enrich_attempted_at (the job ran and retried them) with
--     detail_enriched=false (fetch_detail returned not-ok: network/403/block). scrapers/wasalt/
--     enrich.py only writes property_age on the ok+deep branch, so the column stays NULL — correctly
--     UNKNOWN, never guessed. The platform simultaneously carries open proxy_block_spike,
--     rows_collapse and silent_partial_success alerts. Root cause is EGRESS.
--   * and it must NOT be waived as source-side — a waiver is FOREVER: it would permanently mask a
--     real capture regression on this segment the day wasalt's egress recovers.
--
-- This is the exact failure the owner's permanent rule of 2026-08-13 exists for: "a missing captured
-- field is NOT evidence that the source omits it — a failed fetch looks identical". The rule was
-- written for humans reading the alert; this teaches the alert to tell the two apart itself.
--
-- WHAT CHANGES. Nothing about WHEN the detector fires — the raise condition, severity, dedup key and
-- resolve path are byte-identical, and this deliberately does NOT suppress anything (silencing a
-- barrier to make it green is forbidden; making it distinguish cases is the fix). The alert payload
-- gains three evidence fields and a routing line:
--   capture_state                    upstream_fetch_incomplete | fetched_but_field_absent
--                                    | unknown_no_fetch_columns
--   fresh_rows_never_detail_fetched  rows in THIS segment's 48h window with detail_enriched=false
--   last_enrich_attempt_at           proves whether the enrich job is even still trying
--   adjudicate                       what to do, and what not to do, for that state
--
-- COST. The discriminator query runs ONLY on the raise path (2 executions in today's whole sweep),
-- never in the per-segment × per-field scan — deliberate, because the twice-hourly sweep is already
-- near its statement_timeout budget (open detector_sweep_budget alert) and a rolled-back sweep
-- discards every alert it had raised.
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

          -- ── WHICH failure is this? (raise path only — see the header note on sweep cost) ────────
          -- A field can be NULL because the detail page was never fetched (upstream block) or
          -- because it WAS fetched and the value is gone (parser/source). Those need opposite
          -- responses, and the raw row knows which one happened.
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
