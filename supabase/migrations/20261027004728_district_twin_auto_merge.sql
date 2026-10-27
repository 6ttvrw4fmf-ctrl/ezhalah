-- NEAR-TWIN DISTRICT NAMES MERGE BY THEMSELVES WHEN THE HOMES SIT IN THE SAME PLACE (owner 2026-10-26: «if it's less
-- than 3 km then it's the same … Apple Maps is always the right name … our district list is one name; the card shows
-- what they wrote»).
--
-- THE RULE. Two SERVED district names in one city, one letter apart (the pair the near-twins alarm already lists: 3+
-- ads each, key-letters edit distance 1), are ONE district when
--   • the homes under each name sit less than 3 km apart (centroid of served pins, 3+ pins on each side), and
--   • the names differ only by spelling — NOT by a number, an ordinal (الأول … العاشر) or a sector letter at the end
--     (حي شرق المطار أ / ب / د, مخطط ا / ب, الأمير مشعل أ / ب): those are different districts however close they sit.
-- The list keeps ONE name — the side already on our list (Apple Maps / owner-approved) — and the other spelling becomes
-- an alias (loc_district_alias), which the fold joins at the next sync. A pair where BOTH or NEITHER side is listed is
-- not decided here: both-listed means two list entries the owner approved (he decides), neither-listed means the real
-- name must first be added through the list guards (the district_copies_unlisted alarm, New Listings Engineer). The
-- card still prints what the site wrote; search, the district chip and the count use the one list name.
--
-- Measured before the first run (2026-10-26 23:5x UTC): 23 near-twin pairs served; 0 qualify today — 3 are far
-- (المنصورة/المنصورية 8.8 km, الامير سلطان/سلمان 27 km, الصناعة/صناعية 11 km), 3 differ by a number (الضاحية الرابع/السابع,
-- ضاحية هجر الحي الرابع/السابع), 5 are sector letters (نجران شرق المطار أ/ب/د, شرورة مخطط ا/ب, الأمير مشعل أ/ب), 7 have
-- no pins on a side, and the rest have neither side on the list yet. The rule is for the pairs that appear from now on.
--
-- SAFETY. Flag ops_feature_flags.district_twin_auto_merge (off = the nightly job does nothing). Every merge is logged in
-- ops_district_twin_merges. mon_detect_district_twin_auto_merge_suspect() (P1, rostered) re-measures every auto alias
-- twice an hour: a pair now 3 km+ apart, or whose names differ by a number/sector, is raised with the alias to drop.

insert into public.ops_feature_flags (name, enabled, reason)
values ('district_twin_auto_merge', true,
        'owner 2026-10-26: near-twin district names (one letter apart) whose homes sit < 3 km apart and differ only by spelling are one district; the unlisted spelling becomes an alias of the listed name. Off = the nightly job merges nothing; existing aliases stay unless dropped by hand.')
on conflict (name) do nothing;

create table if not exists public.ops_district_twin_merges (
  id         bigserial primary key,
  merged_at  timestamptz not null default now(),
  city_id    int not null,
  from_ar    text not null,
  to_ar      text not null,
  from_norm  text not null,
  to_norm    text not null,
  dist_m     int not null,
  from_pins  int not null,
  to_pins    int not null,
  from_ads   int not null,
  to_ads     int not null
);
alter table public.ops_district_twin_merges enable row level security;
revoke all on table public.ops_district_twin_merges from public, anon, authenticated;
comment on table public.ops_district_twin_merges is 'Every alias district_twin_auto_merge() wrote (owner rule 2026-10-26: < 3 km + spelling-only = one district). Undo one: delete the loc_district_alias row (city_id, from_norm); the next sync splits them again.';

