-- PIN DISTRICTS REACH EVERY SERVED AD IN A DISTRICT CITY, AND A DAILY DETECTOR KEEPS IT THAT WAY (owner 2026-11-05:
-- «fix the ads that have a pin inside a big city but still no district, and make it a rule»).
--
-- Measured 2026-11-05 08:40 UTC: 6,893 served ads have no district; 5,253 of them have a pin; 2,581 of those sit in a
-- city with >= 10 districts on our list (الدرعية 387, الرياض 270, ضرما 246, بريدة 139, الطائف 125 …). Three root causes:
--   1. STARVED LOADER. pin_district_load() writes a row only for a district it can switch on or hold; an answer it
--      refuses (Apple silent, name not on the list, other city) leaves no trace, so the nightly job re-asked the SAME
--      ~600 newest ads every night (11-04: asked 600, stored 9) and the other ~3,300 were never asked.
--      -> listing_pin_ask logs every answer; pin_district_candidates() serves never-asked ads first, re-asks after 14 days.
--   2. TOWN NAME COUNTED AS A SITE DISTRICT. ~490 ads carry only their TOWN's name in the district field («حي الدرعية
--      الجديدة» in الدرعية 269 — owner 10-25: = الدرعية; owner 10-26: a town is not its own district; «الطائف» in
--      الطائف 72, «حي جواثا», «الظهران» …). The index already hides it, so the ad shows NO district, but the loader and
--      the pin arm treated it as «the site names its own district» and never filled it. Same call the title arm made on
--      11-02 (20261102194923). -> district_is_own_town(); the loader, the candidate list and the pin arm treat an own-town
--      name as silent; listing_native_location_v2 serves a 'pin' recovery ahead of such a hidden name. A name of ANOTHER
--      town (Riyadh ads saying «الدرعية») is NOT silent: it stays a city question, untouched.
--   3. A RETIRED district could be answered: the loader and trg_pin_district_on_list now require retired_at is null.
-- Rule order kept: site (incl. the ad's own title, which now also beats a pin) → Apple middle → edge held for Google →
-- city only. Every other guard of the loader (list name, Apple city = served city, blank served ad, shared pin,
-- never overwrite, run_id shape, service role only) is unchanged.
-- mon_detect_pin_district_gap() (cron 13:41 UTC daily) repairs first (refills the recovery of any table with a
-- switched-on pin row that is not served), then P1 for what is still broken (arm refused / served path / never asked
-- within 3 days), and P2 for Apple names not on a covered city's list (alias gap for review, never auto-added).
set local lock_timeout = '15s';

-- 1. Every Apple answer, kept (latest per ad) ------------------------------------------------------------------------
create table if not exists public.listing_pin_ask (
  source_table   text        not null,
  listing_id     bigint      not null,
  city_id        integer,
  run_id         text        not null,
  asked_at       timestamptz not null default now(),
  verdict        text,
  apple_name     text,
  apple_locality text,
  outcome        text        not null,
  primary key (source_table, listing_id)
);
alter table public.listing_pin_ask enable row level security;
revoke all on table public.listing_pin_ask from public, anon, authenticated;

-- 2. A district field that only names the ad's OWN town says nothing about the district ------------------------------
create or replace function public.district_is_own_town(p_city_id integer, p_raw text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce((
    select public.loc_display_district_ar(p_city_id, p_raw) is null
       and (public.district_key_letters(p_raw) = public.district_key_letters(c.city_ar)
            or exists (select 1 from public.loc_district_alias a
                        where a.city_id = p_city_id and a.from_norm = public.norm_district_tok(p_raw)
                          and public.district_key_letters(a.to_norm) = public.district_key_letters(c.city_ar)))
      from public.loc_catalog_city c
     where c.city_id = p_city_id and nullif(btrim(p_raw), '') is not null), false)
$function$;

-- 3. The loader: own-town is silent, retired districts never answer, every answer is logged ---------------------------
create or replace function public.pin_district_load(p_rows jsonb, p_run_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_on int; v_edge int; v_total int; v_unlisted int; v_city int; v_silent int; v_already int; v_not_blank int; v_shared int;
  v_site_named int; v_logged int;
  v_top jsonb;
begin
  if p_run_id is null or p_run_id !~ '^apple-(nightly|ring)-\d{4}-\d{2}-\d{2}$' then
    raise exception 'pin_district_load: run_id must be apple-nightly-YYYY-MM-DD or apple-ring-YYYY-MM-DD, got %', p_run_id;
  end if;

  create temp table _pin_shared on commit drop as
    select round(latitude::numeric, 5) la, round(longitude::numeric, 5) lo
      from public.search_listings_ar
     where production_ready and latitude is not null and longitude is not null
     group by 1, 2 having count(*) >= 5;

  create temp table _pin_in on commit drop as
    select r.st, r.lid, r.cid, r.name, r.locality, r.verdict, r.lat, r.lng,
           c.district_ar as list_name,
           (ci.city_id is not null and public.norm_district_tok(ci.city_ar) = public.norm_district_tok(coalesce(r.locality, ''))) as city_ok,
           exists (select 1 from public.search_listings_ar x
                    where x.source_table = r.st and x.listing_id = r.lid and x.city_id = r.cid and x.production_ready
                      and (x.district_ar is null or btrim(x.district_ar) = '')) as blank,
           -- the site itself names a district (in its own words, a source-stated one, or its title): the pin never
           -- overrules it. A field that only names the ad's OWN town names no district (owner 10-26), so it is silent.
           (exists (select 1 from public.listing_native_location_v2 v
                     where v.source_table = r.st and v.listing_id = r.lid and nullif(btrim(v.district_ar), '') is not null
                       and not public.district_is_own_town(r.cid, v.district_ar))
            or exists (select 1 from public.listing_source_district_ar sd
                        where sd.source_table = r.st and sd.listing_id = r.lid
                          and not public.district_is_own_town(r.cid, sd.source_district_ar))
            or exists (select 1 from public.listing_title_district lt
                        where lt.source_table = r.st and lt.listing_id = r.lid)) as site_named,
           exists (select 1 from public.listing_pin_district p where p.source_table = r.st and p.listing_id = r.lid) as already,
           exists (select 1 from _pin_shared s where s.la = round(r.lat::numeric, 5) and s.lo = round(r.lng::numeric, 5)) as shared
      from jsonb_to_recordset(p_rows) as r(st text, lid bigint, cid int, name text, locality text, verdict text, lat double precision, lng double precision)
      left join public.loc_catalog_city ci on ci.city_id = r.cid
      left join lateral (
        select c.district_ar
          from public.loc_catalog_district c
         where c.city_id = r.cid and r.name is not null and c.retired_at is null
           and c.district_norm = public.norm_district_tok(public.loc_display_district_ar(r.cid, r.name))
           and c.district_ar !~ '[0-9٠-٩]'
           and public.norm_district_tok(c.district_ar) !~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)'
         limit 1) c on true;

  insert into public.listing_pin_district (source_table, listing_id, city_id, district_ar, run_id, applied)
  select st, lid, cid, list_name, p_run_id, (verdict = 'middle')
    from _pin_in
   where list_name is not null and city_ok and blank and not site_named and not already and not shared
     and verdict in ('middle', 'edge')
  on conflict (source_table, listing_id) do nothing;

  -- every answer is kept (latest per ad), so a refused ad is not asked again tomorrow and the tail is reached
  insert into public.listing_pin_ask (source_table, listing_id, city_id, run_id, asked_at, verdict, apple_name, apple_locality, outcome)
  select distinct on (i.st, i.lid) i.st, i.lid, i.cid, p_run_id, now(), i.verdict, i.name, i.locality,
         case when i.already then 'already_had_pin_row'
              when p.run_id = p_run_id and p.applied then 'switched_on'
              when p.run_id = p_run_id then 'held_edge'
              when not i.blank then 'not_a_blank_served_ad'
              when i.site_named then 'site_names_its_own_district'
              when i.shared then 'shared_pin'
              when i.name is null then 'apple_silent'
              when i.list_name is null then 'name_not_on_list'
              when not i.city_ok then 'other_city'
              else 'not_loaded' end
    from _pin_in i
    left join public.listing_pin_district p on p.source_table = i.st and p.listing_id = i.lid
   where i.st is not null and i.lid is not null
   order by i.st, i.lid
  on conflict (source_table, listing_id) do update
    set city_id = excluded.city_id, run_id = excluded.run_id, asked_at = excluded.asked_at, verdict = excluded.verdict,
        apple_name = excluded.apple_name, apple_locality = excluded.apple_locality, outcome = excluded.outcome;
  get diagnostics v_logged = row_count;

  select count(*) into v_total from _pin_in;
  select count(*) filter (where applied), count(*) filter (where not applied)
    into v_on, v_edge
    from public.listing_pin_district where run_id = p_run_id;
  select count(*) filter (where name is null),
         count(*) filter (where name is not null and list_name is null),
         count(*) filter (where name is not null and list_name is not null and not city_ok),
         count(*) filter (where already),
         count(*) filter (where not blank),
         count(*) filter (where shared),
         count(*) filter (where blank and site_named)
    into v_silent, v_unlisted, v_city, v_already, v_not_blank, v_shared, v_site_named
    from _pin_in;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top
    from (select cid, name, count(*) n from _pin_in
           where name is not null and list_name is null and city_ok and not site_named
           group by 1, 2 order by 3 desc limit 25) t;

  return jsonb_build_object('run_id', p_run_id, 'rows', v_total, 'switched_on', v_on, 'held_edge', v_edge,
                            'apple_silent', v_silent, 'name_not_on_list', v_unlisted, 'other_city', v_city,
                            'already_had_pin_row', v_already, 'not_a_blank_served_ad', v_not_blank, 'shared_pin', v_shared,
                            'site_names_its_own_district', v_site_named, 'logged', v_logged,
                            'top_names_not_on_list', v_top);
end
$function$;

revoke all on function public.pin_district_load(jsonb, text) from public, anon, authenticated;

-- 4. Who to ask tonight: never-asked first, district cities first, re-ask after 14 days -------------------------------
-- The same filters the loader applies (blank served ad, no pin row, not a shared pin, site silent or own town, no title
-- district), so the cap is spent only on ads a map answer can fill. v1 (indexed) instead of v2 keeps it under a second:
-- a recovered district would already be served, so a blank served ad's v2 district is its v1 district.
create or replace function public.pin_district_candidates(p_max integer default 600)
 returns table (source_table text, listing_id bigint, city_id integer, latitude double precision, longitude double precision)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with shared as (
    select round(s.latitude::numeric, 5) la, round(s.longitude::numeric, 5) lo
      from public.search_listings_ar s
     where s.production_ready and s.latitude is not null and s.longitude is not null
     group by 1, 2 having count(*) >= 5),
  cov as (select d.city_id, count(*) nd from public.loc_catalog_district d where d.retired_at is null group by 1)
  select s.source_table, s.listing_id, s.city_id, s.latitude::double precision, s.longitude::double precision
    from public.search_listings_ar s
    left join cov on cov.city_id = s.city_id
    left join public.listing_pin_ask k on k.source_table = s.source_table and k.listing_id = s.listing_id
    left join public.listing_native_location_v1 v1 on v1.source_table = s.source_table and v1.listing_id = s.listing_id
   where s.production_ready and (s.district_ar is null or btrim(s.district_ar) = '')
     and s.latitude is not null and s.longitude is not null and s.city_id is not null
     and not exists (select 1 from public.listing_pin_district p where p.source_table = s.source_table and p.listing_id = s.listing_id)
     and not exists (select 1 from shared x where x.la = round(s.latitude::numeric, 5) and x.lo = round(s.longitude::numeric, 5))
     and (nullif(btrim(v1.district_ar), '') is null or public.district_is_own_town(s.city_id, v1.district_ar))
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = s.source_table and sd.listing_id = s.listing_id
                        and not public.district_is_own_town(s.city_id, sd.source_district_ar))
     and not exists (select 1 from public.listing_title_district lt where lt.source_table = s.source_table and lt.listing_id = s.listing_id)
     and (k.listing_id is null or k.asked_at < now() - interval '14 days')
   order by (k.listing_id is null) desc, (coalesce(cov.nd, 0) >= 10) desc, s.last_updated desc nulls last, s.source_table, s.listing_id
   limit greatest(coalesce(p_max, 600), 0)
$function$;

revoke all on function public.pin_district_candidates(integer) from public, anon, authenticated;

-- 5. A retired district (e.g. «حي الدرعية», retired 10-26: own city name) is never a pin answer -----------------------
create or replace function public.trg_pin_district_on_list()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_list text;
begin
  select c.district_ar into v_list
    from public.loc_catalog_district c
   where c.city_id = new.city_id and c.retired_at is null
     and c.district_norm = public.norm_district_tok(public.loc_display_district_ar(new.city_id, new.district_ar))
   limit 1;
  if v_list is null then
    raise exception 'pin district guard: «%» is not on the district list for city % — a map answer only fills a district we already know', new.district_ar, new.city_id;
  end if;
  if v_list ~ '[0-9٠-٩]' or public.norm_district_tok(v_list) ~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)' then
    raise exception 'pin district guard: «%» is on the list but is not a district a home sits in (plan, base, street, road, villages or a number)', v_list;
  end if;
  new.district_ar := v_list;
  return new;
