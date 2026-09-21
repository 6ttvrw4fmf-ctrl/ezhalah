-- A DECIDED SOURCE IS NOT A GAP (routine-5, 2026-09-21).
--
-- mon_af_new_listing_readiness() section C raised af_age_source_unregistered on the predicate
-- `raw_aged >= 20 and resolved_aged = 0` and NEVER consulted age_source_registry -- while telling
-- the reader "no age_source_registry entry ... until a human adds one".
--
-- For muktamel_residential_listings and muktamel_commercial_listings that sentence is FALSE. Both
-- carry a registry row written on 2026-09-03 with trusted = false, after a live probe of the
-- source: muktamel publishes an open-ended «+10 سنة» bucket that the ingest stored as a precise 11
-- (listing 32221 probed live -- page «عمر العقار +10 سنة», row 11), so 43 active rows carried a
-- fabricated precision against 4 genuine 10s. Refusing it is the CORRECT outcome, and
-- rebuild_age_producer() withholding it is that decision being honoured -- which is exactly why
-- resolved_aged = 0. The monitor read the consequence of the decision as the absence of one.
--
-- Two harms, and the second is the dangerous one:
--   1. Two standing false P2s train every reader to discount the alert kind.
--   2. The alert's own `fix` text says to insert a registry row. Followed literally on muktamel --
--      a row already exists, so the only way to "fix" it is to flip trusted = true -- and that
--      admits the fabricated +10 -> 11 precision into the Advanced Filter age predicate. A false
--      alert whose remediation corrupts AF age data is worse than no alert.
--
-- The correct rule is already written down, in the sibling detector mon_detect_age_resolver_
-- platform_gap(), verbatim: "A platform is a GAP only when nothing has ever decided about it.
-- Registered-but-withheld (trusted = false, or age_source_health() verdict <> 'ok') is a decision,
-- and stays silent: that is rebuild_age_producer() doing its job, not a defect." The registry note
-- on erapulse_commercial_listings says the same from the other side -- it was registered
-- specifically so that detector "stops reading a decided source as undecided". Section C simply
-- never got the rule. This migration gives it the rule, and adds the detector that catches its
-- return.
--
-- Section C's ONLY change is the guard at the top of its loop; every other line of this function is
-- reproduced verbatim from production's pg_get_functiondef.

CREATE OR REPLACE FUNCTION public.mon_af_new_listing_readiness()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  total int := 0; def text; missing text; t text; seg record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text; sel text; fresh_rate numeric; all_rate numeric;
  raw_aged bigint; resolved_aged bigint;
  never_fetched bigint; last_try timestamptz; fetch_state text; advice text;
begin
  -- A. every cohort platform must have a listing_extra_attrs branch
  -- Catalog membership, not a text search of the view body: listing_extra_attrs is a WRAPPER over
  -- listing_extra_attrs_v1, so no platform table name appears in its own SQL and the old
  -- position()-based test reported the entire fleet as unmapped (false P1 alert_event 2705,
  -- 77 tables, every one of which had rows). See af_extra_attrs_uncovered_tables().
  select string_agg(u.source_table, ', ' order by u.source_table) into missing
    from public.af_extra_attrs_uncovered_tables() u;
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
    -- A DECIDED SOURCE IS NOT A GAP (2026-09-21). resolved_aged = 0 has TWO causes and they need
    -- opposite responses: nobody has ever judged the platform (a real gap, raise), or somebody
    -- judged it and said NO (trusted = false, or an age_source_health() verdict other than 'ok'),
    -- in which case the zero is rebuild_age_producer() honouring that decision. The registry row
    -- IS the decision, so its presence is the whole test -- the same rule
    -- mon_detect_age_resolver_platform_gap() states in its own body. Without this guard the
    -- deliberate 2026-09-03 refusal of muktamel's «+10 سنة» bucket read as an oversight, and the
    -- alert's own `fix` text invited the reader to flip trusted = true and admit the fabricated
    -- precision into the Advanced Filter age predicate.
    if exists (select 1 from public.age_source_registry g where g.source_table = t) then
      perform public.mon_resolve_key('af_age_source_unregistered','af_age_source_unregistered:'||t);
      continue;
    end if;
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
          'fix','Adjudicate the platform against its LIVE source first (AGENTS.md permanent rule '
             || '#2: a missing captured field is not evidence the source omits it), then insert '
             || 'the platform into public.age_source_registry with the right strategy and trusted '
             || 'flag -- trusted = false IS a valid outcome and silences this alert, because a '
             || 'recorded refusal is a decision. rebuild_age_producer() picks up a trusted row on '
             || 'the next hourly run (jobid 46), and age_source_health() still gates admission.'));
    else
      perform public.mon_resolve_key('af_age_source_unregistered','af_age_source_unregistered:'||t);
    end if;
  end loop;

  return total;