-- A number, an ordinal or a trailing sector letter makes two names two districts whatever the distance.
create or replace function public.district_name_counts_differ(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
  with t as (
    select coalesce((select array_agg(m[1] order by m[1]) from regexp_matches(public.norm_district_tok(p_a), '(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[0-9]+|(?:^|\s)[أاإبجدهوز](?:\s|$)|(?:^|\s)[A-Za-z](?:\s|$))', 'g') m), '{}'::text[]) a,
           coalesce((select array_agg(m[1] order by m[1]) from regexp_matches(public.norm_district_tok(p_b), '(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[0-9]+|(?:^|\s)[أاإبجدهوز](?:\s|$)|(?:^|\s)[A-Za-z](?:\s|$))', 'g') m), '{}'::text[]) b)
  select (select array_agg(btrim(x) order by btrim(x)) from unnest(a) x) is distinct from (select array_agg(btrim(x) order by btrim(x)) from unnest(b) x) from t
$$;

-- ONE pair query, shared by the merge and its watchdog: the near-twins alarm's pair, plus pins, distance and the name guard.
create or replace function public.district_twin_pairs()
returns table (city_id int, a_ar text, a_ads bigint, a_listed boolean, a_pins bigint, b_ar text, b_ads bigint, b_listed boolean, b_pins bigint, dist_m numeric, counts_differ boolean)
language sql
stable
set search_path = public
as $$
  with names as (
    select s.city_id, s.district_ar, public.district_key_letters(s.district_ar) k1, public.loc_display_district_ar(s.city_id, s.district_ar) shown, count(*) n,
           exists (select 1 from public.loc_catalog_district c where c.city_id = s.city_id and c.district_norm = public.norm_district_tok(s.district_ar) and c.retired_at is null) listed,
           avg(s.latitude) filter (where s.latitude is not null and s.longitude is not null) lat,
           avg(s.longitude) filter (where s.latitude is not null and s.longitude is not null) lng,
           count(*) filter (where s.latitude is not null and s.longitude is not null) pins
      from public.search_listings_ar s
     where s.production_ready and s.city_id is not null and s.district_ar is not null and btrim(s.district_ar) <> ''
     group by 1, 2)
  select a.city_id, a.district_ar, a.n, a.listed, a.pins, b.district_ar, b.n, b.listed, b.pins,
         case when a.lat is null or b.lat is null then null
              else round((6371000 * acos(least(1, cos(radians(a.lat)) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(a.lng)) + sin(radians(a.lat)) * sin(radians(b.lat)))))::numeric) end,
         public.district_name_counts_differ(a.district_ar, b.district_ar)
    from names a join names b
      on b.city_id = a.city_id and b.district_ar > a.district_ar
     and a.n >= 3 and b.n >= 3 and length(a.k1) >= 5 and length(b.k1) >= 5 and abs(length(a.k1) - length(b.k1)) <= 1
     and a.k1 <> b.k1 and similarity(a.k1, b.k1) > 0.5 and public.district_edit_distance(a.k1, b.k1) = 1
     and public.norm_district_tok(a.shown) <> public.norm_district_tok(b.shown)
$$;
revoke all on function public.district_twin_pairs() from public, anon, authenticated;

create or replace function public.district_twin_auto_merge()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare p record; n int := 0; v_from text; v_to text; v_from_n int; v_to_n int; v_from_p int; v_to_p int;
begin
  if not exists (select 1 from public.ops_feature_flags k where k.name = 'district_twin_auto_merge' and k.enabled) then return 0; end if;
  for p in select * from public.district_twin_pairs()
            where not counts_differ and dist_m is not null and dist_m < 3000 and a_pins >= 3 and b_pins >= 3 and (a_listed <> b_listed) loop
    if p.a_listed then v_to := p.a_ar; v_from := p.b_ar; v_to_n := p.a_ads; v_from_n := p.b_ads; v_to_p := p.a_pins; v_from_p := p.b_pins;
    else v_to := p.b_ar; v_from := p.a_ar; v_to_n := p.b_ads; v_from_n := p.a_ads; v_to_p := p.b_pins; v_from_p := p.a_pins; end if;
    if public.norm_district_tok(v_from) = public.norm_district_tok(v_to) then continue; end if;
    if exists (select 1 from public.loc_district_alias x where x.city_id = p.city_id and x.from_norm = public.norm_district_tok(v_from)) then continue; end if;
    insert into public.loc_district_alias (city_id, from_norm, to_norm, why, decided_by)
    values (p.city_id, public.norm_district_tok(v_from), public.norm_district_tok(v_to),
            format('auto twin rule (owner 2026-10-26): homes %s m apart (%s vs %s pins), names differ only by spelling; «%s» → «%s»', p.dist_m, v_from_p, v_to_p, v_from, v_to),
            'auto-twin-rule');
    insert into public.ops_district_twin_merges (city_id, from_ar, to_ar, from_norm, to_norm, dist_m, from_pins, to_pins, from_ads, to_ads)
    values (p.city_id, v_from, v_to, public.norm_district_tok(v_from), public.norm_district_tok(v_to), p.dist_m, v_from_p, v_to_p, v_from_n, v_to_n);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.district_twin_auto_merge() from public, anon, authenticated;

