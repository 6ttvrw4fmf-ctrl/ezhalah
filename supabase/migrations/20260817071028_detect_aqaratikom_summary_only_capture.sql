-- Senior run #25 (2026-08-17). Regression protection for a silent capture-loss class found today.
--
-- WHAT HAPPENED: aqaratikom (nawait.sa) builds each row from TWO calls — POST /api/v1/ad (summary:
-- price, area, category, city, media) and GET /api/v1/ad/<uuid> (detail: estate.details[] carrying
-- عدد دورة المياه, عدد الصالات, عرض الشارع, واجهة العقار, مصعد, مطبخ, plus `subtype` = the rent
-- period). When fetch_detail() returns None, map_listing() STILL emits a row from the summary alone,
-- the upsert stores it, and end_run() reports ok=true. The run looks perfectly healthy while every
-- detail-only field is silently dropped — the exact "silent partial crawl" the audit routine §3
-- requires us to detect, and §10's "nothing supported should be silently dropped".
--
-- EVIDENCE (run #25): 8 searchable Rent apartments carried price+area but NULL rent_period, so
-- neither period chip could reach them (searchability_collapse:aqaratikom, 100% -> 82.6%). A live
-- probe of all 8 via the scraper's OWN detail endpoint returned HTTP 200 with subtype=«سنوي» and a
-- price matching the stored value exactly — so the source DOES publish the period and the NULL was
-- OURS, not the source's (owner permanent rule #2: absence is not evidence of source silence).
-- The discriminator that proved the mechanism: those 8 rows had 0/8 bathrooms, 0/8 halls, 0/8 street
-- width, 0/8 direction, 0/8 elevator, while the healthy cohort ran 42-53/55 on the same fields —
-- i.e. the whole detail record was missing, not just the period. 24 of 132 active rows are affected.
--
-- WHY A DETECTOR AND NOT JUST THE PARSER FIX: this alert already flapped once (resolved 2026-08-13,
-- raised again 2026-08-17), so the condition recurs. searchability_collapse only sees the RENT
-- period symptom; it is blind to a Buy row that lost its bathrooms and street width, which is an
-- Advanced Filter reachability loss with no other monitor.
--
-- Scoped deliberately to aqaratikom: this platform's detail endpoint is PROVEN to publish these
-- fields, so their simultaneous absence is a capture failure. Other platforms legitimately omit
-- them, and a generic version would be a false-positive generator (§31: a real source limitation
-- must not count as a scraper bug).
create or replace function public.mon_detect_summary_only_capture()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cnt bigint; v_total bigint; v_open boolean; n int := 0;
begin
  -- Summary-only = the summary-derived fields are present (so the crawl reached the platform) while
  -- EVERY detail-only field is null at once. Requiring all six together is what keeps an ordinary
  -- sparse ad (a seller who simply listed no lift) out of this count.
  select count(*) filter (where area_m2 is not null
                            and bathrooms is null and halls is null and street_width_m is null
                            and direction is null and elevator is null and kitchen is null),
         count(*)
    into v_cnt, v_total
    from public.aqaratikom_residential_listings
   where active;

  v_open := exists (select 1 from public.alert_event
                     where dedup_key = 'summary_only_capture:aqaratikom' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('summary_only_capture', 'aqaratikom'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P2', 'summary_only_capture', 'aqaratikom',
      'summary_only_capture:aqaratikom',
      jsonb_build_object(
        'rows', v_cnt, 'active_total', v_total,
        'frac', round((v_cnt::numeric / greatest(v_total,1)), 3),
        'why', 'These active rows carry summary fields (price/area) but NOT ONE detail-only field '
            || '(bathrooms, halls, street width, direction, elevator, kitchen). nawait.sa serves '
            || 'those only from GET /api/v1/ad/<uuid>, so the detail fetch returned nothing and the '
            || 'row was built from the summary alone — while the scrape run still reported ok=true. '
            || 'Rent rows in this state also lose `subtype`, the rent period, and fall out of BOTH '
            || 'period chips.',
        'adjudicate', 'Do NOT default a rent period or invent an attribute to clear this (§22 — that '
            || 'fabricates a source fact). Re-probe GET /api/v1/ad/<uuid> for a sample: if it '
            || 'returns 200 with estate.details[], the loss is OURS and the fix belongs in the '
            || 'scraper''s fetch_detail path; the rows then refill on the next successful crawl '
            || 'because the upsert preserves known-over-unknown. Record probes in '
            || 'ops_rent_period_source_probe.'));
  end if;
  return n;
end $function$;

-- ROSTER ENTRY: see 20260817072028_roster_summary_only_capture_via_guarded_needle_edit.sql.
--
-- Honest note on what production recorded under THIS version: it was applied with a wholesale
-- CREATE OR REPLACE of mon_run_all_detectors appended here. scripts/verify-detector-roster-edits-
-- are-guarded.ts rejected that in CI (PR #722) and was right to — a hand-pasted roster body
-- silently drops every entry it predates, which has bitten this repo three times. No detector was
-- actually lost (checked at the time: every mon_detect_* outside the roster owns its own cron job,
-- and mon_detect_orphaned_detectors() returned 0), but the METHOD was wrong, so the roster half was
-- re-applied through the guarded needle-edit and moved out of this file. A detector outside the
-- roster is decoration; the follow-up migration is what keeps this one wired.
