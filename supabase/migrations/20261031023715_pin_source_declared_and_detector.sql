-- Where each platform's map pin lives, declared — and the served index held to it every hour (owner 2026-10-30:
-- «this needs serious investigation, fix, and never ever happen again»).
--
-- rakez served 3,660 ads with 0 pins for six weeks. Its project page draws no map, so nobody looked further; the site's
-- map page had been calling a JSON feed with every project's lat/lng the whole time. Nothing failed anywhere: a pinless
-- row is valid at every layer. The same sweep found compoundin (286 ads, marker in an inline script) and mustqr (1,340
-- ads, the Maps link in the ad text was being dropped). The only honest guard is a DECLARATION per platform — made after
-- looking in all four places (ad page · embedded JSON / network calls · site-wide map or list feed · parent project
-- page) — and a detector that measures what we SERVE against it. The repo copy is data/pin-sources.json (launch
-- checklist box 10, scripts/verify-pin-capture-declared.ts proves every row here appears there and vice versa).
create table if not exists public.ops_pin_source_declared (
  platform    text primary key,
  pin_source  text not null check (pin_source in ('ad-page', 'page-json', 'feed', 'project-page', 'partial', 'none')),
  floor_pct   int  not null check (floor_pct between 0 and 100),
  proven_on   date not null,
  declared_at timestamptz not null default now(),
  constraint pin_floor_matches_source check ((pin_source = 'none') = (floor_pct = 0))
);
comment on table public.ops_pin_source_declared is
  'Per platform: where the source publishes its map pin (or none) and the served-coverage floor. The verdict''s proof URL and note live in the repo row, data/pin-sources.json (owner 2026-10-30). Raise a floor by migration; never lower one to clear a red.';
alter table public.ops_pin_source_declared enable row level security;
revoke all on public.ops_pin_source_declared from public, anon, authenticated;
grant select on public.ops_pin_source_declared to service_role;

insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('aalbarrak', 'none', 0, date '2026-10-30'),
  ('abaad', 'feed', 95, date '2026-10-30'),
  ('abeea', 'feed', 95, date '2026-10-30'),
  ('abralosol', 'partial', 5, date '2026-10-30'),
  ('abwbna', 'partial', 65, date '2026-10-30'),
  ('akariyoun', 'page-json', 95, date '2026-10-30'),
  ('alajlan', 'none', 0, date '2026-10-30'),
  ('albdah', 'partial', 20, date '2026-10-30'),
  ('albukaeri', 'ad-page', 1, date '2026-10-30'),
  ('aldarim', 'partial', 80, date '2026-10-30'),
  ('alhoshan', 'feed', 95, date '2026-10-30'),
  ('aljassim', 'partial', 15, date '2026-10-30'),
  ('alkhaas', 'ad-page', 85, date '2026-10-30'),
  ('almotmkenah', 'none', 0, date '2026-10-30'),
  ('almuteb', 'feed', 1, date '2026-10-30'),
  ('alobid', 'partial', 20, date '2026-10-30'),
  ('alqasem', 'none', 0, date '2026-10-30'),
  ('alrifai', 'none', 0, date '2026-10-30'),
  ('alsaedan', 'ad-page', 87, date '2026-10-30'),
  ('alshawaf', 'partial', 35, date '2026-10-30'),
  ('alsidra', 'none', 0, date '2026-10-30'),
  ('alta', 'page-json', 1, date '2026-10-30'),
  ('amaall', 'page-json', 1, date '2026-10-30'),
  ('amlakalahsa', 'feed', 88, date '2026-10-30'),
  ('aouj', 'feed', 87, date '2026-10-30'),
  ('aqalemhajer', 'partial', 50, date '2026-10-30'),
  ('aqar', 'page-json', 95, date '2026-10-30'),
  ('aqaralriyadh', 'none', 0, date '2026-10-30'),
  ('aqaralsaudia', 'page-json', 1, date '2026-10-30'),
  ('aqaratikom', 'feed', 95, date '2026-10-30'),
  ('aqarcity', 'ad-page', 95, date '2026-10-30'),
  ('aqargate', 'feed', 95, date '2026-10-30'),
  ('aqarmonthly', 'feed', 95, date '2026-10-30'),
  ('aqarnajran', 'none', 0, date '2026-10-30'),
  ('arkaan', 'feed', 95, date '2026-10-30'),
  ('arsh', 'partial', 70, date '2026-10-30'),
  ('ashab', 'page-json', 95, date '2026-10-30'),
  ('awal', 'ad-page', 85, date '2026-10-30'),
  ('azdad', 'none', 0, date '2026-10-30'),
  ('azure', 'none', 0, date '2026-10-30'),
  ('bahadhabab', 'partial', 10, date '2026-10-30'),
  ('bossbih', 'partial', 15, date '2026-10-30'),
  ('compoundin', 'project-page', 85, date '2026-10-30'),
  ('dallali', 'feed', 95, date '2026-10-30'),
  ('daraa', 'ad-page', 1, date '2026-10-30'),
  ('daryusuf', 'ad-page', 90, date '2026-10-30'),
  ('dealapp', 'feed', 95, date '2026-10-30'),
  ('dwelleo', 'feed', 95, date '2026-10-30'),
  ('eaqartabuk', 'partial', 25, date '2026-10-30'),
  ('earthapp', 'feed', 95, date '2026-10-30'),
  ('eastabha', 'feed', 95, date '2026-10-30'),
  ('ebriza', 'feed', 95, date '2026-10-30'),
  ('ego', 'none', 0, date '2026-10-30'),
  ('eightfloor', 'partial', 40, date '2026-10-30'),
  ('eilmalriyada', 'partial', 10, date '2026-10-30'),
  ('erapulse', 'feed', 95, date '2026-10-30'),
  ('expattrusted', 'page-json', 95, date '2026-10-30'),
  ('eydah', 'none', 0, date '2026-10-30'),
  ('fahadalshahri', 'none', 0, date '2026-10-30'),
  ('fkralemar', 'none', 0, date '2026-10-30'),
  ('flow', 'ad-page', 1, date '2026-10-30'),
  ('fursaghyr', 'feed', 95, date '2026-10-30'),
  ('gathern', 'feed', 95, date '2026-10-30'),
  ('goldendeal', 'ad-page', 91, date '2026-10-30'),
  ('gomenassat', 'feed', 95, date '2026-10-30'),
  ('gudai', 'none', 0, date '2026-10-30'),
  ('hajer', 'ad-page', 85, date '2026-10-30'),
  ('haraj', 'partial', 75, date '2026-10-30'),
  ('hasaad', 'none', 0, date '2026-10-30'),
  ('hazim', 'partial', 10, date '2026-10-30'),
  ('holoul', 'partial', 35, date '2026-10-30'),
  ('ialqarawi', 'partial', 75, date '2026-10-30'),
  ('ibaax', 'feed', 95, date '2026-10-30'),
  ('jawher', 'partial', 75, date '2026-10-30'),
  ('jazwtn', 'none', 0, date '2026-10-30'),
  ('jurash', 'partial', 80, date '2026-10-30'),
  ('justsa', 'none', 0, date '2026-10-30'),
  ('ksaaqar', 'partial', 15, date '2026-10-30'),
  ('livingcompound', 'ad-page', 1, date '2026-10-30'),
  ('m3tmd', 'feed', 95, date '2026-10-30'),
  ('macsaib', 'partial', 1, date '2026-10-30'),
  ('maktab', 'feed', 95, date '2026-10-30'),
  ('manafe', 'page-json', 88, date '2026-10-30'),
  ('manzo', 'feed', 95, date '2026-10-30'),
  ('maqam', 'feed', 85, date '2026-10-30'),
  ('maqrat', 'page-json', 95, date '2026-10-30'),
  ('marksa', 'none', 0, date '2026-10-30'),
  ('masar', 'none', 0, date '2026-10-30'),
  ('mizlaj', 'feed', 95, date '2026-10-30'),
  ('mobasher', 'partial', 70, date '2026-10-30'),
  ('moftah', 'feed', 1, date '2026-10-30'),
  ('muajarh', 'feed', 95, date '2026-10-30'),
  ('muhaysini', 'feed', 95, date '2026-10-30'),
  ('muktamel', 'feed', 95, date '2026-10-30'),
  ('mustqr', 'partial', 1, date '2026-10-30'),
  ('nafithh', 'page-json', 95, date '2026-10-30'),
  ('nawafeth', 'partial', 50, date '2026-10-30'),
  ('nofodh', 'partial', 60, date '2026-10-30'),
  ('nowaisiry', 'partial', 40, date '2026-10-30'),
  ('nufouth', 'feed', 95, date '2026-10-30'),
  ('october', 'partial', 10, date '2026-10-30'),
  ('opensooq', 'partial', 70, date '2026-10-30'),
  ('qmra', 'none', 0, date '2026-10-30'),
  ('raghdan', 'page-json', 95, date '2026-10-30'),
  ('rakez', 'feed', 80, date '2026-10-30'),
  ('ramzalqasim', 'page-json', 95, date '2026-10-30'),
  ('rawaf', 'feed', 95, date '2026-10-30'),
  ('rawasidark', 'partial', 1, date '2026-10-30'),
  ('razre', 'feed', 95, date '2026-10-30'),
  ('reinvest', 'feed', 95, date '2026-10-30'),
  ('remal', 'none', 0, date '2026-10-30'),
  ('remaxsa', 'none', 0, date '2026-10-30'),
  ('rightcompound', 'feed', 95, date '2026-10-30'),
  ('ryadah', 'feed', 95, date '2026-10-30'),
  ('sadin', 'page-json', 1, date '2026-10-30'),
  ('sadiqeltajer', 'ad-page', 95, date '2026-10-30'),
  ('safa', 'ad-page', 1, date '2026-10-30'),
  ('safera', 'none', 0, date '2026-10-30'),
  ('sakan', 'ad-page', 89, date '2026-10-30'),
  ('sakani', 'feed', 95, date '2026-10-30'),
  ('sanadak', 'page-json', 95, date '2026-10-30'),
  ('satel', 'feed', 95, date '2026-10-30'),
  ('senan', 'feed', 1, date '2026-10-30'),
  ('shatri', 'ad-page', 90, date '2026-10-30'),
  ('shmoualshmal', 'none', 0, date '2026-10-30'),
  ('shomou', 'partial', 10, date '2026-10-30'),
  ('sirdab', 'partial', 45, date '2026-10-30'),
  ('snam', 'feed', 1, date '2026-10-30'),
  ('sodasyat', 'ad-page', 1, date '2026-10-30'),
  ('sokok', 'feed', 95, date '2026-10-30'),
  ('souq24', 'ad-page', 1, date '2026-10-30'),
  ('sqcc', 'partial', 1, date '2026-10-30'),
  ('squares', 'none', 0, date '2026-10-30'),
  ('sukna', 'feed', 95, date '2026-10-30'),
  ('superoffice', 'project-page', 1, date '2026-10-30'),
  ('suwar', 'none', 0, date '2026-10-30'),
  ('tamyaz', 'none', 0, date '2026-10-30'),
  ('tawia', 'page-json', 1, date '2026-10-30'),
  ('therc', 'partial', 50, date '2026-10-30'),
  ('thousand', 'partial', 50, date '2026-10-30'),
  ('tuba', 'feed', 95, date '2026-10-30'),
  ('villassa', 'feed', 95, date '2026-10-30'),
  ('vmksa', 'page-json', 95, date '2026-10-30'),
  ('wadod', 'ad-page', 95, date '2026-10-30'),
  ('wahadat', 'feed', 95, date '2026-10-30'),
  ('wajaf', 'page-json', 95, date '2026-10-30'),
  ('wasalt', 'feed', 95, date '2026-10-30'),
  ('wslnaa', 'feed', 20, date '2026-10-30'),
  ('yameen', 'page-json', 95, date '2026-10-30')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

