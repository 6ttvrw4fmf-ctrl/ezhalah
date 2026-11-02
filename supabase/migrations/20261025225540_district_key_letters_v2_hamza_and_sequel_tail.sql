-- district_key_letters() v2 (2026-10-25, 40 minutes after v1). The alarm mon_detect_district_served_twins() caught v1's
-- mistake on its first run: it dropped EVERY trailing ا/ه/ء, so «الزهراء» and «الزهرة» (two real Riyadh districts), «السلام»
-- and «السلامة» (Makkah), «البديع» and «البديعة», «الفيصلي» and «الفيصلية» read as the same letters. v2 keeps a final hamza
-- («زهراء» stays), turns a final ا/ه run into one marker «#» so «غبيرا» = «غبيرة» and «الملقا» = «الملقاه» still hold but
-- «سلام» ≠ «سلام#», and keeps a one-letter sequel tail («الجابرية أ» = «جابري#|ا» ≠ «الجابرية»). The two expression indexes
-- are rebuilt (an index keeps the old function's values); district_twin_strong() and district_copy_of() use the same end rule
-- after stripping the town name. The alarm now splits: P1 only when a copy pair has a side on our
-- list (a gap in the fold), P2 «district_copies_unlisted» when neither side is on the list (the engineer adds the real name
-- through the guards, then the fold joins them; Hofuf names wait for the owner).

-- The end-of-name rule, shared by the key and by the town-strip step: a final hamza stays, a final run of ا/ه becomes «#».
create or replace function public.district_key_finish(p text)
returns text
language sql immutable
as $function$
  select case when p ~ 'ء$' then p else regexp_replace(p, '[اه]+$', '#') end
$function$;

create or replace function public.district_key_letters(p text)
returns text
language sql immutable
as $function$
  with r as (select regexp_replace(regexp_replace(public.normalize_ar(coalesce(p, '')), '^(حي\s+)+', ''), '^ال', '') s),
       t as (select s, case when s ~ '(^|\s)[ء-ي]$' and s ~ '\s' then right(s, 1) else '' end tl from r),
       l as (select tl, regexp_replace(case when tl <> '' then left(s, length(s) - 1) else s end, '[^ء-ي]', '', 'g') base from t)
  select case when base = '' then ''
              else public.district_key_finish(base) || case when tl <> '' then '|' || tl else '' end end
    from l
$function$;

create or replace function public.district_twin_strong(p_city_id integer, p_name text, p_except_district_id integer default null)
returns table (how text, twin_ar text)
language sql stable
as $function$
  with q as (
    select public.district_key_letters(p_name) k1,
           replace(public.district_key_letters(p_name), 'ال', '') k2,
           public.district_key_letters(coalesce((select city_ar from public.loc_catalog_city where city_id = p_city_id), '')) town
  ), c as (
    select d.district_id, d.district_ar, public.district_key_letters(d.district_ar) k1
      from public.loc_catalog_district d
     where d.city_id = p_city_id and (p_except_district_id is null or d.district_id <> p_except_district_id)
  )
  select how, c.district_ar
    from q, c,
    lateral (select case
      when c.k1 = q.k1 then 'same letters'
      when replace(c.k1, 'ال', '') = q.k2 then 'same letters without «ال»'
      when q.town <> '' and (public.district_key_finish(regexp_replace(regexp_replace(q.k1, '^(ب)?' || q.town, ''), '(ب)?' || q.town || '$', '')) = c.k1
                             or public.district_key_finish(regexp_replace(regexp_replace(c.k1, '^(ب)?' || q.town, ''), '(ب)?' || q.town || '$', '')) = q.k1) then 'same letters without the town name'
      when length(q.k1) >= 5 and length(c.k1) >= 5 and abs(length(q.k1) - length(c.k1)) <= 1
           and public.district_edit_distance(q.k1, c.k1) <= 1 then 'one letter away'
      end as how) h
   where how is not null
   order by case how when 'same letters' then 0 when 'same letters without «ال»' then 1 when 'same letters without the town name' then 2 else 3 end
   limit 1
$function$;

create or replace function public.district_copy_of(p_city_id integer, p_raw text)
returns text
language plpgsql stable
as $function$
declare n text; k1 text; k1s text; k2 text; town text; v text;
begin
  n := public.norm_district_tok(p_raw);
  if n is null or n = '' then return null; end if;
  if exists (select 1 from public.loc_catalog_district f where f.city_id = p_city_id and f.district_norm = n) then return null; end if;
  k1 := public.district_key_letters(p_raw);
  if k1 = '' then return null; end if;
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and public.district_key_letters(b.district_ar) = k1 limit 1;
  if v is not null then return v; end if;
  k2 := replace(k1, 'ال', '');
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and replace(public.district_key_letters(b.district_ar), 'ال', '') = k2 limit 1;
  if v is not null then return v; end if;
  town := public.district_key_letters(coalesce((select city_ar from public.loc_catalog_city where city_id = p_city_id), ''));
  if town = '' or k1 = town then return null; end if;
  k1s := public.district_key_finish(regexp_replace(regexp_replace(k1, '^(ب)?' || town, ''), '(ب)?' || town || '$', ''));
  if k1s = k1 or k1s = '' then return null; end if;
  select b.district_norm into v from public.loc_catalog_district b
   where b.city_id = p_city_id and public.district_key_letters(b.district_ar) = k1s limit 1;
  return v;
end $function$;

drop index if exists public.loc_catalog_district_city_k1_idx;
drop index if exists public.loc_catalog_district_city_k2_idx;
create index loc_catalog_district_city_k1_idx
  on public.loc_catalog_district (city_id, public.district_key_letters(district_ar));
create index loc_catalog_district_city_k2_idx
  on public.loc_catalog_district (city_id, replace(public.district_key_letters(district_ar), 'ال', ''));

create or replace function public.mon_detect_district_served_twins()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; v_gap bigint; v_unl bigint; v_near bigint; v_open boolean; v_ex jsonb;
begin
  drop table if exists _served_names;
  create temp table _served_names on commit drop as
    select s.city_id, s.district_ar, public.district_key_letters(s.district_ar) k1,
           public.loc_display_district_ar(s.city_id, s.district_ar) shown, count(*) n,
           exists (select 1 from public.loc_catalog_district c where c.city_id = s.city_id and c.district_norm = public.norm_district_tok(s.district_ar)) listed
      from public.search_listings_ar s
     where s.city_id is not null and s.district_ar is not null and btrim(s.district_ar) <> ''
     group by 1, 2;
  create temp table _copy_pairs on commit drop as
    select a.city_id, a.district_ar a_ar, a.n a_n, a.listed a_listed, b.district_ar b_ar, b.n b_n, b.listed b_listed
      from _served_names a join _served_names b
        on b.city_id = a.city_id and b.district_ar > a.district_ar
       and (a.k1 = b.k1 or replace(a.k1, 'ال', '') = replace(b.k1, 'ال', ''))
       and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown);
  -- P1: a copy pair with a side on our list that the fold did not join = a gap in the rule
  select count(*) into v_gap from _copy_pairs where a_listed or b_listed;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_copies_served' and resolved_at is null);
  if v_gap = 0 then
    if v_open then perform public.mon_resolve('district_copies_served', 'location'); end if;
  elsif not v_open then
    select jsonb_agg(jsonb_build_object('city_id', city_id, 'a', a_ar, 'b', b_ar)) into v_ex
      from (select * from _copy_pairs where a_listed or b_listed order by a_n + b_n desc limit 10) x;
    r := r + public.mon_raise('P1', 'district_copies_served', 'location', 'district_copies_served',
      jsonb_build_object('pairs', v_gap, 'examples', v_ex,
        'why', 'Two served district names in one city are the same letters, one is on our list, and loc_display_district_ar() does not join them: a copy is a second district in search (owner 2026-10-25: never duplicates).',
        'action', 'Find why district_copy_of() misses the pair and fix the rule; never add a second spelling to the list.'));
  end if;
  -- P2: a copy pair where NEITHER side is on our list: the real name must be added through the guards, then the fold joins them
  select count(*) into v_unl from _copy_pairs where not a_listed and not b_listed;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_copies_unlisted' and resolved_at is null);
  if v_unl = 0 then
    if v_open then perform public.mon_resolve('district_copies_unlisted', 'location'); end if;
  elsif not v_open then
    select jsonb_agg(jsonb_build_object('city_id', city_id, 'a', a_ar, 'a_ads', a_n, 'b', b_ar, 'b_ads', b_n)) into v_ex
      from (select * from _copy_pairs where not a_listed and not b_listed order by a_n + b_n desc limit 15) x;
    r := r + public.mon_raise('P2', 'district_copies_unlisted', 'location', 'district_copies_unlisted',
      jsonb_build_object('pairs', v_unl, 'examples', v_ex,
        'why', 'Two served district names in one city are the same letters and neither is on our list, so they show as two districts. The fold can only join names to the list.',
        'action', 'New Listings Engineer: add the real district name (one spelling) through the guards; the fold joins the copies at the next sync. Hofuf «ضاحية هجر …» names wait for the owner.'));
  end if;
  -- P2: two served names one letter apart (3+ ads each): the owner decides
  select count(*) into v_near from _served_names a join _served_names b
      on b.city_id = a.city_id and b.district_ar > a.district_ar
     and a.n >= 3 and b.n >= 3 and length(a.k1) >= 5 and length(b.k1) >= 5 and abs(length(a.k1) - length(b.k1)) <= 1
     and a.k1 <> b.k1 and similarity(a.k1, b.k1) > 0.5 and public.district_edit_distance(a.k1, b.k1) = 1
     and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown);
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_near_twins_served' and resolved_at is null);
  if v_near = 0 then
    if v_open then perform public.mon_resolve('district_near_twins_served', 'location'); end if;
  elsif not v_open then
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

