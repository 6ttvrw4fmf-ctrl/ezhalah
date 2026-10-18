-- PROVEN-SILENT DISTRICT SOURCES + THE DAILY WORK LIST (owner 2026-10-18: «the ones you say have no district,
-- I am confident they do. Fix it all, never again»).
--
-- Default: a live row with NO district is a BUG until a RENDERED page proves the site shows no district
-- anywhere — fields, breadcrumb, deed/licence box, page JSON, and the PARENT page for unit-in-project sites.
-- Rows in ops_district_silent_source ARE that proof, per listing (or per platform when the whole site is proven
-- silent). district_blank_unexplained() counts every blank-district row the proof does NOT cover — the work
-- list — and the daily detector raises it. Covered rows are CITY-LEVEL MATCHES: searchable by city, never an
-- error. A proof is per listing on purpose: a new blank row of the same site is NOT excused by an old proof.
create table if not exists public.ops_district_silent_source (
  id               bigserial primary key,
  platform         text        not null,
  source_table     text,                       -- null with listing_id null = the whole platform is proven silent
  listing_id       bigint,
  cohort           text        not null,       -- human label («nofodh RSH plan plots, Riyadh blocks»)
  selector_checked text        not null,       -- where on the RENDERED page the district was looked for
  proof            text        not null,       -- what the rendered page showed: ids, date, what was absent
  decided_at       timestamptz not null default now(),
  decided_by       text        not null default 'owner 2026-10-18',
  constraint odss_scope check ((source_table is null) = (listing_id is null))
);
create index if not exists idx_odss_scope on public.ops_district_silent_source (platform, source_table, listing_id);
alter table public.ops_district_silent_source enable row level security;

-- THE predicate. One place, so the detector, the engineers' queries and the self-test below cannot drift apart.
create or replace function public.district_blank_is_excused(p_platform text, p_source_table text, p_listing_id bigint)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.ops_district_silent_source o
     where o.platform = p_platform
       and (o.source_table is null or (o.source_table = p_source_table and o.listing_id = p_listing_id)));
$$;

-- The work list: per platform, live rows with no district and no proof (ads) beside the proven city-level
-- matches (excused). Reads the search index, the one surface every platform shares.
create or replace function public.district_blank_unexplained()
returns table(platform text, ads bigint, excused bigint)
language sql stable security definer set search_path to 'public'
as $$
  select s.platform,
         count(*) filter (where not public.district_blank_is_excused(s.platform, s.source_table, s.listing_id)) as ads,
         count(*) filter (where public.district_blank_is_excused(s.platform, s.source_table, s.listing_id))     as excused
    from public.search_listings_ar s
   where coalesce(s.district_ar, '') = ''
   group by s.platform;
$$;

create or replace function public.mon_detect_district_blank_unexplained()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb; n_platforms int; n_ads bigint; v_open text; r int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'ads', ads, 'excused', excused) order by ads desc), '[]'::jsonb),
         count(*) filter (where ads > 0), coalesce(sum(ads), 0)
    into v, n_platforms, n_ads
    from public.district_blank_unexplained();
  select severity into v_open from public.alert_event
   where dedup_key = 'district_blank_unexplained' and resolved_at is null order by created_at desc limit 1;
  if n_ads = 0 then
    if v_open is not null then perform public.mon_resolve('district_blank_unexplained', 'district_catalog'); end if;
  elsif v_open is null then
    r := public.mon_raise('P2', 'district_blank_unexplained', 'district_catalog', 'district_blank_unexplained',
      jsonb_build_object('platforms', n_platforms, 'ads', n_ads,
        'top', (select jsonb_agg(e) from (select e from jsonb_array_elements(v) e where (e->>'ads')::bigint > 0 limit 25) s),
        'why', 'Live rows with NO district that no rendered-page proof covers. Owner 2026-10-18: a NULL district is a bug until a rendered page proves the site shows none (fields, breadcrumb, deed/licence box, page JSON, parent project page). Fix the extractor + re-scrape, or record the proof in ops_district_silent_source (per listing). Covered rows are city-level matches, not errors.'));
  end if;
  return r;
end $function$;

select cron.schedule('mon-district-blank-unexplained', '47 4 * * *',
  $c$set statement_timeout to '300s'; select public.mon_detect_district_blank_unexplained();$c$);

-- SELF-TEST (mutation proof, runs at apply): a per-listing proof excuses that listing and nothing else; a
-- platform-wide proof excuses the platform; no proof, no excuse.
do $$
begin
  insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof)
  values ('__selftest_one__', 't_res', 1, 'c', 's', 'p'), ('__selftest_all__', null, null, 'c', 's', 'p');
  if not public.district_blank_is_excused('__selftest_one__', 't_res', 1) then
    raise exception 'self-test: a per-listing proof must excuse its own listing'; end if;
  if public.district_blank_is_excused('__selftest_one__', 't_res', 2) then
    raise exception 'self-test: a per-listing proof must NOT excuse a sibling row (never again)'; end if;
  if public.district_blank_is_excused('__selftest_one__', 't_com', 1) then
    raise exception 'self-test: a per-listing proof is bound to its source table'; end if;
  if not public.district_blank_is_excused('__selftest_all__', 'anything', 99) then
    raise exception 'self-test: a platform-wide proof must excuse the whole platform'; end if;
  if public.district_blank_is_excused('__selftest_none__', 't_res', 1) then
    raise exception 'self-test: no proof, no excuse'; end if;
  delete from public.ops_district_silent_source where platform like '\_\_selftest\_%';
end $$;

-- نفوذ (nofodh): 645 live rows with no district, proven silent on 2026-10-18.
--   • 625 Riyadh land plots (526 titled «RSH-BLK<block>-<plot>», 99 untitled): the plot page's own address
--     block prints «المدينة: الرياض» and no «الحي» (rendered in a real browser, listing 101165: the only «الحي»
--     on the page is the 8,377-option filter picker); their parent «بلوك» pages (373914, 525859, 642554,
--     643798, 840294, 902872 — the rendered /listings/sub children are exactly these plots) print «المدينة»
--     only; none of the site's 27 project pages (sitemap-complete: all 66 non-unit pages fetched) lists an RSH
--     child, and the /projects cards name no such plan. The 27 SOLD plots of other plans all print «الحي», so
--     the silence is this plan's, not the site's.
--   • 20 Abha units of «درة المنسك»: their parent project page 546554 prints «المدينة: ابها» and no «الحي»
--     (rendered), and the /projects card reads «ابها» alone.
insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof)
select s.platform, s.source_table, s.listing_id,
       case when s.city_ar = 'ابها' then 'nofodh «درة المنسك» units — parent project prints no district'
            else 'nofodh Riyadh plan plots (RSH blocks + untitled) — plot, block and project pages print no district' end,
       'rendered listing address block (المدينة/الحي), Livewire snapshots, parent بلوك page, all 27 project pages, /projects cards',
       '2026-10-18 rendered: unit 101165 → «العنوان: المدينة الرياض», no الحي; blocks 373914/525859/642554/643798/840294/902872 → المدينة only; 27/27 project pages checked, no RSH child; parent 546554 درة المنسك → no الحي. Sold plots of other plans print الحي (27/27).'
  from public.search_listings_ar s
 where s.platform = 'nofodh' and coalesce(s.district_ar, '') = ''
   and not public.district_blank_is_excused(s.platform, s.source_table, s.listing_id);