-- What we serve, per platform, beside what we declared. Judged only at >= 50 served ads (a 9-ad site at 0/9 is a
-- question for the engineer's report, not a P1); an UNDECLARED platform at >= 50 ads is itself a finding.
create or replace function public.pin_coverage_by_platform()
returns table(platform text, ads bigint, pins bigint, pct numeric, pin_source text, floor_pct int, below_floor boolean, why text)
language sql stable security definer set search_path to 'public' as $$
  select s.platform, count(*) ads, count(s.latitude) pins,
         round(100.0 * count(s.latitude) / count(*), 1) pct, d.pin_source, d.floor_pct,
         -- floor 1 means «publishes: at least one served pin» (a 1-of-101 site is not below a 1 % floor); floor 0 is `none`.
         count(*) >= 50 and (d.platform is null
                             or (d.pin_source <> 'none' and count(s.latitude) = 0)
                             or (d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct)) as below_floor,
         case when count(*) < 50 then null
              when d.platform is null then 'undeclared: no row in data/pin-sources.json'
              when d.pin_source <> 'none' and count(s.latitude) = 0 then 'declared ' || d.pin_source || ' but serves 0 pins (the rakez shape)'
              when d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct then 'below its declared floor' end as why
    from public.search_listings_ar s
    left join public.ops_pin_source_declared d on d.platform = s.platform
   where s.production_ready
   group by s.platform, d.platform, d.pin_source, d.floor_pct
   order by 2 desc;
$$;
revoke all on function public.pin_coverage_by_platform() from public, anon, authenticated;
grant execute on function public.pin_coverage_by_platform() to service_role;

create or replace function public.mon_detect_pin_coverage_below_floor()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open boolean; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'ads', ads, 'pins', pins, 'pct', pct,
                                                          'declared', pin_source, 'floor', floor_pct, 'why', why) order by ads desc), '[]'::jsonb)
    into v_rows, v_by
    from public.pin_coverage_by_platform() where below_floor;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'pin_coverage_below_floor' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('pin_coverage_below_floor', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P1', 'pin_coverage_below_floor', 'location', 'pin_coverage_below_floor',
      jsonb_build_object('platforms', v_rows, 'per_platform', v_by, 'for', '⚡',
        'why', 'A platform serves fewer map pins than its declaration in data/pin-sources.json allows (or is declared as '
            || 'publishing pins and serves none, or is launched with no declaration). The source publishes them: find where '
            || '(the ad page, its embedded JSON / network calls, a site-wide map or list feed, the parent project page), fix '
            || 'the scraper, re-crawl, and let the :22 sync carry them. Never geocode an address into a pin, never lower the '
            || 'floor to clear this; a site proven silent is re-declared «none» with the URL you proved it on.'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_pin_coverage_below_floor() from public, anon, authenticated;
grant execute on function public.mon_detect_pin_coverage_below_floor() to service_role;

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_district_carries_ad_block_text'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_pin_coverage_below_floor''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_pin_coverage_below_floor'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_pin_coverage_below_floor''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: every declared floor holds today; a planted drop (one floor raised above what we serve) is caught, inside a
-- rolled-back sub-transaction; the detector is rostered, not orphaned.
do $proof$
declare base bigint; planted bigint; victim text; v_floor int;
begin
  select count(*) into base from public.pin_coverage_by_platform() where below_floor;
  if base <> 0 then
    raise exception 'PROOF: % platform(s) already below their declared floor — fix or re-declare before applying: %', base,
      (select string_agg(platform || ' ' || pct || '% < ' || coalesce(floor_pct::text, 'undeclared'), ', ') from public.pin_coverage_by_platform() where below_floor);
  end if;
  select platform, floor_pct into victim, v_floor from public.pin_coverage_by_platform()
   where ads >= 50 and pin_source <> 'none' and pct < 100 order by ads desc limit 1;
  if victim is null then raise exception 'PROOF: no platform to plant a drop on'; end if;
  begin
    update public.ops_pin_source_declared set floor_pct = 100 where platform = victim;
    select count(*) into planted from public.pin_coverage_by_platform() where below_floor;
    if planted <> base + 1 then raise exception 'PROOF: the planted floor on % was not caught (% vs %)', victim, planted, base; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select floor_pct from public.ops_pin_source_declared where platform = victim) is distinct from v_floor then
    raise exception 'PROOF: the planted floor was not rolled back';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_pin_coverage_below_floor') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: every declared pin floor holds; a planted drop on % is caught; rostered', victim;
end $proof$;