-- 🔧 Quality & Repair 2026-11-07 — follow-up to the bedrooms detector mirror #11100 (CodeRabbit Major there; AGENTS.md 2026-08-13: an
-- alert-suppressing waiver is gated to its probe AND re-checked by a detector). ops_bedrooms_source_silent is itself the
-- probe record (platform, the ad URL that was read, the date), so two things were missing: (a) a blank proof_url could
-- waive a platform — rejected by a CHECK; (b) a waiver lived forever — mon_detect_bedrooms_not_captured() now ignores a
-- waiver older than 180 days, so the platform is named again (waiver_expired = true) until its page is re-read and
-- proven_on refreshed. The five 11-07 rows are owner-rule exemptions (2026-07-28: «عدد الغرف» = TOTAL rooms, bedrooms
-- stays NULL) and keep working unchanged until 2027-05.
alter table public.ops_bedrooms_source_silent
  drop constraint if exists ops_bedrooms_source_silent_proof_url_not_blank,
  add constraint ops_bedrooms_source_silent_proof_url_not_blank check (btrim(proof_url) <> '');

create or replace function public.mon_detect_bedrooms_not_captured()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare v_rows jsonb; v_n int; k constant text := 'bedrooms_not_captured_fleet';
begin
  -- served homes whose card can show «غرف», per platform: a platform with ≥ 200 such homes and ≥ 50 % of them without a
  -- rooms count is named, unless its page was proven silent (ops_bedrooms_source_silent) within the last 180 days.
  -- An older waiver no longer excludes the platform (waiver_expired): re-read the page and refresh proven_on.
  select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'homes', homes, 'no_bedrooms', no_bedrooms,
                                               'null_pct', null_pct, 'waiver_expired', waiver_expired)
                            order by no_bedrooms desc), '[]'::jsonb), count(*)
    into v_rows, v_n
    from (select s.platform, count(*) as homes, count(*) filter (where s.bedrooms is null) as no_bedrooms,
                 round(100.0 * count(*) filter (where s.bedrooms is null) / count(*), 1) as null_pct,
                 bool_or(w.platform is not null) as waiver_expired
            from public.search_listings_ar s
            left join public.ops_bedrooms_source_silent w on w.platform = s.platform
           where s.production_ready
             and s.type_ar in ('شقة', 'فيلا', 'دور', 'دوبلكس', 'بيت', 'شقة مفروشة')
             and (w.platform is null or w.proven_on < current_date - 180)
           group by s.platform
          having count(*) >= 200
             and 100.0 * count(*) filter (where s.bedrooms is null) / count(*) >= 50) t;
  if v_n > 0 then
    return public.mon_raise('P2', k, 'fleet', k, jsonb_build_object(
      'platforms', v_n, 'rows', v_rows,
      'why', 'Served homes (apartments, villas, floors, duplexes, houses) with NO rooms count on the card, per platform, where at least half of a platform''s homes miss it. haraj 18362502 printed «عدد الغرف: 5» on its page while our card showed nothing (2026-11-07); aqarcity 27712 prints «غرفة واحدة» in its page title. A missing captured field is not evidence that the source omits it. waiver_expired = true: the platform''s waiver is older than 180 days and no longer counts.',
      'action', 'Per platform (⚡ lane): read ONE real page; if it publishes a rooms count, capture it (docs/ops/CAPTURED_FIELD_CLASSIFICATION.md decides what maps to bedrooms), re-crawl, prove on the phone card; if the page is proven silent (or the owner rule 2026-07-28 applies: «عدد الغرف» is the TOTAL rooms count, never bedrooms), insert or refresh the platform in ops_bedrooms_source_silent with the page URL and today''s date. Never fill bedrooms from a guess or from the type.'));
  end if;
  perform public.mon_resolve_key(k, k);
  return 0;
end $function$;
revoke all on function public.mon_detect_bedrooms_not_captured() from public, anon, authenticated;
grant execute on function public.mon_detect_bedrooms_not_captured() to service_role;

-- PROOF, all inside rolled-back sub-blocks: a blank proof_url is refused; a 200-day-old waiver does not exclude a named
-- platform and marks it waiver_expired; a fresh waiver still excludes it; the five rule exemptions are untouched.
do $$
declare d jsonb; v_named text;
begin
  select e->>'platform' into v_named
    from public.alert_event a, jsonb_array_elements(a.detail->'rows') e
   where a.dedup_key = 'bedrooms_not_captured_fleet' and a.resolved_at is null
   order by (e->>'no_bedrooms')::int desc limit 1;
  if v_named is null then
    perform public.mon_detect_bedrooms_not_captured();
    select e->>'platform' into v_named
      from public.alert_event a, jsonb_array_elements(a.detail->'rows') e
     where a.dedup_key = 'bedrooms_not_captured_fleet' and a.resolved_at is null
     order by (e->>'no_bedrooms')::int desc limit 1;
  end if;
  if v_named is null then raise exception 'PROOF: no platform is named today — nothing to test the waiver against'; end if;
  begin
    insert into public.ops_bedrooms_source_silent (platform, proof_url, proven_on, note)
    values ('__blank_selftest__', '   ', current_date, '__selftest__');
    raise exception 'PROOF: a blank proof_url was accepted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.ops_bedrooms_source_silent (platform, proof_url, proven_on, note)
    values (v_named, 'https://example.invalid/selftest', current_date - 200, '__selftest__');
    perform public.mon_detect_bedrooms_not_captured();
    select detail into d from public.alert_event where dedup_key = 'bedrooms_not_captured_fleet' and resolved_at is null;
    if not exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' = v_named and (e->>'waiver_expired')::boolean) then
      raise exception 'PROOF: a 200-day-old waiver still excludes % (or is not marked waiver_expired): %', v_named, d->'rows';
    end if;
    raise exception '__waiver_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__waiver_selftest_rollback__' then raise; end if;
  end;
  begin
    insert into public.ops_bedrooms_source_silent (platform, proof_url, proven_on, note)
    values (v_named, 'https://example.invalid/selftest', current_date, '__selftest__');
    perform public.mon_detect_bedrooms_not_captured();
    select detail into d from public.alert_event where dedup_key = 'bedrooms_not_captured_fleet' and resolved_at is null;
    if exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' = v_named) then
      raise exception 'PROOF: a fresh waiver no longer excludes %', v_named;
    end if;
    raise exception '__waiver_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__waiver_selftest_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.ops_bedrooms_source_silent where note = '__selftest__') then
    raise exception 'PROOF: a selftest waiver was not rolled back';
  end if;
  perform public.mon_detect_bedrooms_not_captured();
  select detail into d from public.alert_event where dedup_key = 'bedrooms_not_captured_fleet' and resolved_at is null;
  if exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' in ('haraj', 'dealapp', 'muhaysini', 'tuba', 'aqarcity')) then
    raise exception 'PROOF: a fresh rule exemption is named: %', d->'rows';
  end if;
  raise notice 'PROOF: blank URL refused; stale waiver names % again (waiver_expired); fresh waiver excludes it; the 5 exemptions hold', v_named;
end $$;