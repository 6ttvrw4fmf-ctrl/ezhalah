-- The Advanced Filter's «furnished» answer reaches search for every table that stores one (🔬 AF engineer,
-- 2026-10-19). 36 arms of listing_extra_attrs / _v0 / _v1 read «NULL::boolean AS furnished» although their
-- table HAS a furnished column, so the :22 sync re-derived every served row to NULL and a customer who asked
-- «مفروش» never found them. Measured: akariyoun 32 true (12049389, a furnished Riyadh flat, missed in the
-- 10-19 08:00 ops_af_score), therc 55 true (the reviewed 10-08 prose backfill, 20261008100625, whose served
-- rows the sync then reverted), remal 4 true. The other 31 columns are empty today, so their arms change
-- nothing now and stop the next writer from vanishing. Same shape as 20261018093318 (eastabha).
-- No listing row is written here: the next :22 sync re-derives the served rows from the view.
do $m$
declare
  arms constant text[][] := array[
    ['listing_extra_attrs', 'akariyoun_commercial_listings'], ['listing_extra_attrs', 'akariyoun_residential_listings'],
    ['listing_extra_attrs', 'aqaralsaudia_commercial_listings'], ['listing_extra_attrs', 'aqaralsaudia_residential_listings'],
    ['listing_extra_attrs', 'rakez_commercial_listings'], ['listing_extra_attrs', 'rakez_residential_listings'],
    ['listing_extra_attrs', 'suwar_commercial_listings'], ['listing_extra_attrs', 'suwar_residential_listings'],
    ['listing_extra_attrs_v0', 'abralosol_commercial_listings'], ['listing_extra_attrs_v0', 'abralosol_residential_listings'],
    ['listing_extra_attrs_v0', 'abwbna_commercial_listings'], ['listing_extra_attrs_v0', 'abwbna_residential_listings'],
    ['listing_extra_attrs_v0', 'alobid_commercial_listings'], ['listing_extra_attrs_v0', 'alobid_residential_listings'],
    ['listing_extra_attrs_v0', 'alta_commercial_listings'], ['listing_extra_attrs_v0', 'alta_residential_listings'],
    ['listing_extra_attrs_v0', 'amaall_commercial_listings'], ['listing_extra_attrs_v0', 'amaall_residential_listings'],
    ['listing_extra_attrs_v0', 'aouj_commercial_listings'], ['listing_extra_attrs_v0', 'aouj_residential_listings'],
    ['listing_extra_attrs_v0', 'arkaan_commercial_listings'], ['listing_extra_attrs_v0', 'arkaan_residential_listings'],
    ['listing_extra_attrs_v0', 'azdad_commercial_listings'], ['listing_extra_attrs_v0', 'azdad_residential_listings'],
    ['listing_extra_attrs_v0', 'bahadhabab_commercial_listings'], ['listing_extra_attrs_v0', 'bahadhabab_residential_listings'],
    ['listing_extra_attrs_v0', 'rawasidark_commercial_listings'], ['listing_extra_attrs_v0', 'rawasidark_residential_listings'],
    ['listing_extra_attrs_v0', 'remal_commercial_listings'], ['listing_extra_attrs_v0', 'remal_residential_listings'],
    ['listing_extra_attrs_v0', 'shmoualshmal_commercial_listings'], ['listing_extra_attrs_v0', 'shmoualshmal_residential_listings'],
    ['listing_extra_attrs_v0', 'therc_commercial_listings'], ['listing_extra_attrs_v0', 'therc_residential_listings'],
    ['listing_extra_attrs_v1', 'amlakalahsa_commercial_listings'], ['listing_extra_attrs_v1', 'amlakalahsa_residential_listings']];
  views constant text[] := array['listing_extra_attrs_v0', 'listing_extra_attrs_v1', 'listing_extra_attrs'];
  vw text;
  v text;
  o text;
  hits int;
  i int;