end $function$;

-- 6. The pin arm fills an own-town ad too, and steps aside for the ad's own title (patched on the live body) ----------
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  old1 constant text := $o$      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and (nullif(btrim(x.neighborhood), '') is null$o$;
  new1 constant text := $n$      and (v1.district_ar is null or btrim(v1.district_ar) = ''
           or public.district_is_own_town(coalesce(s.city_id, v1.city_id), v1.district_ar))
      and not exists (select 1 from public.listing_title_district lt
                       where lt.source_table = p.source_table and lt.listing_id = p.listing_id)
      and (nullif(btrim(x.neighborhood), '') is null$n$;
  old2 constant text := $o$            where sd.source_table = p.source_table and sd.listing_id = p.listing_id)
    on conflict (source_table, listing_id) do nothing
  $f$, p_table, p_table);$o$;
  new2 constant text := $n$            where sd.source_table = p.source_table and sd.listing_id = p.listing_id
              and not public.district_is_own_town(coalesce(s.city_id, v1.city_id), sd.source_district_ar))
    on conflict (source_table, listing_id) do nothing
  $f$, p_table, p_table);$n$;
begin
  if (length(d) - length(replace(d, old1, ''))) / length(old1) <> 1 then
    raise exception 'refresh_district_recovery_table: pin arm district clause not found exactly once';
  end if;
  if (length(d) - length(replace(d, old2, ''))) / length(old2) <> 1 then
    raise exception 'refresh_district_recovery_table: pin arm source-district clause not found exactly once';
  end if;
  execute replace(replace(d, old1, new1), old2, new2);
  d := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  if position('public.district_is_own_town(coalesce(s.city_id, v1.city_id), v1.district_ar)' in d) = 0
     or position('public.district_is_own_town(coalesce(s.city_id, v1.city_id), sd.source_district_ar)' in d) = 0 then
    raise exception 'refresh_district_recovery_table: pin arm patch did not land';
  end if;