-- PROOF
do $proof$
declare k text := 'district_key_letters'; v text; n_old bigint; c_buq int := (select city_id from public.loc_catalog_city where city_ar = 'بقيق' limit 1);
begin
  -- different districts stay different
  if public.district_key_letters('الزهراء') = public.district_key_letters('حي الزهرة') then raise exception 'PROOF: الزهراء = الزهرة'; end if;
  if public.district_key_letters('السلام') = public.district_key_letters('السلامة') then raise exception 'PROOF: السلام = السلامة'; end if;
  if public.district_key_letters('البديع') = public.district_key_letters('البديعة') then raise exception 'PROOF: البديع = البديعة'; end if;
  if public.district_key_letters('الفيصلي') = public.district_key_letters('الفيصلية') then raise exception 'PROOF: الفيصلي = الفيصلية'; end if;
  if public.district_key_letters('الجابرية أ') = public.district_key_letters('الجابرية') then raise exception 'PROOF: a sequel tail was lost'; end if;
  if public.district_key_letters('المروج أ') = public.district_key_letters('المروج') then raise exception 'PROOF: a sequel tail was lost (المروج أ)'; end if;
  -- copies still equal
  if public.district_key_letters('غبيرا') <> public.district_key_letters('حي غبيرة') then raise exception 'PROOF: غبيرا ≠ غبيرة'; end if;
  if public.district_key_letters('الملقا') <> public.district_key_letters('حي الملقاه') then raise exception 'PROOF: الملقا ≠ الملقاه'; end if;
  if public.district_key_letters('ضاحية هجر(الحي الخامس)') <> public.district_key_letters('ضاحية هجر ،، الحي الخامس') then raise exception 'PROOF: punctuation copies differ'; end if;
  if public.district_edit_distance(public.district_key_letters('البغددية الشرقية'), public.district_key_letters('حي البغدادية الشرقية')) <> 1 then raise exception 'PROOF: one-letter distance broke'; end if;
  -- the folds still work through the rebuilt indexes
  if public.loc_display_district_ar(c_buq, 'حي الربوة - بقيق') <> 'حي الربوة' then raise exception 'PROOF: town-suffix copy not folded'; end if;
  if public.loc_display_district_ar(664, 'الملقا') <> 'حي الملقاه' then raise exception 'PROOF: last-letter copy not folded'; end if;
  if public.loc_display_district_ar(3, 'ملك عبد الله') <> 'حي الملك عبدالله' then raise exception 'PROOF: «ال»/spaces copy not folded'; end if;
  if public.loc_display_district_ar(1061, 'حي الواحة') <> 'الواحة' then raise exception 'PROOF: same-letters copy not folded'; end if;
  if public.loc_display_district_ar(3, 'المعيزيلة') <> 'المعيزيلة' then raise exception 'PROOF: one-letter name folded by itself'; end if;
  if public.loc_display_district_ar(6, 'السلامة') = 'حي السلام' or public.loc_display_district_ar(3, 'الزهراء') = 'حي الزهرة' then raise exception 'PROOF: two different districts were joined'; end if;
  -- the list itself has no two names in one city with the same letters
  select count(*) into n_old from public.loc_catalog_district a join public.loc_catalog_district b
    on b.city_id = a.city_id and b.district_id > a.district_id and public.district_key_letters(a.district_ar) = public.district_key_letters(b.district_ar);
  if n_old <> 0 then raise exception 'PROOF: % list pairs share the same letters under the new key', n_old; end if;
  -- the list guard still refuses the copies (rolled back)
  begin insert into public.loc_catalog_district (city_id, district_ar) values (664, 'الملقا'); raise exception 'PROOF: «الملقا» was accepted';
  exception when others then if sqlerrm not like 'district list guard: «الملقا» is the same district as%' then raise; end if; end;
  perform public.mon_detect_district_served_twins();
  raise notice 'PROOF OK: key v2 keeps real districts apart, joins true copies; indexes rebuilt; list has no same-letters pair; alarm split P1/P2';
end $proof$;
