-- (1) severity ranking + an alert that can escalate.
-- mon_raise() returned 0 the moment an open alert_event existed for the dedup key, so an alert
-- that opened at P2 stayed P2 forever carrying the numbers it was born with. dealapp_residential
-- opened stale_active at P2 on 2026-07-27 (frac 0.234 / active 3873 / stale_7d 905); today the real
-- figure is frac 0.414 / active 7212 / stale_7d 2985, past the 0.30 crit threshold, still shown as
-- a three-week-old P2. That is why dealapp went 30 days with zero deactivations without paging
-- anyone. Fleet-wide: every detector routes through mon_raise.
create or replace function public.mon_sev_rank(p_sev text)
returns integer
language sql
immutable
as $function$
  select case upper(coalesce(p_sev,'')) when 'P1' then 3 when 'P2' then 2 when 'P3' then 1 else 0 end;
$function$;

comment on function public.mon_sev_rank(text) is
  'Severity ordering for alert escalation. Higher = worse. P1 3 > P2 2 > P3 1 > unknown 0.';

create or replace function public.mon_raise(p_sev text, p_kind text, p_platform text, p_dedup text, p_detail jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id bigint; v_sev text; v_escalated boolean;
begin
  select id, severity into v_id, v_sev
    from public.alert_event
   where dedup_key = p_dedup and resolved_at is null
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.alert_event(severity, kind, platform, dedup_key, detail)
    values (p_sev, p_kind, p_platform, p_dedup, coalesce(p_detail,'{}'::jsonb));
    return 1;
  end if;

  -- Still exactly ONE open row per dedup key -- this is not alert spam. But an open alert must
  -- never go stale or under-report: refresh the payload every run so the dashboard shows today's
  -- numbers, and if the condition has got WORSE, promote the severity and re-arm both dispatch and
  -- acknowledgement so the escalation actually reaches a human. mon_dispatch_alerts() only sends
  -- rows with dispatched_at IS NULL, so clearing it is what makes the page happen.
  v_escalated := public.mon_sev_rank(p_sev) > public.mon_sev_rank(v_sev);

  update public.alert_event
     set detail          = coalesce(p_detail,'{}'::jsonb),
         severity        = case when v_escalated then p_sev else severity end,
         dispatched_at   = case when v_escalated then null else dispatched_at end,
         acknowledged_at = case when v_escalated then null else acknowledged_at end
   where id = v_id;

  return case when v_escalated then 1 else 0 end;
end $function$;

comment on function public.mon_raise(text,text,text,text,jsonb) is
  'Raise or update one open alert per dedup_key. Refreshes detail every call; escalates severity and re-arms dispatch when the condition worsens. Returns 1 on a new alert or an escalation.';

-- (2) drift must compare like with like, and the withheld rows must stay visible.
-- search_listings_ar carries a BEFORE INSERT OR UPDATE trigger (trg_price_size_sanity ->
-- enforce_price_size_sanity) setting production_ready := false when price_size_impossible() holds.
-- listing_native_location_v2.production_ready is a pure location expression with no price/area
-- term. sync_search_listings_ar() has a self-repair arm for that exact column, so every hour it
-- rewrote the row, the trigger flipped it back, and the monitor counted it as drift two minutes
-- later -- ~90 consecutive samples pinned at 33/34/36 since 2026-08-06 18:17 UTC. Real location
-- drift was invisible behind that floor.
create or replace function public.location_pipeline_monitor()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_drift bigint; v_dup bigint; v_deal_gap bigint; v_withheld bigint;
begin
  -- Expected index state = what sync_search_listings_ar() writes, THEN what the BEFORE trigger
  -- does to it. Modelling only the first half is what pinned this alert at a permanent floor.
  select count(*) into v_drift from search_listings_ar s
    join listing_native_location_v2 v on v.source_table=s.source_table and v.listing_id=s.listing_id
    where s.city_id is distinct from v.city_id or s.region_id is distinct from v.region_id
       or s.district_ar is distinct from v.district_ar
       or s.production_ready is distinct from (v.production_ready
            and not public.price_size_impossible(v.price_total, v.price_annual, v.area_m2));
  if v_drift > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('search_v2_drift', v_drift, 'search index disagrees with resolver (v2) on location for '||v_drift||' row(s)');
  end if;

  -- The gate is now excluded from the drift count, so it must be reported under its own name --
  -- otherwise this change would silently bury a population that includes listings whose prices the
  -- source platform genuinely publishes. Owner decision pending; the number must stay in view.
  select count(*) into v_withheld from search_listings_ar s
    where not s.production_ready
      and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);
  if v_withheld > 0 then
    perform public.mon_raise('P2','price_gate_withheld','search_index','price_gate_withheld',
      jsonb_build_object('count', v_withheld,
        'why','listings withheld from search by the price/size plausibility gate (trg_price_size_sanity). Verified 2026-08-09: 28 of 34 carry values the source platform itself publishes, so the gate is hiding source-published data, contrary to the standing rule that a source price stays searchable at any magnitude. Needs an owner decision; the remainder are parser bugs.'));
  else
    perform public.mon_resolve_key('price_gate_withheld','price_gate_withheld');
  end if;

  select count(*) into v_dup from (select source_table, listing_id from listing_native_location_v2 group by 1,2 having count(*)>1) d;
  if v_dup > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('v2_duplicate_pk', v_dup, 'listing_native_location_v2 emits '||v_dup||' duplicate (source_table,listing_id) row(s)');
  end if;

  with gap as (
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_residential_listings r on r.id = s.listing_id and s.source_table='dealapp_residential_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
    union all
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_commercial_listings r on r.id = s.listing_id and s.source_table='dealapp_commercial_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
  ),
  resolvable as (
    select g.source_table, g.listing_id
    from gap g
    join district_name_bridge b on norm_en_district(b.district_en) = norm_en_district(g.neighborhood) and b.district_en !~ '[ء-ي]'
    join loc_catalog_district lc on lc.city_id = g.city_id and lc.district_norm = normalize_ar(b.district_ar)
    group by g.source_table, g.listing_id
    having count(distinct lc.district_ar) = 1
  )
  select count(*) into v_deal_gap from resolvable;
  if v_deal_gap > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('dealapp_district_unresolved', v_deal_gap, v_deal_gap||' production_ready dealapp listing(s) lack a district despite a unique catalogued match — resolver may be stalled');
  end if;

  insert into location_pipeline_alerts(alert_type, metric, detail)
  select 'cron_job_unhealthy', j.jobid,
         'jobid '||j.jobid||' ('||j.jobname||') last status='||coalesce(r.status,'never run')||' ended '||coalesce(r.end_time::text,'n/a')
  from cron.job j
  left join lateral (select status, end_time from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1) r on true
  where j.jobname in ('refresh_listing_native_location_v1','resolve-aqar-locations','sync-search-listings-ar','resolve-dealapp-districts')
    and (r.status is distinct from 'succeeded' or r.end_time < now() - interval '150 minutes');