end
$function$;


-- THE BARRIER. The fix above lives in one branch of one plpgsql function; nothing in the repo can
-- see a revert, because Postgres is not in the tree. This detector watches the OUTPUT instead: if
-- an af_age_source_unregistered alert is ever open against a source that age_source_registry has
-- already decided, the rule has been lost again -- whoever lost it, and whichever raiser did it.
-- It is an invariant over state, not a copy of the predicate, so it survives a rewrite of section C.
CREATE OR REPLACE FUNCTION public.mon_detect_age_gap_alert_on_decided_source()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0; v_rows jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'source_table', g.source_table,
           'trusted', g.trusted,
           'registered_at', g.updated_at,
           'alert_id', a.id,
           'decision', left(coalesce(g.note,''), 240)))
    into v_rows
    from public.alert_event a
    join public.age_source_registry g
      on a.dedup_key = 'af_age_source_unregistered:' || g.source_table
   where a.kind = 'af_age_source_unregistered'
     and a.resolved_at is null;

  if v_rows is null then
    perform public.mon_resolve_key('age_gap_alert_on_decided_source',
                                   'age_gap_alert_on_decided_source');
    return 0;
  end if;

  n := public.mon_raise('P2','age_gap_alert_on_decided_source','all',
    'age_gap_alert_on_decided_source',
    jsonb_build_object(
      'sources', v_rows,
      'why','These platforms carry an age_source_registry row -- somebody adjudicated them against '
          || 'the live source and recorded the verdict -- and an af_age_source_unregistered alert '
          || 'is open against them anyway, saying no entry exists. A registry row with '
          || 'trusted = false (or a health verdict other than ''ok'') means listing_age_resolved is '
          || 'EMPTY FOR THIS PLATFORM ON PURPOSE; reading that emptiness back as an unregistered '
          || 'source turns a recorded decision into a standing false alarm.',
      'adjudicate','Do NOT silence this by flipping trusted = true, and do NOT re-register the '
          || 'platform -- the row already exists and its note carries the evidence. The defect is '
          || 'in whatever raised the alert: it must treat the presence of a registry row as the '
          || 'decision it is (mon_af_new_listing_readiness section C, guarded 2026-09-21; the same '
          || 'rule mon_detect_age_resolver_platform_gap() states in its own body). Fix the raiser, '
          || 'then let it self-heal via mon_resolve_key.'));
  return n;
end
$function$;


-- ROSTER. A detector nothing reaches is decoration (AGENTS.md), and mon_detect_orphaned_detectors()
-- fires on exactly that -- so the wrapper and its roster entry land in this one migration.
DO $roster$
DECLARE src text; ins text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mon_run_all_detectors';

  IF src IS NULL THEN
    RAISE EXCEPTION 'mon_run_all_detectors() not found - refusing to leave the new detector orphaned';
  END IF;

  IF position('mon_detect_age_gap_alert_on_decided_source' in src) > 0 THEN
    RAISE NOTICE 'already on the roster - nothing to do';
    RETURN;
  END IF;

  -- Splice beside the sibling detector that already states this rule, so the two read together.
  IF position('''mon_detect_age_resolver_platform_gap''' in src) = 0 THEN
    RAISE EXCEPTION 'anchor mon_detect_age_resolver_platform_gap missing from the roster - refusing to guess a splice point';
  END IF;

  ins := replace(src,
    '''mon_detect_age_resolver_platform_gap''',
    '''mon_detect_age_resolver_platform_gap'',' || chr(10) ||
    '    ''mon_detect_age_gap_alert_on_decided_source''');

  IF ins = src THEN
    RAISE EXCEPTION 'roster splice produced no change - refusing to claim a wiring that did not happen';
  END IF;

  EXECUTE ins;
END
$roster$;
