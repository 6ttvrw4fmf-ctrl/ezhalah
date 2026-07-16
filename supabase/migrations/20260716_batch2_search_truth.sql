-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BATCH 2 — SEARCH-INDEX DATA TRUTH (owner-directed, 2026-07-16)
--
-- Three fixes, one migration. Ordering: applies AFTER 20260713_batch0_detection_spine.sql
-- (FIX 3 extends that file's alert spine and redefines its orchestrator; FIX 1/2 are
-- independent of it). Verified end-to-end in BEGIN..ROLLBACK against live prod 2026-07-16.
--
-- FIX 1 — NULL transaction_type must never surface as Rent (owner: "Unknown deal types must
--   remain unresolved and must not become visible as Rent").
--   sync_search_listings_ar()'s deal mapping was `case when lower(v.transaction_type)='buy'
--   then 'بيع' else 'إيجار' end` — every NULL/unknown deal silently became إيجار (Rent).
--   Live check 2026-07-16: DISTINCT lower(transaction_type) over listing_native_location_v2 =
--   {buy: 115,727 · rent: 68,470 · NULL: 1,301} — no other spellings exist (no Arabic values,
--   no 'sale'/'sell', no casing variants), so ('buy','rent') is the complete legitimate set
--   the CASE must keep handling.
--   NEW BEHAVIOR: rows whose transaction_type is not buy/rent (case-insensitive) are
--   QUARANTINED — excluded from search_listings_ar entirely. A NULL-deal row cannot honestly
--   match either a Buy or a Rent search, and deal_ar is NOT NULL in the index, so exclusion
--   (not a third label) is the only truthful representation. The rows stay untouched in their
--   source tables and in listing_native_location_v2 (aggregator-fidelity rule: raw is never
--   rewritten) and re-enter the index automatically if a future re-scrape resolves their deal.
--   The delete arm's anti-join now requires an ELIGIBLE v2 row (same buy/rent predicate), so
--   the FIRST sync run after deploy removes the 1,301 already-mislabeled rows. They pass the
--   existing mass-delete circuit breaker: threshold = greatest(2000, 15% of ~185.5k ≈ 27,824),
--   and 1,301 < 2,000. RPC safety: location_search_candidates_ar filters `p_deal is null or
--   s.deal_ar = p_deal` — quarantined rows simply never appear; no index/RPC assumes any
--   particular deal_ar population.
--
-- FIX 2 — no Latin/English may leak into type_ar (the aqargate 'Compound' leak).
--   type_ar was `normalize(coalesce(t.ar, v.property_type), NFC)`: when type_label_ar (EN→AR)
--   has no mapping, the raw value falls through. That fall-through is BY DESIGN for
--   Arabic-native sources — live audit 2026-07-16: of the 13 fall-through rows, 12 have raw
--   Arabic types (ستوديو، حوش، درايف ثرو، تاون هاوس…) all already present in known_type_ar; only
--   'Compound' (aqargate_residential_listings id 2116473) is Latin. So the fix targets only
--   NON-Arabic fall-throughs: an unmapped raw value that contains Latin letters (or is
--   null/blank — 0 live rows, future-proofing) becomes 'غير معروف'. Unmapped Arabic-native
--   raws keep flowing through unchanged, exactly as before. Exactly 1 live row changes today.
--   REACHABILITY (locked owner rule): these rows stay IN the index, honestly labeled — see the
--   known_type_ar sentinel below for how category-gated searches keep reaching them.
--
-- FIX 3 — legacy alert tables bridged into the Batch-0 dispatched channel (bottom of file).
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── FIX 2a · category-purity × reachability: seed the 'غير معروف' sentinel into known_type_ar ──
-- location_search_candidates_ar AND property_age_option_counts_ar (PR #86) both gate p_category
-- via `exists (select 1 from known_type_ar k where k.type_ar = s.type_ar and (k.macro =
-- p_category or k.macro = 'both'))`. Without a sentinel row, every category search would
-- silently drop every 'غير معروف' row — violating the locked reachability rule.
-- DECISION: seed the sentinel with macro='both' (Option A) rather than making the RPCs' category
-- arm treat unknown type_ar as passing (Option B), because:
--   1. Defense in depth — the RPC gate stays STRICT. Only this explicit sentinel passes; any
--      OTHER unexpected type_ar value (a future leak this migration didn't anticipate) remains
--      excluded from category searches instead of silently passing, which Option B's "unknown
--      passes" arm would allow. PR #86's purity guarantee for KNOWN types is untouched: every
--      other known_type_ar row keeps its exact macro.
--   2. One row fixes BOTH gated RPCs at once, with zero function churn, and keeps search and
--      age-option counts in exact parity. It also keeps detect_novel_property_types quiet: its
--      ARABIC-CHAIN arm alerts on any indexed type_ar missing from known_type_ar, so writing
--      'غير معروف' without this row would fire a perpetual false 'novel type' alert every run.
--   3. macro='both' is the only honest macro for a type we genuinely don't know (precedent:
--      'عمارة' is already macro='both'). A Residential search and a Commercial search both reach
--      the row, honestly labeled 'غير معروف', and the user decides — neutrality preserved.
insert into public.known_type_ar (type_ar, macro)
values ('غير معروف', 'both')
on conflict (type_ar) do nothing;

-- ── FIX 1 + FIX 2 · sync_search_listings_ar() — deal truth + type truth ──
-- Full CREATE OR REPLACE of the live hourly sync (pg_cron jobid 28). Verbatim copy of the live
-- 2026-07-16 definition except the three [DEAL] / [TYPE] marked diffs:
--   [DEAL] deal_ar CASE maps buy→'بيع', rent→'إيجار' and NOTHING else (no else-branch); a new
--          eligibility predicate `lower(v.transaction_type) in ('buy','rent')` on the insert
--          quarantines everything else; the delete anti-join + its circuit-breaker count use the
--          same predicate so already-indexed ineligible rows are removed on the first run.
--   [TYPE] type_ar falls back to 'غير معروف' only when there is no type_label_ar mapping AND the
--          raw value is not Arabic-native (contains Latin letters, or is null/blank).
create or replace function public.sync_search_listings_ar()
 returns table(upserted bigint, deleted bigint)
 language plpgsql
as $function$
declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;
begin
  select coalesce(max(last_updated), now() - interval '30 days') - interval '2 hours'
    into v_since from search_listings_ar;
  insert into search_listings_ar (
    source_table, listing_id, platform, last_updated, region_id, city_id, region_ar, city_ar, district_ar,
    deal_ar, type_ar, rent_period_ar, price_total, price_annual, area_m2, bedrooms, bathrooms,
    furnished, property_age, direction_ar, tenant_ar, license_number, street_width_m, floor_number,
    elevator, parking, kitchen, air_conditioner, maid_room, driver_room, private_entrance, production_ready)
  select distinct on (v.source_table, v.listing_id)
    v.source_table, v.listing_id, v.platform, v.last_updated, v.region_id, v.city_id, v.region_ar, v.city_ar, v.district_ar,
    case when lower(v.transaction_type)='buy'  then 'بيع'
         when lower(v.transaction_type)='rent' then 'إيجار' end,  -- [DEAL] no else-branch: the eligibility predicate below guarantees buy|rent — nothing can silently become Rent again
    normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'  -- [TYPE] no raw type at all (0 live rows today; future-proofing)
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'                            -- [TYPE] unmapped NON-Arabic raw (the 'Compound' leak): never Latin in the Arabic index
                else v.property_type                                                          -- [TYPE] unmapped but Arabic-native raw: by-design fall-through, unchanged
              end, NFC),
    case when lower(v.transaction_type)='rent' then
      case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else null end end,
    v.price_total, v.price_annual, v.area_m2, v.bedrooms, v.bathrooms,
    case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end,  -- [FURN] platform-rule derivation
    v.property_age,
    case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end,
    case when v.tenant_category in ('عزاب','عوائل') then v.tenant_category end,
    v.license_number,
    v.street_width_m, v.floor_number,
    v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance,
    v.production_ready
  from listing_native_location_v2 v
  left join type_label_ar t on t.en = v.property_type
  where lower(v.transaction_type) in ('buy','rent')   -- [DEAL] quarantine: unknown/NULL deals are not searchable at all (owner 2026-07-16)
    and (v.last_updated is null or v.last_updated > v_since
     or not exists (select 1 from search_listings_ar s2
                    where s2.source_table = v.source_table and s2.listing_id = v.listing_id)
     or exists (select 1 from search_listings_ar s3
                where s3.source_table = v.source_table and s3.listing_id = v.listing_id
                  and (s3.city_id is distinct from v.city_id
                       or s3.region_id is distinct from v.region_id
                       or s3.district_ar is distinct from v.district_ar
                       or s3.production_ready is distinct from v.production_ready
                       or s3.region_ar is distinct from v.region_ar
                       or s3.city_ar is distinct from v.city_ar)))
  order by v.source_table, v.listing_id, v.last_updated desc nulls last
  on conflict (source_table, listing_id) do update set
    platform=excluded.platform, last_updated=excluded.last_updated, region_id=excluded.region_id,
    city_id=excluded.city_id, region_ar=excluded.region_ar, city_ar=excluded.city_ar,
    district_ar=excluded.district_ar, deal_ar=excluded.deal_ar, type_ar=excluded.type_ar,
    rent_period_ar=excluded.rent_period_ar, price_total=excluded.price_total, price_annual=excluded.price_annual,
    area_m2=excluded.area_m2, bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms,
    furnished=excluded.furnished, property_age=excluded.property_age, direction_ar=excluded.direction_ar,
    tenant_ar=excluded.tenant_ar, license_number=excluded.license_number,
    street_width_m=excluded.street_width_m, floor_number=excluded.floor_number,
    elevator=excluded.elevator, parking=excluded.parking, kitchen=excluded.kitchen,
    air_conditioner=excluded.air_conditioner, maid_room=excluded.maid_room, driver_room=excluded.driver_room,
    private_entrance=excluded.private_entrance, production_ready=excluded.production_ready;
  get diagnostics v_upserted = row_count;

  -- [DEAL] the anti-join now requires an ELIGIBLE (buy|rent) v2 row, not mere presence: rows that
  -- vanish from v2 AND rows whose deal is/becomes unknown are both removed. Same circuit breaker
  -- as before (greatest(2000, 15%) of the index) still guards against a collapsed matview.
  select count(*) into v_del_pending from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in ('buy','rent'));
  select count(*) into v_total_now from search_listings_ar;
  v_threshold := greatest(2000::bigint, (v_total_now * 15 / 100));
  if v_del_pending > v_threshold then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('sync_delete_circuit_breaker', v_del_pending,
              format('Sync DELETE aborted: %s rows absent from v2 exceed threshold %s (index total %s). Likely a collapsed/failed matview refresh; rows kept stale-but-present instead of mass-deleted.', v_del_pending, v_threshold, v_total_now));
    v_deleted := 0;
  else
    delete from search_listings_ar s
      where not exists (select 1 from listing_native_location_v2 v
                        where v.source_table = s.source_table and v.listing_id = s.listing_id
                          and lower(v.transaction_type) in ('buy','rent'));
    get diagnostics v_deleted = row_count;
  end if;
  v_deleted := v_deleted + public.prune_inactive_from_search();

  perform refresh_district_name_bridge();
  perform refresh_city_name_bridge();
  return query select v_upserted, v_deleted;
end $function$;

-- ── FIX 2b · one-time backfill for ALREADY-INDEXED Latin leaks ──
-- The sync is incremental: a row is only re-selected when it is new, its last_updated moved, or a
-- location field drifted. The live 'Compound' row (aqargate 2116473) is old and location-stable,
-- so the rewritten insert expression alone never re-touches it — verified empirically in the
-- BEGIN..ROLLBACK test: it survived a full sync run with type_ar still 'Compound'. Recompute
-- type_ar through the EXACT same expression for the (today: exactly 1) indexed rows whose type_ar
-- contains Latin. New/re-touched rows are always covered by the sync itself, and Latin can only
-- exist in the index from the pre-fix era, so this backfill is complete and never needs re-running.
-- A Latin row whose v2 counterpart vanished or became deal-ineligible is deliberately NOT updated
-- here — the sync's delete arm removes it on its next hourly run.
update public.search_listings_ar s
set type_ar = sub.new_type_ar
from (
  select v.source_table, v.listing_id,
         normalize(case
                     when t.ar is not null then t.ar
                     when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                     when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                     else v.property_type
                   end, NFC) as new_type_ar
  from public.listing_native_location_v2 v
  left join public.type_label_ar t on t.en = v.property_type
) sub
where s.source_table = sub.source_table and s.listing_id = sub.listing_id
  and s.type_ar ~ '[A-Za-z]';

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FIX 3 · bridge the two PRE-SPINE alert tables into the dispatched channel.
-- novel_type_alerts (written by detect_novel_property_types) and scraper_freshness_alerts
-- (written by check_scraper_freshness) predate Batch 0: their rows land in tables nobody is
-- paged about — exactly the "monitors INSERT rows nobody reads" antipattern the spine exists to
-- kill. This detector MIRRORS them into alert_event via mon_raise() (debounced by dedup_key) so
-- they flow through mon_dispatch_alerts() like every other detector, WITHOUT changing how the
-- legacy tables themselves are written or resolved. Resolving the legacy row auto-resolves the
-- mirror on the next run (self-heal), matching D1-D5's behavior.
-- Conventions (same as D1-D6): security definer, set search_path='public', never-blocks — each
-- arm is existence-checked via to_regclass and wrapped in its own exception handler, so if a
-- legacy table is ever dropped this degrades to a no-op instead of failing the orchestrator.
-- Severities: P1 for 'INVARIANT:%' novel rows (a search-integrity invariant breach, e.g. an
-- entire *_listings table invisible to search) and for legacy 'critical' freshness rows; P2 for
-- plain novel types and 'warning' freshness rows.
-- Scope notes: the freshness arm joins platform_registry status='active' (owner brief) so
-- retired/dormant platforms can never spam (the toor/muktamel rule); the novel-type arm mirrors
-- ALL unresolved rows regardless of platform status — a data-truth alert stays visible until a
-- human resolves the legacy row, and its platform column is best-effort derived from
-- sample_table's platform prefix.
create or replace function public.mon_detect_legacy_alert_tables()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0;
begin
  -- (a) unresolved novel_type_alerts → one open alert_event per raw_type
  if to_regclass('public.novel_type_alerts') is not null then
    begin
      for rec in
        select a.raw_type, a.sample_table, a.n as n_rows, a.detected_at,
               (select pr.platform from public.platform_registry pr
                 where a.sample_table like pr.platform || '\_%' limit 1) as platform
        from public.novel_type_alerts a
        where not a.resolved
      loop
        n := n + public.mon_raise(
          case when rec.raw_type like 'INVARIANT:%' then 'P1' else 'P2' end,
          'legacy_novel_type', rec.platform,
          'legacy_novel_type:' || rec.raw_type,
          jsonb_build_object('raw_type', rec.raw_type, 'sample_table', rec.sample_table,
                             'n', rec.n_rows, 'first_detected_at', rec.detected_at,
                             'source', 'novel_type_alerts (legacy table, mirrored)'));
      end loop;
      -- self-heal: legacy row resolved → resolve the mirror
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_novel_type' and e.resolved_at is null
        and not exists (select 1 from public.novel_type_alerts a
                        where not a.resolved
                          and e.dedup_key = 'legacy_novel_type:' || a.raw_type);
    exception when others then null;  -- never blocks the orchestrator
    end;
  end if;

  -- (b) scraper_freshness_alerts rows newer than 24h for ACTIVE-registry platforms →
  -- one open alert_event per platform (latest legacy row wins)
  if to_regclass('public.scraper_freshness_alerts') is not null then
    begin
      for rec in
        select distinct on (f.platform)
               f.platform, f.checked_at, f.last_scraped_at, f.hours_stale, f.expected_hours, f.severity
        from public.scraper_freshness_alerts f
        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active'
        where f.checked_at > now() - interval '24 hours'
        order by f.platform, f.checked_at desc
      loop
        n := n + public.mon_raise(
          case when rec.severity = 'critical' then 'P1' else 'P2' end,
          'legacy_scraper_freshness', rec.platform,
          'legacy_scraper_freshness:' || rec.platform,
          jsonb_build_object('checked_at', rec.checked_at, 'last_scraped_at', rec.last_scraped_at,
                             'hours_stale', rec.hours_stale, 'expected_hours', rec.expected_hours,
                             'legacy_severity', rec.severity,
                             'source', 'scraper_freshness_alerts (legacy table, mirrored)'));
      end loop;
      -- self-heal: no fresh (<24h) legacy row for an active platform → condition cleared
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_scraper_freshness' and e.resolved_at is null
        and not exists (select 1 from public.scraper_freshness_alerts f
                        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active'
                        where f.checked_at > now() - interval '24 hours'
                          and e.dedup_key = 'legacy_scraper_freshness:' || f.platform);
    exception when others then null;
    end;
  end if;

  return n;
end $$;

-- ── fold into the orchestrator. SUPERSEDES the definition in 20260713_batch0_detection_spine.sql
-- (both the 5-detector base and the D6 addendum's 6-detector redefinition later in that same
-- file): the body below is a verbatim copy of the D6 (latest) version, adding only the
-- legacy-bridge call and its returned key. If Batch 0 changes its detector roster again, fold
-- this call into the new definition rather than keeping two competing versions.
create or replace function public.mon_run_all_detectors()
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a int; b int; c int; d int; e int; f int; g int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,'ran_at',now());
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (all confirmed in BEGIN..ROLLBACK against live prod 2026-07-16 — batch0 spine +
-- this migration applied end-to-end with zero errors, then sync_search_listings_ar() run live;
-- re-run these after the first post-deploy hourly sync):
--   select count(*) from search_listings_ar s
--     join listing_native_location_v2 v
--       on v.source_table=s.source_table and v.listing_id=s.listing_id
--    where v.transaction_type is null;                                   -- 0   (was 1,301)
--   select count(*) from search_listings_ar where type_ar ~ '[A-Za-z]';  -- 0   (was 1)
--   select type_ar from search_listings_ar
--    where source_table='aqargate_residential_listings'
--      and listing_id=2116473;                                           -- 'غير معروف'
--   select public.mon_run_all_detectors();                               -- has legacy_alert_tables key
-- Measured in the rollback test: index 185,498 → 184,197 (exactly the 1,301 quarantined rows;
-- zero collateral deletions — every removed key was a NULL-deal row); broad Riyadh Residential
-- search total_count 62,041 → 61,937 (−104 = exactly the quarantined rows in that scope,
-- independently recomputed); the relabeled row became reachable in BOTH category searches
-- (was reachable in neither, since 'Compound' failed the known_type_ar gate); detector dedup on
-- 2nd run = 0 new; a synthetic 'critical' freshness row for an active platform mirrored as P1
-- while the real <24h rows (all for retired alnokhba/muktamel/toor) were correctly NOT mirrored.
--
-- ROLLBACK: replace-only + one seed row — no data loss.
--   1. Restore the previous sync_search_listings_ar() body (git history; the exact diffs are the
--      [DEAL]/[TYPE] markers above).
--   2. delete from known_type_ar where type_ar = 'غير معروف';
--   3. drop function if exists public.mon_detect_legacy_alert_tables();
--   4. Restore mon_run_all_detectors() to the D6 version in 20260713_batch0_detection_spine.sql
--      and: delete from alert_event where kind in ('legacy_novel_type','legacy_scraper_freshness');
--   Quarantined rows reappear in the index on the next hourly sync after a rollback.
-- ─────────────────────────────────────────────────────────────────────────────────────────
