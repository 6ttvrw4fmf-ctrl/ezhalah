-- 🔬 AF engineer 2026-10-23 (backlog 763): fursaghyr gets a «furnished» column, and search reads it.
--
-- fursaghyr's tables had no furnished column and listing_extra_attrs_v0 hard-codes «NULL::boolean AS furnished» for
-- both fursaghyr arms, so a customer who asks the Advanced Filter for «مفروش» could never find a fursaghyr ad even
-- when the ad says so. Measured 2026-10-23: the ad behind fursaghyr_residential_listings:3237533 (FG27238, a Makkah
-- apartment for sale) says «الشقه مؤثثه بالكامل» in its own description, and ops_af_score has missed it on
-- 10-20, 10-22 and 10-23. The site's «المميزات» checklist has no furnished term, so the description is its only
-- statement and the shared prose reader decides it (scrapers/fursaghyr/run.py FEATURE_COLS, same PR).
-- Nullable, no default: every row stays unknown until its own ad is read. No listing row is written here.
-- Same arm shape as 20261019092426.

alter table public.fursaghyr_residential_listings add column if not exists furnished boolean;
alter table public.fursaghyr_commercial_listings add column if not exists furnished boolean;

do $m$
declare
  tbls constant text[] := array['fursaghyr_residential_listings', 'fursaghyr_commercial_listings'];
  v text;
  o text;
  t text;
  hits int;
begin
  v := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  foreach t in array tbls loop
    o := format($q$SELECT %L::text AS source_table,
    x.id AS listing_id,
    NULL::boolean AS furnished,$q$, t);
    hits := (length(v) - length(replace(v, o, ''))) / length(o);
    if hits <> 1 then raise exception '% arm in listing_extra_attrs_v0 matched % times (want 1)', t, hits; end if;
    v := replace(v, o, format($q$SELECT %L::text AS source_table,
    x.id AS listing_id,
    x.furnished AS furnished,$q$, t));
  end loop;
  execute format('create or replace view public.listing_extra_attrs_v0 as %s', v);
end $m$;

-- The class check of 20261019092426, re-run: no arm reads NULL for furnished from a table that has the column.
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