begin
  -- v0 first: v1 and listing_extra_attrs read through it, and a replace keeps every column, so order is safe.
  foreach vw in array views loop
    v := pg_get_viewdef(('public.' || vw)::regclass);
    for i in 1 .. array_length(arms, 1) loop
      continue when arms[i][1] <> vw;
      if not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                      and c.table_name = arms[i][2] and c.column_name = 'furnished') then
        raise exception '% has no furnished column', arms[i][2];
      end if;
      o := format($q$SELECT %L::text AS source_table,
    x.id AS listing_id,
    NULL::boolean AS furnished,$q$, arms[i][2]);
      hits := (length(v) - length(replace(v, o, ''))) / length(o);
      if hits <> 1 then raise exception '% arm in % matched % times (want 1)', arms[i][2], vw, hits; end if;
      v := replace(v, o, format($q$SELECT %L::text AS source_table,
    x.id AS listing_id,
    x.furnished AS furnished,$q$, arms[i][2]));
    end loop;
    execute format('create or replace view public.%I as %s', vw, v);
  end loop;
end $m$;

-- The class, not the instance: no arm of these three views may read NULL for furnished from a table that has
-- the column. Checked over the live definitions after the replace.
do $c$
declare
  bad text;
begin
  select string_agg(t, ', ') into bad
  from (select substring(p from $r$'([a-z_0-9]+)'::text AS source_table$r$) t, p
          from pg_class c join pg_namespace n on n.oid = c.relnamespace,
               regexp_split_to_table(pg_get_viewdef(c.oid), 'UNION ALL') p
         where n.nspname = 'public' and c.relkind = 'v'
           and c.relname in ('listing_extra_attrs', 'listing_extra_attrs_v0', 'listing_extra_attrs_v1')) a
  where t is not null and p ~ 'NULL::boolean AS furnished'
    and exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                 and c.table_name = a.t and c.column_name = 'furnished');
  if bad is not null then raise exception 'furnished still read as NULL from: %', bad; end if;
end $c$;

-- The barrier. An arm that hard-codes NULL for an Advanced Filter yes/no answer its table really stores is a
-- customer who asks for it and never finds the listing. Raised only on a real loss (the table holds at least
-- one active answer the view throws away), so an empty column waiting for its first writer stays quiet.
create or replace function public.af_view_dropped_answers()
returns table (view_name text, source_table text, col text, stored_answers bigint)
language plpgsql stable security definer set search_path to 'public'
as $f$
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
end $f$;
revoke all on function public.af_view_dropped_answers() from public, anon, authenticated;

create or replace function public.mon_detect_af_view_drops_stored_answer()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows jsonb; r int := 0;
begin
  select jsonb_agg(to_jsonb(x) order by x.stored_answers desc) into v_rows from public.af_view_dropped_answers() x;
  if v_rows is null then
    if exists (select 1 from public.alert_event where dedup_key = 'af_view_drops_stored_answer' and resolved_at is null) then
      perform public.mon_resolve('af_view_drops_stored_answer', 'af_capture');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'af_view_drops_stored_answer' and resolved_at is null) then
    r := r + public.mon_raise('P1', 'af_view_drops_stored_answer', 'af_capture', 'af_view_drops_stored_answer',
      jsonb_build_object('arms', v_rows, 'for', '🔬',
        'why', 'A listing_extra_attrs arm reads NULL for an Advanced Filter answer its table stores, so the :22 sync serves NULL and a customer asking for it never finds the listing. Point the arm at x.<column> (20261019 furnished fix is the worked example).'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_af_view_drops_stored_answer() from public, anon, authenticated;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_af_view_drops_stored_answer''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_af_view_drops_stored_answer'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_af_view_drops_stored_answer''' in d) = 0 then raise exception 'roster edit did not land'; end if;
  if exists (select 1 from public.af_view_dropped_answers()) then
    raise exception 'an Advanced Filter answer is still dropped by a view arm';
  end if;
end
$roster$;