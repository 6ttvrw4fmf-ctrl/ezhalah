-- An ad licence we already SAVED reaches search for every site (owner 2026-11-10: «fetch everything»).
--
-- 107 arms of listing_extra_attrs / _v0 / _v1 read «NULL::text AS license_number» although the scraper had
-- already saved the site's REGA ad licence — in the table's own license_number column, in the card's extras
-- box (additional_info.rega_ad_license_number), or both. The card showed «رقم رخصة الإعلان»; the index did
-- not, so the «مرخص» filter, the welcome count's «same licence = one home» rule and the ad page's duplicate
-- match never saw these ads. Measured before this change: about 4,570 active ads across 25 tables
-- (muktamel 3,777 of them) plus about 205 aqargate ads whose extras box is a list, served with no licence.
--
-- The rule lives in ONE function, read by every arm that used to say NULL:
--   * only a REGA ad licence shape counts (10 digits starting 71 or 72). A broker's FAL licence, a
--     commercial register number, two licences glued together or a place name is not an ad licence and
--     stays empty (seen saved: 1100043722, 6200923742, «7200931943-7200931934», «عنيزة»).
--   * the column and the extras box must not disagree. If both hold a licence and they differ, the answer
--     is empty: we do not pick one.
--   * a list-shaped extras box (aqargate, wasalt) counts only when it states ONE licence.
-- No listing row is written here. The hourly refresh (:16) and the :22 sync re-derive the served rows.

create or replace function public.rega_ad_licence_saved(p_col text, p_info jsonb)
returns text
language sql
immutable
parallel safe
as $f$
  select case when a.col is not null and a.key is not null and a.col <> a.key then null
              else coalesce(a.col, a.key) end
    from (select
            substring(btrim(p_col) from '^7[12][0-9]{8}$') as col,
            case jsonb_typeof(p_info)
              when 'object' then substring(btrim(p_info ->> 'rega_ad_license_number') from '^7[12][0-9]{8}$')
              when 'array' then (
                select case when count(distinct q.v) = 1 then min(q.v) end
                  from (select substring(btrim(e ->> 'value') from '^7[12][0-9]{8}$') as v
                          from jsonb_array_elements(p_info) e
                         where jsonb_typeof(e) = 'object' and e ->> 'key' = 'rega_ad_license_number') q
                 where q.v is not null)
            end as key) a
$f$;

comment on function public.rega_ad_licence_saved(text, jsonb) is
  'The REGA ad licence a listing table already saved (its license_number column and/or additional_info.rega_ad_license_number). Only the 10-digit 71/72 shape; a disagreement between the two is NULL. Read by listing_extra_attrs arms.';

-- The rule, proven on the values really seen in the tables.
do $t$
begin
  if public.rega_ad_licence_saved('7200123456', null) is distinct from '7200123456'
     or public.rega_ad_licence_saved(' 7100000001 ', '{}'::jsonb) is distinct from '7100000001'
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": "7200123456"}') is distinct from '7200123456'
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": 7200123456}') is distinct from '7200123456'
     or public.rega_ad_licence_saved('7200123456', '{"rega_ad_license_number": "7200123456"}') is distinct from '7200123456'
     or public.rega_ad_licence_saved(null,
          '[{"key": "rega_ad_license_number", "label": "Ad license number", "value": "7200123456"}]') is distinct from '7200123456'
  then
    raise exception 'PROOF: a saved REGA ad licence was not read';
  end if;
  if public.rega_ad_licence_saved('1100043722', null) is not null
     or public.rega_ad_licence_saved('6200695758', '{"rega_ad_license_number": "6200923742"}') is not null
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": "1200012345"}') is not null
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": "7200931943-7200931934"}') is not null
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": "عنيزة"}') is not null
     or public.rega_ad_licence_saved(null, '{"rega_ad_license_number": "72001234567"}') is not null
     or public.rega_ad_licence_saved(null, '{"fal_licence": "7200017066"}') is not null
     or public.rega_ad_licence_saved(null, '[{"key": "price", "value": "7200123456"}]') is not null
     or public.rega_ad_licence_saved(null, '"7200123456"'::jsonb) is not null
     or public.rega_ad_licence_saved(null, null) is not null
  then
    raise exception 'PROOF: something that is not a REGA ad licence was read as one';
  end if;
  if public.rega_ad_licence_saved('7200123456', '{"rega_ad_license_number": "7200123457"}') is not null
     or public.rega_ad_licence_saved(null,
          '[{"key": "rega_ad_license_number", "value": "7200123456"}, {"key": "rega_ad_license_number", "value": "7200123457"}]') is not null
  then
    raise exception 'PROOF: two different licences on one ad were not left empty';
  end if;
end $t$;

-- Every arm that hard-codes NULL reads the saved licence instead. The arm names its own table and alias, so
-- nothing is listed by hand: an arm added tomorrow with the same NULL is caught by the barrier below.
do $m$
declare
  views constant text[] := array['listing_extra_attrs_v0', 'listing_extra_attrs_v1', 'listing_extra_attrs'];
  nul constant text := 'NULL::text AS license_number';
  vw text;
  arms text[];
  arm text;
  m text[];
  src text;
  col_expr text;
  i int;
  n int;
  total int := 0;
