-- NEVER DUPLICATES, FOR EVERY LISTING (owner 2026-10-25: «make it a very very very strong rule and guard for every new
-- listing»). The list guard (20261025203753 + 20261025223135) stops a copy from ever joining the district list. This
-- migration stops a copy from ever becoming a second district IN SEARCH: when a site writes a district whose LETTERS equal
-- a name on our list for that city — spaces, punctuation and a trailing ا/ه/ء ignored («الملقا» = «حي الملقاه»), «ال»
-- ignored («ملك عبد الله» = «حي الملك عبدالله»), or the town's name stuck on («حي الربوة - بقيق» = «حي الربوة») — the
-- served district is our list's name. loc_display_district_ar() is what the hourly sync writes into search_listings_ar
-- for every listing, new and old, so this applies to all of them at the next sync and to every arrival after.
-- A name ONE LETTER away («المعيزيلة» ~ «حي المعيزلة») is NOT folded by itself: two real districts can differ by one letter
-- («الريحان» / «الريان»); the owner decides those through loc_district_alias, and the alarm below lists them.
-- Alarm: mon_detect_district_served_twins() (rostered, twice an hour) raises P1 when two served names in one city are
-- copies of each other that the fold did not join (a gap in the rule), and P2 with examples when two served names are one
-- letter apart (3+ ads each) so the owner can decide.

create index if not exists loc_catalog_district_city_k1_idx
  on public.loc_catalog_district (city_id, public.district_key_letters(district_ar));
create index if not exists loc_catalog_district_city_k2_idx
  on public.loc_catalog_district (city_id, replace(public.district_key_letters(district_ar), 'ال', ''));

-- The list name a raw spelling is a copy of (same letters / without «ال» / without the town name), or null.
create or replace function public.district_copy_of(p_city_id integer, p_raw text)
returns text
language sql stable
as $function$
  with q as (
    select public.district_key_letters(p_raw) k1,
           replace(public.district_key_letters(p_raw), 'ال', '') k2,
           public.district_key_letters(coalesce((select city_ar from public.loc_catalog_city where city_id = p_city_id), '')) town
  ), hit as (
    select b.district_norm, 0 pri from q, public.loc_catalog_district b
     where b.city_id = p_city_id and public.district_key_letters(b.district_ar) = q.k1
    union all
    select b.district_norm, 1 from q, public.loc_catalog_district b
     where b.city_id = p_city_id and replace(public.district_key_letters(b.district_ar), 'ال', '') = q.k2
    union all
    select b.district_norm, 2 from q, public.loc_catalog_district b
     where b.city_id = p_city_id and q.town <> '' and q.k1 <> q.town
       and public.district_key_letters(b.district_ar)
           = regexp_replace(regexp_replace(regexp_replace(q.k1, '^(ب)?' || q.town, ''), '(ب)?' || q.town || '$', ''), '[اهء]+$', '')
  )
  select district_norm from hit
   where public.district_key_letters(p_raw) <> ''
     and not exists (select 1 from public.loc_catalog_district f
                      where f.city_id = p_city_id and f.district_norm = public.norm_district_tok(p_raw))
   order by pri limit 1
$function$;