end $function$;

-- (3) souq24 branches must not double-emit rows that branch 1 already produces.
-- listing_native_location_v2 is a UNION ALL. Branch 4 (catch-all) excludes souq24 AND carries a
-- NOT EXISTS guard against listing_native_location_v1; the two souq24 branches carry neither, so a
-- souq24 row present in v1 is emitted by branch 1 AND by its souq24 branch. Exactly 2 rows today
-- (souq24_residential_listings 648152, 648160), each copy with a different city_id, which the
-- sync's `distinct on ... order by last_updated desc nulls last` then resolves arbitrarily.
-- The guard is tied to "branch 1 will ACTUALLY emit a replacement" (v1 AND active_listing_ids_v2
-- membership), not v1 membership alone: both are matviews read against a live source table, so
-- during refresh skew a souq24 row can be active + in v1 + absent from active_listing_ids_v2. A
-- v1-only guard would suppress the souq24 branch while branch 1 stayed silent, the row would
-- vanish from v2, and the sync's DELETE arm would drop it from the index -- hiding a
-- source-published listing. This form can only ever remove a second copy, never the last one.
create or replace view public.listing_native_location_v2 as
 SELECT v1.platform,
    v1.source_table,
    v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) AS region_id,
    COALESCE(v1.city_id, uali.city_id, uc.city_id) AS city_id,
    COALESCE(v1.city_ar, uc.city_ar) AS city_ar,
    COALESCE(v1.district_ar, dr.district_ar) AS district_ar,
    COALESCE(v1.region_ar, uar.region_ar, ur.region_ar) AS region_ar,
    v1.source_method,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) IS NOT NULL AND COALESCE(v1.city_id, uali.city_id, uc.city_id) IS NOT NULL AS production_ready,
    v1.last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    ea.furnished,
    ar.property_age,
    ea.direction,
    ea.street_width_m,
    ea.floor_number,
    ea.tenant_category,
    ea.license_number,
    ea.elevator,
    ea.parking,
    ea.kitchen,
    ea.air_conditioner,
    ea.maid_room,
    ea.driver_room,
    ea.private_entrance
   FROM listing_native_location_v1 v1
     JOIN active_listing_ids_v2 a ON a.source_table = v1.source_table AND a.listing_id = v1.listing_id
     LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id
     LEFT JOIN listing_age_resolved ar ON ar.source_table = v1.source_table AND ar.listing_id = v1.listing_id
     LEFT JOIN district_recovery dr ON dr.source_table = v1.source_table AND dr.listing_id = v1.listing_id
     LEFT JOIN LATERAL ( SELECT max(d.city_id) AS city_id
           FROM loc_catalog_district d
          WHERE v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)
         HAVING count(DISTINCT d.city_id) = 1) udid ON true
     LEFT JOIN LATERAL ( SELECT a2.city_id
           FROM loc_catalog_city_alias a2
          WHERE v1.city_id IS NULL AND v1.city_ar IS NOT NULL AND a2.alias_norm = normalize_ar(v1.city_ar)
         LIMIT 1) uali ON true
     LEFT JOIN loc_catalog_city uac ON uac.city_id = uali.city_id
     LEFT JOIN loc_catalog_region uar ON uar.region_id = uac.region_id
     LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id
     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_residential_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_residential_listings'::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_residential_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
    AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id
          WHERE v1.source_table = 'souq24_residential_listings'::text AND v1.listing_id = s.id))
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_commercial_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_commercial_listings'::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_commercial_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
    AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id
          WHERE v1.source_table = 'souq24_commercial_listings'::text AND v1.listing_id = s.id))
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table,
    a.listing_id,
    a.transaction_type,
    gth.region_id,
    gth.city_id,
    gcat.city_ar,
    NULL::text AS district_ar,
    gcr.region_ar,
    'unresolved_catchall'::text AS source_method,
    gth.region_id IS NOT NULL AND gth.city_id IS NOT NULL AS production_ready,
    NULL::timestamp with time zone AS last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM active_listing_ids_v2 a
     LEFT JOIN LATERAL ( SELECT (g.additional_info ->> 'resolved_city_id'::text)::integer AS city_id,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS region_id
           FROM gathern_residential_listings g
          WHERE a.source_table = 'gathern_residential_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text
        UNION ALL
         SELECT (g.additional_info ->> 'resolved_city_id'::text)::integer AS int4,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS int4
           FROM gathern_commercial_listings g
          WHERE a.source_table = 'gathern_commercial_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text) gth ON true
     LEFT JOIN loc_catalog_city gcat ON gcat.city_id = gth.city_id
     LEFT JOIN loc_catalog_region gcr ON gcr.region_id = gth.region_id
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));
