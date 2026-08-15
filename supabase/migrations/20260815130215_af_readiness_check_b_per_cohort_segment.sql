-- READINESS CHECK B: per-cohort-segment granularity (2026-08-15).
-- The pooled per-(platform x field) version let one healthy segment mask another's collapse:
-- aqar شقة kitchen at 90% fresh hid aqar دور kitchen at 0% fresh — a live miss found during the
-- six-cohort certification. Root cause of the underlying decline is SOURCE-SIDE (aqar removed
-- kitchen/elevator checkboxes from its دور ad forms and AC from its بيع forms ~2026-06-21; the
-- weekly timeline pins the break at Jun 22, code unchanged, private_entrance/age/furnished keys
-- still parse on the same rows). Nothing to backfill: these columns are structured-only by design
-- (prose is NOT a source field) and aqar no longer publishes the fields for those segments.
-- ops_amenity_capture_verified acknowledges PROVEN source-side changes per (platform, field,
-- segment) so the alarm stays meaningful instead of eternally un-closeable.
create table public.ops_amenity_capture_verified (
  source_table    text not null,
  field           text not null,
  deal_ar         text not null,
  rent_period_key text not null default '*',
  type_ar         text not null,
  note            text not null,
  verified_at     timestamptz not null default now(),
  primary key (source_table, field, deal_ar, rent_period_key, type_ar)
);
comment on table public.ops_amenity_capture_verified is
  'Acknowledged SOURCE-SIDE capture changes: the platform stopped publishing this field for this segment. Scoped waiver for mon_af_new_listing_readiness check B. Evidence required in note.';

insert into public.ops_amenity_capture_verified (source_table, field, deal_ar, rent_period_key, type_ar, note) values
 ('aqar_residential_listings','kitchen','بيع','*','دور',
  '2026-08-15 certification: fresh 0/504 vs all-time 29%; weekly series breaks 2026-06-22 (45.6%→7.6%); parser unchanged (no commits Jun-Jul); same fresh rows parse age 100%/private_entrance 82% so payload IS read — aqar dropped the checkbox from the دور form.'),
 ('aqar_residential_listings','elevator','بيع','*','دور',
  '2026-08-15 certification: fresh 0/504 vs all-time 29%; identical lockstep with kitchen (same form change).'),
 ('aqar_residential_listings','air_conditioner','بيع','*','دور',
  '2026-08-15 certification: fresh 0/504 vs all-time 29%; AC dropped from بيع forms only — same-day دور/إيجار AC is 84% fresh, proving parser + payload path healthy.'),
 ('aqar_residential_listings','air_conditioner','بيع','*','شقة',
  '2026-08-15 certification: fresh 0/2374 vs all-time 32%; same بيع-form AC removal — شقة/إيجار AC 90% fresh on the same code path.');

create or replace function public.mon_af_new_listing_readiness()
returns integer language plpgsql as $function$
declare
  total int := 0; def text; missing text; t text; r record; seg record;
  fields constant text[] := array['air_conditioner','elevator','kitchen','private_entrance',
    'parking','maid_room','driver_room','furnished','bathrooms','property_age'];
  f text;
  raw_aged bigint; resolved_aged bigint;
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
  -- 2026-08-15: was pooled per (platform x field) across the registry union, which let a healthy
  -- segment mask another's collapse (aqar شقة kitchen 90% fresh hid دور kitchen 0%). Grouped per
  -- enabled registry row; PROVEN source-side changes are acknowledged in
  -- ops_amenity_capture_verified (platform+field+segment scoped, evidence required).
  for t in select distinct s.source_table from public.search_listings_ar s
            where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
  loop
    continue when not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='scraped_at');
    foreach f in array fields loop
      begin
        for seg in execute format($f$
          select c.deal_ar, coalesce(c.rent_period_ar,'*') as period_key, c.type_ar,
                 count(*) filter (where raw.scraped_at > now() - interval '48 hours') as fresh_n,
                 avg((s.%1$I is not null)::int) filter (where raw.scraped_at > now() - interval '48 hours') as fresh_rate,
                 avg((s.%1$I is not null)::int) as all_rate
            from public.search_listings_ar s
            join public.%2$I raw on raw.id = s.listing_id
            join public.af_cohort_registry c
              on c.enabled and c.deal_ar = s.deal_ar and c.type_ar = s.type_ar
             and (c.rent_period_ar is null or c.rent_period_ar = s.rent_period_ar)
           where s.source_table = %3$L and s.production_ready
           group by 1,2,3
        $f$, f, t, t) loop
          if seg.fresh_n >= 20 and seg.all_rate >= 0.20 and coalesce(seg.fresh_rate, 0) < seg.all_rate * 0.5
             and not exists (select 1 from public.ops_amenity_capture_verified w
                              where w.source_table = t and w.field = f and w.deal_ar = seg.deal_ar
                                and w.rent_period_key = seg.period_key and w.type_ar = seg.type_ar) then
            total := total + 1;
            insert into public.location_pipeline_alerts(alert_type, metric, detail)
            values ('af_new_listing_capture_regression', seg.fresh_n,
                    format('%s: field %s known on %s%% of fresh 48h listings vs %s%% all-time in cohort '
                        || '%s/%s/%s — the scraper likely stopped capturing it; new listings in this '
                        || 'cohort are arriving blind to the Advanced Filter. If PROVEN source-side, '
                        || 'acknowledge in ops_amenity_capture_verified with evidence.',
                        t, f, round(coalesce(seg.fresh_rate,0)*100), round(seg.all_rate*100),
                        seg.deal_ar, seg.period_key, seg.type_ar));
            perform public.mon_raise('P2','af_new_listing_capture_regression', t,
              'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar,
              jsonb_build_object('source_table', t, 'field', f, 'deal_ar', seg.deal_ar,
                'rent_period_key', seg.period_key, 'type_ar', seg.type_ar,
                'fresh_48h_rows', seg.fresh_n,
                'fresh_known_pct', round(coalesce(seg.fresh_rate,0)*100),
                'alltime_known_pct', round(seg.all_rate*100),
                'why','This certified cohort segment: the field stopped arriving on new listings.'));
          else
            perform public.mon_resolve_key('af_new_listing_capture_regression',
              'af_new_listing_capture_regression:'||t||':'||f||':'||seg.deal_ar||':'||seg.period_key||':'||seg.type_ar);
          end if;
        end loop;
      exception when undefined_column then continue; end;
      -- retire the pre-2026-08-15 pooled key format so no stale open alert lingers
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
    -- >= 20 is the same noise floor part B already uses. A 2-row trickle (eastabha today) is below
    -- age_source_health()'s own 'too_small' verdict, so registering it would change nothing and the
    -- alert could never be closed — exactly the un-actionable noise the 2026-08-12 issue flood was.
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

-- must be clean NOW: the 4 proven source-side segments are waived, nothing else fires
do $do$
declare n int;
begin
  select public.mon_af_new_listing_readiness() into n;
  if n <> 0 then raise exception 'ABORT: readiness=% after per-segment upgrade (expected 0 with waivers)', n; end if;
end $do$;