CREATE OR REPLACE FUNCTION public.loc_display_district_ar(p_city_id integer, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when p_raw is null then null else (
    select coalesce(
             (select k.display_ar from public.loc_display_district_canon k
               where k.city_id = p_city_id and k.district_norm = t.key),
             (select c.district_ar from public.loc_catalog_district c
               where t.key <> t.own and c.city_id = p_city_id and c.district_norm = t.key limit 1),
             p_raw)
      from (select norm_district_tok(p_raw) as own,
                   coalesce(
                     (select a.to_norm from public.loc_district_alias a
                       where a.city_id = p_city_id and a.from_norm = norm_district_tok(p_raw)),
                     (select b.district_norm from public.loc_catalog_district b
                       where norm_district_tok(p_raw) ~ '\s+(ال)?جديد[ه]?$'
                         and b.city_id = p_city_id
                         and b.district_norm = regexp_replace(norm_district_tok(p_raw), '\s+(ال)?جديد[ه]?$', '')
                         and not exists (select 1 from public.loc_catalog_district f
                                          where f.city_id = p_city_id and f.district_norm = norm_district_tok(p_raw))
                       limit 1),
                     public.district_copy_of(p_city_id, p_raw),
                     norm_district_tok(p_raw)) as key) t)
  end $function$;

create or replace function public.mon_detect_district_served_twins()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; v_copies bigint; v_near bigint; v_open_c boolean; v_open_n boolean; v_ex jsonb;
begin
  drop table if exists _served_names;
  create temp table _served_names on commit drop as
    select s.city_id, s.district_ar, public.district_key_letters(s.district_ar) k1,
           public.loc_display_district_ar(s.city_id, s.district_ar) shown, count(*) n
      from public.search_listings_ar s
     where s.city_id is not null and s.district_ar is not null and btrim(s.district_ar) <> ''
     group by 1, 2;
  -- P1: two served names in one city are copies (same letters / without «ال») and the rule did NOT join them
  select count(*) into v_copies from _served_names a join _served_names b
      on b.city_id = a.city_id and b.district_ar > a.district_ar
     and (a.k1 = b.k1 or replace(a.k1, 'ال', '') = replace(b.k1, 'ال', ''))
     and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown);
  v_open_c := exists (select 1 from public.alert_event where dedup_key = 'district_copies_served' and resolved_at is null);
  if v_copies = 0 then
    if v_open_c then perform public.mon_resolve('district_copies_served', 'location'); end if;
  elsif not v_open_c then
    select jsonb_agg(jsonb_build_object('city_id', a.city_id, 'a', a.district_ar, 'b', b.district_ar)) into v_ex
      from (select a.*, row_number() over () rn from _served_names a) a join _served_names b
        on b.city_id = a.city_id and b.district_ar > a.district_ar
       and (a.k1 = b.k1 or replace(a.k1, 'ال', '') = replace(b.k1, 'ال', ''))
       and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown)
     where a.rn <= 10;
    r := r + public.mon_raise('P1', 'district_copies_served', 'location', 'district_copies_served',
      jsonb_build_object('pairs', v_copies, 'examples', v_ex,
        'why', 'Two served district names in one city are the same letters, but loc_display_district_ar() does not join them: a copy is a second district in search (owner 2026-10-25: never duplicates).',
        'action', 'Find why district_copy_of() misses the pair; if the list lacks the name, add it through the guards; never add a second spelling.'));
  end if;
  -- P2: two served names in one city are ONE letter apart (3+ ads each) and shown as two districts: the owner decides
  select count(*) into v_near from _served_names a join _served_names b
      on b.city_id = a.city_id and b.district_ar > a.district_ar
     and a.n >= 3 and b.n >= 3 and length(a.k1) >= 5 and length(b.k1) >= 5 and abs(length(a.k1) - length(b.k1)) <= 1
     and a.k1 <> b.k1 and similarity(a.k1, b.k1) > 0.5 and public.district_edit_distance(a.k1, b.k1) = 1
     and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown);
  v_open_n := exists (select 1 from public.alert_event where dedup_key = 'district_near_twins_served' and resolved_at is null);
  if v_near = 0 then
    if v_open_n then perform public.mon_resolve('district_near_twins_served', 'location'); end if;
  elsif not v_open_n then
    select jsonb_agg(jsonb_build_object('city_id', x.city_id, 'a', x.a, 'a_ads', x.an, 'b', x.b, 'b_ads', x.bn)) into v_ex
      from (select a.city_id, a.district_ar a, a.n an, b.district_ar b, b.n bn from _served_names a join _served_names b
              on b.city_id = a.city_id and b.district_ar > a.district_ar
             and a.n >= 3 and b.n >= 3 and length(a.k1) >= 5 and length(b.k1) >= 5 and abs(length(a.k1) - length(b.k1)) <= 1
             and a.k1 <> b.k1 and similarity(a.k1, b.k1) > 0.5 and public.district_edit_distance(a.k1, b.k1) = 1
             and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown)
            order by a.n + b.n desc limit 15) x;
    r := r + public.mon_raise('P2', 'district_near_twins_served', 'location', 'district_near_twins_served',
      jsonb_build_object('pairs', v_near, 'examples', v_ex,
        'why', 'Two served district names in one city differ by one letter and show as two districts. Some are two real districts («الريحان» / «الريان»), some are one («المعيزيلة» / «المعيزلة»): the owner decides.',
        'action', 'For each pair the owner says is one district: insert into loc_district_alias (city_id, from_norm, to_norm, why, decided_by). Never add the second spelling to the list.'));
  end if;
  return r;
end $function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_district_served_twins''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_district_served_twins'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_district_served_twins''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF
do $proof$
declare v text; c_buq int := (select city_id from public.loc_catalog_city where city_ar = 'بقيق' limit 1);
begin
  v := public.loc_display_district_ar(c_buq, 'حي الربوة - بقيق');
  if v <> 'حي الربوة' then raise exception 'PROOF: town-suffix copy not folded: «حي الربوة - بقيق» → %', v; end if;
  v := public.loc_display_district_ar(664, 'الملقا');
  if v <> 'حي الملقاه' then raise exception 'PROOF: last-letter copy not folded: «الملقا» → %', v; end if;
  v := public.loc_display_district_ar(3, 'ملك عبد الله');
  if v <> 'حي الملك عبدالله' then raise exception 'PROOF: «ال»/spaces copy not folded: «ملك عبد الله» → %', v; end if;
  v := public.loc_display_district_ar(1061, 'حي الواحة');
  if v <> 'الواحة' then raise exception 'PROOF: same-letters copy not folded: «حي الواحة» → %', v; end if;
  v := public.loc_display_district_ar(3, 'المعيزيلة');
  if v <> 'المعيزيلة' then raise exception 'PROOF: a one-letter-away name was folded by itself (owner decides those): «المعيزيلة» → %', v; end if;
  if public.district_copy_of(3, 'حي منفوحة الجديدة') is not null then raise exception 'PROOF: منفوحة الجديدة read as a copy although our list has it as its own district'; end if;
  if public.district_copy_of(6, 'الشامية الجديد') is not null then raise exception 'PROOF: الشامية الجديد read as a copy although it is an official name on our list'; end if;
  if public.loc_display_district_ar(6, 'الشامية الجديد') <> 'حي الشامية الجديد' then raise exception 'PROOF: الشامية الجديد no longer shows as the list writes it (canon)'; end if;
  if public.loc_display_district_ar(3, 'حي النرجس') <> 'حي النرجس' then raise exception 'PROOF: a plain list name changed'; end if;
  if public.loc_display_district_ar(6, 'الهجلة الجديد') <> 'حي الهجلة' then raise exception 'PROOF: the «الجديد» rule broke'; end if;
  if public.district_copy_of(3, 'حي النرجس') is not null then raise exception 'PROOF: a name on the list reads as a copy of itself'; end if;
  perform public.mon_detect_district_served_twins();
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_district_served_twins') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: copy spellings fold to the list name for every listing; one-letter names wait for the owner; «الجديد» rule and plain names untouched; alarm rostered';
end $proof$;