-- The watchdog: every auto alias is re-measured; one that no longer fits the rule is a P1 naming the alias to drop.
create or replace function public.mon_detect_district_twin_auto_merge_suspect()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare n int := 0; v_bad int; v_ex jsonb;
begin
  with pins as (
    select s.city_id, public.norm_district_tok(s.district_ar) nrm, avg(s.latitude) lat, avg(s.longitude) lng, count(*) k
      from public.search_listings_ar s where s.production_ready and s.latitude is not null and s.longitude is not null and s.district_ar is not null group by 1, 2),
  suspects as (
    select m.city_id, m.from_ar, m.to_ar,
           case when pa.lat is null or pb.lat is null then null
                else round((6371000 * acos(least(1, cos(radians(pa.lat)) * cos(radians(pb.lat)) * cos(radians(pb.lng) - radians(pa.lng)) + sin(radians(pa.lat)) * sin(radians(pb.lat)))))::numeric) end dist_now,
           public.district_name_counts_differ(m.from_ar, m.to_ar) counts_differ
      from public.ops_district_twin_merges m
      join public.loc_district_alias x on x.city_id = m.city_id and x.from_norm = m.from_norm and x.decided_by = 'auto-twin-rule'
      left join pins pa on pa.city_id = m.city_id and pa.nrm = m.from_norm
      left join pins pb on pb.city_id = m.city_id and pb.nrm = m.to_norm)
  select count(*), jsonb_agg(to_jsonb(s)) into v_bad, v_ex from (select * from suspects where counts_differ or dist_now >= 3000 limit 10) s;
  if v_bad > 0 then
    n := n + public.mon_raise('P1', 'district_twin_auto_merge_suspect', 'location', 'district_twin_auto_merge_suspect',
      jsonb_build_object('aliases', v_bad, 'examples', v_ex,
        'why', 'An alias written by district_twin_auto_merge() no longer fits the owner rule (homes < 3 km apart, names differ only by spelling): the two names now sit 3 km+ apart or differ by a number/sector letter — two districts shown as one.',
        'action', 'delete from loc_district_alias where (city_id, from_norm) = the example; the next sync splits them. Then find why the rule admitted it (pins moved? guard regex?) and fix the rule, never the alias alone.'));
  else
    perform public.mon_resolve_key('district_twin_auto_merge_suspect', 'district_twin_auto_merge_suspect');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_district_twin_auto_merge_suspect() from public, anon, authenticated;

-- Roster: insert the new name right before an existing anchor in the live mon_run_all_detectors text, then execute it.
do $roster$
declare d text; anchor text := '''mon_detect_district_served_twins'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_district_twin_auto_merge_suspect''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_district_twin_auto_merge_suspect'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_district_twin_auto_merge_suspect''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- Nightly, before the morning syncs; an existing job of the same name is replaced.
select cron.unschedule(jobid) from cron.job where jobname = 'district-twin-auto-merge';
select cron.schedule('district-twin-auto-merge', '5 3 * * *', $$select public.district_twin_auto_merge();$$);

-- PROOF at apply: the name guard, the pair query on the live index, the rule's first run, the watchdog.
do $proof$
declare r int; v_pairs int;
begin
  if not public.district_name_counts_differ('الضاحية الرابع', 'الضاحية السابع') then raise exception 'PROOF: ordinals must differ'; end if;
  if not public.district_name_counts_differ('حي شرق المطار أ', 'حي شرق المطار ب') then raise exception 'PROOF: sector letters must differ'; end if;
  if not public.district_name_counts_differ('مخطط ا', 'مخطط ب') then raise exception 'PROOF: sector letters (ا/ب) must differ'; end if;
  if public.district_name_counts_differ('جنوب منسوب التعليم', 'حي جنوب منسوبي التعليم') then raise exception 'PROOF: a spelling-only pair must NOT differ'; end if;
  if public.district_name_counts_differ('البغددية الشرقية', 'حي البغدادية الشرقية') then raise exception 'PROOF: a typo pair must NOT differ'; end if;
  if public.district_name_counts_differ('حي السكة الحديدية', 'حي سكة الحديد') then raise exception 'PROOF: الحديدية/الحديد is spelling'; end if;
  select count(*) into v_pairs from public.district_twin_pairs();
  if v_pairs < 1 then raise exception 'PROOF: the pair query found nothing on the live index (the alarm lists 20+)'; end if;
  if exists (select 1 from public.district_twin_pairs() where a_ar = 'الضاحية الرابع' and b_ar = 'الضاحية السابع' and not counts_differ) then raise exception 'PROOF: الرابع/السابع must be flagged'; end if;
  if exists (select 1 from public.district_twin_pairs() where a_ar = 'حي المنصورة' and b_ar = 'حي المنصورية' and dist_m < 3000) then raise exception 'PROOF: المنصورة/المنصورية must measure far'; end if;
  r := public.district_twin_auto_merge();
  raise notice 'district_twin_auto_merge: % alias(es) written on the first run', r;
  r := public.mon_detect_district_twin_auto_merge_suspect();
  if r <> 0 then raise exception 'PROOF: the watchdog raised on the first run (%)', r; end if;
end $proof$;
