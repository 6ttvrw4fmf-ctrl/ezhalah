-- 🔧 Quality & Repair 2026-11-07 — BLIND SPOT (owner 2026-11-04 «eliminate more and more bugs» §2: compare every field the
-- card shows with the source page; anything wrong that no detector flagged is a blind spot — build its detector).
-- The random card haraj 18362502 shows no rooms while its page prints «○ 5 غرف» and «عدد الغرف: 5» (source-reread run
-- 42376538844). Measured on the served index at 13:3x UTC, homes (شقة/فيلا/دور/دوبلكس/بيت/شقة مفروشة) with bedrooms NULL:
-- dealapp 34,278 of 34,649 (98.9 %), muhaysini 22,391 of 22,391 (100 %), haraj 6,806 of 7,588 (89.7 %), tuba 2,992 (100 %),
-- aqarmonthly 2,971 (96.9 %), aqarcity 1,349 (100 %; its page title prints «79 م²، غرفة واحدة» for 27712), wahadat 986,
-- abralosol 679, mustqr 401, raghdan 282 (all 100 %), arkaan 73 %, aqalemhajer 73 %, bossbih 59 %, ialqarawi 51 % — against
-- aqar 0.1 %, wasalt 0.9 %, gathern 0.1 %. ~75,000 served homes carry no «غرف» on the card and NO detector saw it.
-- A missing captured field is NOT evidence that the source omits it (owner 2026-08-13): the detector names the platforms;
-- the ⚡ Scraping Engineer re-reads one real page per platform and either captures the rooms or records the probe in the
-- waiver table below with the URL of the page proven silent.

create table if not exists public.ops_bedrooms_source_silent (
  platform   text primary key,
  proof_url  text not null,
  proven_on  date not null,
  note       text
);
comment on table public.ops_bedrooms_source_silent is
  'Platforms whose ad pages were re-read and proven NOT to publish a rooms count (owner 2026-08-13: record the probe before calling anything a source limitation). mon_detect_bedrooms_not_captured() skips them. One row per platform, with the page URL that was read.';
revoke all on table public.ops_bedrooms_source_silent from public, anon, authenticated;
grant select, insert, update on table public.ops_bedrooms_source_silent to service_role;

create or replace function public.mon_detect_bedrooms_not_captured()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare v_rows jsonb; v_n int; k constant text := 'bedrooms_not_captured_fleet';
begin
  -- served homes whose card can show «غرف», per platform: a platform with ≥ 200 such homes and ≥ 50 % of them without a
  -- rooms count is named, unless its page was proven silent (ops_bedrooms_source_silent).
  select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'homes', homes, 'no_bedrooms', no_bedrooms, 'null_pct', null_pct)
                            order by no_bedrooms desc), '[]'::jsonb), count(*)
    into v_rows, v_n
    from (select s.platform, count(*) as homes, count(*) filter (where s.bedrooms is null) as no_bedrooms,
                 round(100.0 * count(*) filter (where s.bedrooms is null) / count(*), 1) as null_pct
            from public.search_listings_ar s
           where s.production_ready
             and s.type_ar in ('شقة', 'فيلا', 'دور', 'دوبلكس', 'بيت', 'شقة مفروشة')
             and not exists (select 1 from public.ops_bedrooms_source_silent w where w.platform = s.platform)
           group by s.platform
          having count(*) >= 200
             and 100.0 * count(*) filter (where s.bedrooms is null) / count(*) >= 50) t;
  if v_n > 0 then
    return public.mon_raise('P2', k, 'fleet', k, jsonb_build_object(
      'platforms', v_n, 'rows', v_rows,
      'why', 'Served homes (apartments, villas, floors, duplexes, houses) with NO rooms count on the card, per platform, where at least half of a platform''s homes miss it. haraj 18362502 printed «عدد الغرف: 5» on its page while our card showed nothing (2026-11-07); aqarcity 27712 prints «غرفة واحدة» in its page title. A missing captured field is not evidence that the source omits it.',
      'action', 'Per platform (⚡ lane): read ONE real page; if it publishes a rooms count, capture it (docs/ops/CAPTURED_FIELD_CLASSIFICATION.md decides what maps to bedrooms), re-crawl, prove on the phone card; if the page is proven silent, insert the platform into ops_bedrooms_source_silent with the page URL and the date. Never fill bedrooms from a guess or from the type.'));
  end if;
  perform public.mon_resolve_key(k, k);
  return 0;
end $function$;
revoke all on function public.mon_detect_bedrooms_not_captured() from public, anon, authenticated;
grant execute on function public.mon_detect_bedrooms_not_captured() to service_role;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_bedrooms_not_captured' in src) > 0 then
    raise notice 'mon_detect_bedrooms_not_captured already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_loc_display_district_speed'',',
    E'    ''mon_detect_loc_display_district_speed'',\n    ''mon_detect_bedrooms_not_captured'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Lane: a rooms count the site publishes and the scraper does not store is the ⚡ Scraping Engineer's.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('bedrooms_not_captured_fleet' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes bedrooms_not_captured_fleet';
    return;
  end if;
  out_def := replace(src,
    $n$when p_kind ~ '^(scrape_suspect|source_shows_small_total|quarantine_growth)$'$n$,
    $n$when p_kind ~ '^(bedrooms_not_captured_fleet|scrape_suspect|source_shows_small_total|quarantine_growth)$'$n$);
  if out_def = src then
    raise exception 'ops_engineer_for_alert anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- PROOF: the live blind spot is raised (haraj and aqarcity named, routed to ⚡); a platform proven silent drops out
-- (rolled back); the detector is on the roster.
do $$
declare r int; d jsonb;
begin
  r := public.mon_detect_bedrooms_not_captured();
  select detail into d from public.alert_event where dedup_key = 'bedrooms_not_captured_fleet' and resolved_at is null;
  if d is null then raise exception 'PROOF: the live blind spot (haraj 6,806 / aqarcity 1,349 served homes without rooms) was not raised'; end if;
  if not exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' = 'haraj')
     or not exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' = 'aqarcity') then
    raise exception 'PROOF: haraj or aqarcity missing from the named platforms: %', d->'rows';
  end if;
  if public.ops_engineer_for_alert('bedrooms_not_captured_fleet', null) <> 'scraping-engineer' then
    raise exception 'PROOF: bedrooms_not_captured_fleet is not routed to the scraping lane';
  end if;
  begin
    insert into public.ops_bedrooms_source_silent (platform, proof_url, proven_on, note)
    values ('haraj', 'https://example.invalid/selftest', current_date, '__selftest__');
    perform public.mon_detect_bedrooms_not_captured();
    select detail into d from public.alert_event where dedup_key = 'bedrooms_not_captured_fleet' and resolved_at is null;
    if exists (select 1 from jsonb_array_elements(d->'rows') e where e->>'platform' = 'haraj') then
      raise exception 'PROOF: a platform proven silent is still named';
    end if;
    raise exception '__bedrooms_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__bedrooms_selftest_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.ops_bedrooms_source_silent where note = '__selftest__') then
    raise exception 'PROOF: the selftest waiver was not rolled back';
  end if;
  if position('mon_detect_bedrooms_not_captured' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
  raise notice 'PROOF: blind spot raised for % platforms, routed to ⚡, waiver works, on the roster', jsonb_array_length(d->'rows');
end $$;