begin
  -- v0 first: v1 and listing_extra_attrs read through it. Column names and types do not change.
  foreach vw in array views loop
    arms := string_to_array(pg_get_viewdef(('public.' || vw)::regclass), 'UNION ALL');
    n := 0;
    for i in 1 .. array_length(arms, 1) loop
      arm := arms[i];
      continue when position(nul in arm) = 0;
      if (length(arm) - length(replace(arm, nul, ''))) / length(nul) <> 1 then
        raise exception '% arm %: the NULL licence appears more than once — refusing to guess', vw, i;
      end if;
      src := substring(arm from $r$'([a-z0-9_]+)'::text AS source_table$r$);
      m := regexp_match(arm, $r$FROM ([a-z0-9_]+) ([a-z0-9_]+)\s+WHERE $r$);
      if src is null or m is null or m[1] <> src then
        raise exception '% arm %: cannot read its table and alias (source_table %, from %) — refusing to guess', vw, i, src, m;
      end if;
      if not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = src
                        and ic.column_name = 'additional_info' and ic.data_type = 'jsonb') then
        raise exception '% arm %: % has no jsonb additional_info', vw, i, src;
      end if;
      col_expr := case when exists (select 1 from information_schema.columns ic
                                     where ic.table_schema = 'public' and ic.table_name = src
                                       and ic.column_name = 'license_number' and ic.data_type = 'text')
                       then m[2] || '.license_number' else 'NULL::text' end;
      arms[i] := replace(arm, nul,
        format('rega_ad_licence_saved(%s, %s.additional_info) AS license_number', col_expr, m[2]));
      n := n + 1;
    end loop;
    if n > 0 then
      execute format('create or replace view public.%I as %s', vw, array_to_string(arms, 'UNION ALL'));
    end if;
    raise notice '%: % arm(s) now read the saved licence', vw, n;
    total := total + n;
  end loop;
  raise notice 'saved licence reaches search: % arm(s) rewritten', total;
end $m$;

-- The barrier: af_view_dropped_answers() already names an arm that reads NULL for an Advanced Filter answer
-- its table stores (mon_detect_af_view_drops_stored_answer, on the roster, P1). It watched the eight yes/no
-- amenities only, which is why the licence sat unseen. It now also names an arm that reads NULL for the
-- licence while its table holds one.
create or replace function public.af_view_dropped_answers()
returns table(view_name text, source_table text, col text, stored_answers bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare r record; n bigint;
begin
  for r in
    select a.vname, a.t, m[1] as c
      from (select c.relname::text as vname, substring(p from $r$'([a-z_0-9]+)'::text AS source_table$r$) as t, p
              from pg_class c join pg_namespace ns on ns.oid = c.relnamespace,
                   regexp_split_to_table(pg_get_viewdef(c.oid), 'UNION ALL') p
             where ns.nspname = 'public' and c.relkind = 'v' and c.relname like 'listing\_extra\_attrs%') a,
           regexp_matches(a.p, 'NULL::boolean AS (furnished|elevator|parking|kitchen|air_conditioner|maid_room|driver_room|private_entrance)', 'g') m
     where a.t is not null
       and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
                    and ic.table_name = a.t and ic.column_name = m[1])
       and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
                    and ic.table_name = a.t and ic.column_name = 'active')
  loop
    execute format('select count(*) from public.%I where active and %I is not null', r.t, r.c) into n;
    if n > 0 then
      view_name := r.vname; source_table := r.t; col := r.c; stored_answers := n;
      return next;
    end if;
  end loop;

  -- the licence: saved in the column and/or the extras box, read by the same rule the arms use.
  for r in
    select a.vname, a.t,
           exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
                    and ic.table_name = a.t and ic.column_name = 'license_number' and ic.data_type = 'text') as has_col
      from (select c.relname::text as vname, substring(p from $r$'([a-z_0-9]+)'::text AS source_table$r$) as t, p
              from pg_class c join pg_namespace ns on ns.oid = c.relnamespace,
                   regexp_split_to_table(pg_get_viewdef(c.oid), 'UNION ALL') p
             where ns.nspname = 'public' and c.relkind = 'v' and c.relname like 'listing\_extra\_attrs%') a
     where a.t is not null
       and position('NULL::text AS license_number' in a.p) > 0
       and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
                    and ic.table_name = a.t and ic.column_name = 'additional_info' and ic.data_type = 'jsonb')
       and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
                    and ic.table_name = a.t and ic.column_name = 'active')
  loop
    execute format('select count(*) from public.%I x where x.active and public.rega_ad_licence_saved(%s, x.additional_info) is not null',
                   r.t, case when r.has_col then 'x.license_number' else 'NULL::text' end) into n;
    if n > 0 then
      view_name := r.vname; source_table := r.t; col := 'license_number'; stored_answers := n;
      return next;
    end if;
  end loop;
end $function$;

revoke all on function public.af_view_dropped_answers() from public, anon, authenticated;

-- PROOF at apply: no arm still hard-codes NULL for the licence, the barrier names none, and a site whose
-- licence was saved all along (muktamel) now carries it through the view.
do $c$
declare vw text; left_over int := 0; v_named int; v_seen int;
begin
  foreach vw in array array['listing_extra_attrs_v0', 'listing_extra_attrs_v1', 'listing_extra_attrs'] loop
    left_over := left_over + (select count(*) from regexp_split_to_table(pg_get_viewdef(('public.' || vw)::regclass), 'UNION ALL') p
                               where position('NULL::text AS license_number' in p) > 0);
  end loop;
  if left_over > 0 then
    raise exception 'PROOF: % arm(s) still hard-code a NULL licence', left_over;
  end if;
  select count(*) into v_named from public.af_view_dropped_answers() where col = 'license_number';
  if v_named > 0 then
    raise exception 'PROOF: the barrier still names % arm(s) dropping a saved licence', v_named;
  end if;
  select count(*) into v_seen from public.listing_extra_attrs
   where source_table = 'muktamel_residential_listings' and license_number is not null;
  if v_seen = 0 then
    raise exception 'PROOF: muktamel''s saved licences do not come through listing_extra_attrs';
  end if;
  raise notice 'PROOF: no NULL-licence arm is left, the barrier names none, muktamel carries % licence(s) through the view', v_seen;
end $c$;