end
$mig$;

-- 7. The served district: a pin recovery beats a hidden own-town name, like the title one (patched on the live view) --
do $mig$
declare
  d text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  old_txt constant text := 'WHEN (dr.basis = ''title''::text) THEN dr.district_ar';
  new_txt constant text := 'WHEN (dr.basis = ANY (ARRAY[''title''::text, ''pin''::text])) THEN dr.district_ar';
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'listing_native_location_v2: title-over-hidden branch not found exactly once';
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(d, old_txt, new_txt);
  if position('''pin''::text' in pg_get_viewdef('public.listing_native_location_v2'::regclass)) = 0 then
    raise exception 'listing_native_location_v2: pin-over-hidden patch did not land';
  end if;
end
$mig$;

-- 8. The rule: daily detector — repair first, P1 for the residue -----------------------------------------------------
-- The cohort: a served ad with a pin and no district, in a city with >= 10 districts on the list, whose site is silent
-- (or names only its own town) and that has no title district. A site that names some other place is the job of
-- mon_detect_unknown_named_district, not this one.
create or replace function public.pin_district_gap_rows()
 returns table (source_table text, listing_id bigint, city_id integer, first_seen_at timestamptz, state text,
                apple_name text, pin_created_at timestamptz, in_recovery boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with cov as (select d.city_id from public.loc_catalog_district d where d.retired_at is null group by 1 having count(*) >= 10),
  shared as (
    select round(s.latitude::numeric, 5) la, round(s.longitude::numeric, 5) lo
      from public.search_listings_ar s
     where s.production_ready and s.latitude is not null and s.longitude is not null
     group by 1, 2 having count(*) >= 5)
  select s.source_table, s.listing_id, s.city_id, s.first_seen_at,
         case when p.applied then 'applied_not_served'
              when p.listing_id is not null then 'held_edge'
              when x.la is not null then 'shared_pin'
              when k.listing_id is null then 'never_asked'
              else k.outcome end,
         k.apple_name, p.created_at,
         exists (select 1 from public.district_recovery r
                  where r.source_table = s.source_table and r.listing_id = s.listing_id and r.basis = 'pin')
    from public.search_listings_ar s
    join cov on cov.city_id = s.city_id
    left join public.listing_native_location_v1 v1 on v1.source_table = s.source_table and v1.listing_id = s.listing_id
    left join public.listing_pin_district p on p.source_table = s.source_table and p.listing_id = s.listing_id
    left join public.listing_pin_ask k on k.source_table = s.source_table and k.listing_id = s.listing_id
    left join shared x on x.la = round(s.latitude::numeric, 5) and x.lo = round(s.longitude::numeric, 5)
   where s.production_ready and (s.district_ar is null or btrim(s.district_ar) = '')
     and s.latitude is not null and s.longitude is not null
     and (nullif(btrim(v1.district_ar), '') is null or public.district_is_own_town(s.city_id, v1.district_ar))
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = s.source_table and sd.listing_id = s.listing_id
                        and not public.district_is_own_town(s.city_id, sd.source_district_ar))
     and not exists (select 1 from public.listing_title_district lt where lt.source_table = s.source_table and lt.listing_id = s.listing_id)
$function$;

revoke all on function public.pin_district_gap_rows() from public, anon, authenticated;

create or replace function public.mon_detect_pin_district_gap()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; st text; v_healed bigint; v_broken bigint; v_never bigint; v_states jsonb; v_names jsonb; v_n_names int;
begin
  create temp table _pin_gap on commit drop as select * from public.pin_district_gap_rows();

  -- REPAIR FIRST (owner 10-31): a switched-on pin row whose ad is still blank → refill that table's recovery; the arm
  -- writes it and the :22 sync serves it. Layer 1 (the site's own words) is re-read by the same refill.
  for st in select distinct g.source_table from _pin_gap g where g.state = 'applied_not_served' loop
    perform public.refresh_district_recovery_table(st);
  end loop;
  select count(*) into v_healed
    from _pin_gap g
   where g.state = 'applied_not_served'
     and exists (select 1 from public.district_recovery r
                  where r.source_table = g.source_table and r.listing_id = g.listing_id and r.basis = 'pin');
  if v_healed = 0 then
    perform public.mon_resolve_key('pin_district_gap_self_healed', 'pin_district_gap_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'pin_district_gap_self_healed', 'location', 'pin_district_gap_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'switched-on pin districts were not in district_recovery; this detector refilled their tables, the :22 sync serves them. Find what skipped the hourly district-recovery-pipeline (:54).'));
  end if;

  -- RESIDUE = the real signal: (a) a switched-on pin the arm still refuses, or one a day old that the served path
  -- (listing_native_location_v2 → sync) still drops; (b) an ad first served 3+ days ago that the nightly never asked.
  select count(*) filter (where g.state = 'applied_not_served'
                            and (not exists (select 1 from public.district_recovery r
                                              where r.source_table = g.source_table and r.listing_id = g.listing_id and r.basis = 'pin')
                                 or g.pin_created_at < now() - interval '1 day')),
         count(*) filter (where g.state = 'never_asked' and g.first_seen_at < now() - interval '3 days')
    into v_broken, v_never
    from _pin_gap g;
  select coalesce(jsonb_object_agg(state, k), '{}'::jsonb) into v_states
    from (select state, count(*) k from _pin_gap group by 1) t;
  if v_broken + v_never = 0 then
    perform public.mon_resolve_key('pin_district_gap', 'pin_district_gap:fleet');
  else
    n := n + public.mon_raise('P1', 'pin_district_gap', 'location', 'pin_district_gap:fleet',
      jsonb_build_object('pin_not_served', v_broken, 'never_asked_3d', v_never, 'states', v_states,
        'examples', (select jsonb_agg(jsonb_build_object('source_table', e.source_table, 'listing_id', e.listing_id, 'state', e.state))
                       from (select g.source_table, g.listing_id, g.state from _pin_gap g
                              where (g.state = 'applied_not_served' and (not g.in_recovery or g.pin_created_at < now() - interval '1 day'))
                                 or (g.state = 'never_asked' and g.first_seen_at < now() - interval '3 days')
                              order by g.state, g.source_table, g.listing_id limit 10) e),
        'why', 'A served ad with a map pin in a city whose districts we list has no district, and the pin layer failed it: either a switched-on pin district is not served (the pin arm of refresh_district_recovery_table or the pin branch of listing_native_location_v2 lost a clause), or the nightly Apple job (pin-district-nightly.yml → pin_district_candidates) did not reach an ad in 3 days.',
        'fix', 'never_asked: check the last pin-district-nightly run (secrets, 429, cap) and pin_district_candidates(); pin_not_served: run refresh_district_recovery_table(<table>) and read why the arm skips the row. Edge homes (held_edge), Apple silent, other city and shared pins are rule outcomes (city only), never this alarm.'));
  end if;

  -- ALIAS GAP for review (P2, never auto-added): Apple names a place in a covered city that our list does not hold.
  select coalesce(jsonb_agg(jsonb_build_object('city_id', city_id, 'apple_name', apple_name, 'ads', k) order by k desc), '[]'::jsonb), count(*)
    into v_names, v_n_names
    from (select g.city_id, g.apple_name, count(*) k from _pin_gap g
           where g.state = 'name_not_on_list' and g.apple_name is not null group by 1, 2 having count(*) >= 3) t;
  if v_n_names = 0 then
    perform public.mon_resolve_key('pin_district_name_not_on_list', 'pin_district_name_not_on_list:fleet');
  else
    n := n + public.mon_raise('P2', 'pin_district_name_not_on_list', 'district_catalog', 'pin_district_name_not_on_list:fleet',
      jsonb_build_object('names', v_n_names, 'top', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_names) e limit 25) s),
        'why', 'Apple Maps names a district at these pins that is not on the city''s list, so the ads stay city-only. Decide per name by the owner rules: «X الجديد(ة)» = X (automatic); a near-twin is ONE only if pins < 1.5 km apart AND the maps agree (loc_district_alias); a missing district is added only from the official list. Never by letters.'));
  end if;
  return n;
end $function$;

select cron.schedule('mon-pin-district-gap', '41 13 * * *',
  $c$set statement_timeout to '600s'; select public.mon_detect_pin_district_gap();$c$);

-- 9. PROOF (rolled back): own-town reads as silent and another town does not; the loader now loads the own-town ad it
-- refused on 10-30 and logs every answer; the detector classifies a never-asked ad and lets go of it once asked.
do $proof$
declare r jsonb; v_cnt int; v_state text; v_ask int;
begin
  if not public.district_is_own_town(664, 'حي الدرعية الجديدة') then raise exception 'PROOF: «حي الدرعية الجديدة» in الدرعية is not own-town'; end if;
  if not public.district_is_own_town(5, 'الطائف') then raise exception 'PROOF: «الطائف» in الطائف is not own-town'; end if;
  if public.district_is_own_town(3, 'الدرعية') then raise exception 'PROOF: another town («الدرعية» in الرياض) read as own-town'; end if;
  if public.district_is_own_town(664, 'حي الملقاه') then raise exception 'PROOF: a real district read as own-town'; end if;
  if public.district_is_own_town(664, null) or public.district_is_own_town(null, 'الدرعية') then raise exception 'PROOF: null read as own-town'; end if;

  select count(*) into v_cnt from public.pin_district_candidates(5000) c
   where c.source_table = 'aqar_residential_listings' and c.listing_id = 326911;
  if v_cnt <> 1 then raise exception 'PROOF: aqar 326911 («حي الدرعية الجديدة», blank, pin) is not a candidate'; end if;
  select g.state into v_state from public.pin_district_gap_rows() g where g.source_table = 'aqar_residential_listings' and g.listing_id = 326911;
  if v_state is distinct from 'never_asked' then raise exception 'PROOF: aqar 326911 gap state is %, want never_asked', v_state; end if;

  begin
    r := public.pin_district_load('[{"st":"aqar_residential_listings","lid":326911,"cid":664,"name":"العمارية","locality":"الدرعية","verdict":"middle","lat":24.777895,"lng":46.405538},{"st":"aqar_residential_listings","lid":-1,"cid":664,"name":null,"locality":null,"verdict":"silent","lat":24.7,"lng":46.4}]'::jsonb, 'apple-ring-2000-01-03');
    if (r->>'switched_on')::int <> 1 then raise exception 'PROOF: the own-town ad was not switched on: %', r; end if;
    if (r->>'logged')::int <> 2 then raise exception 'PROOF: not every answer was logged: %', r; end if;
    select count(*) into v_ask from public.listing_pin_ask where run_id = 'apple-ring-2000-01-03' and outcome in ('switched_on', 'not_a_blank_served_ad');
    if v_ask <> 2 then raise exception 'PROOF: ask log outcomes wrong (% of 2)', v_ask; end if;
    select count(*) into v_cnt from public.pin_district_candidates(5000) c
     where c.source_table = 'aqar_residential_listings' and c.listing_id = 326911;
    if v_cnt <> 0 then raise exception 'PROOF: an ad with a pin row is still a candidate'; end if;
    perform public.refresh_district_recovery_table('aqar_residential_listings');
    if not exists (select 1 from public.district_recovery where source_table = 'aqar_residential_listings' and listing_id = 326911 and basis = 'pin') then
      raise exception 'PROOF: the pin arm did not fill the own-town ad';
    end if;
    if (select v.district_ar from public.listing_native_location_v2 v where v.source_table = 'aqar_residential_listings' and v.listing_id = 326911)
       is distinct from (select district_ar from public.listing_pin_district where source_table = 'aqar_residential_listings' and listing_id = 326911) then
      raise exception 'PROOF: v2 does not serve the pin district over the hidden town name';
    end if;
    raise exception 'ROLLBACK_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROOF' then raise; end if;
  end;
  if exists (select 1 from public.listing_pin_district where run_id = 'apple-ring-2000-01-03')
     or exists (select 1 from public.listing_pin_ask where run_id = 'apple-ring-2000-01-03') then
    raise exception 'PROOF: proof rows stayed';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_pin_district_gap') <> 0 then
    raise exception 'PROOF: mon_detect_pin_district_gap reads as orphaned';
  end if;
  raise notice 'PROOF OK: own-town silent, other town not; loader loads + logs; arm + v2 serve it; detector wired';
end $proof$;
