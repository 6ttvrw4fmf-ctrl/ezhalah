-- Adding car_entrance/optical_fibers to the view would have silently NOT synced, because both the
-- sync function and the barrier carried a hand-written list of 27 column names. That is the same
-- drift class this whole exercise has been closing: a mapping that exists but is not read.
--
-- Both now DERIVE their column list from the intersection of listing_rich_attrs and
-- search_listings_ar at run time. Add a column to the view and to the index table, and it is synced
-- and guarded with no further edit — which is the "new fields inherit the architecture
-- automatically" requirement applied to the plumbing itself, not just to listings.
create or replace function public._rich_attr_columns()
returns text[]
language sql stable
as $$
  select array_agg(r.column_name::text order by r.ordinal_position)
    from information_schema.columns r
    join information_schema.columns s
      on s.table_schema = 'public' and s.table_name = 'search_listings_ar'
     and s.column_name = r.column_name
   where r.table_schema = 'public' and r.table_name = 'listing_rich_attrs'
     and r.column_name not in ('source_table', 'listing_id');
$$;

comment on function public._rich_attr_columns() is
  'The canonical rich-attribute column set: every listing_rich_attrs column that also exists on '
  'search_listings_ar. Derived, never hand-listed, so a new column cannot be silently unsynced.';

create or replace function public.sync_listing_rich_attrs(p_source_table text)
returns bigint
language plpgsql
as $fn$
declare
  n bigint := 0; batch bigint; lo bigint := 0; k constant int := 25000;
  cols text[]; set_list text; diff_list text;
begin
  if p_source_table is null or p_source_table !~ '^[a-z0-9_]+_listings$' then
    raise exception 'p_source_table must be a bare <platform>_<kind>_listings identifier, got %', p_source_table;
  end if;

  cols := public._rich_attr_columns();
  if cols is null or array_length(cols, 1) < 20 then
    raise exception 'refusing to run: derived rich column set looks wrong (%)', cols;
  end if;
  select string_agg(format('%I = d.%I', c, c), ', '),
         string_agg(format('s.%I is distinct from r.%I', c, c), ' or ')
    into set_list, diff_list
    from unnest(cols) c;

  create temp table if not exists _rich_diff (like public.listing_rich_attrs) on commit drop;
  truncate _rich_diff;

  -- ONE scan; the literal source_table prunes the other UNION ALL branches.
  execute format($f$
    insert into _rich_diff
    select r.* from public.listing_rich_attrs r
    join public.search_listings_ar s
      on s.source_table = r.source_table and s.listing_id = r.listing_id
    where r.source_table = %L and (%s)
  $f$, p_source_table, diff_list);

  create index if not exists _rich_diff_id on _rich_diff (listing_id);

  -- <=25k rows per statement (2026-08-10 outage rule)
  loop
    execute format($f$
      update public.search_listings_ar s set %s
        from _rich_diff d
       where s.source_table = d.source_table and s.listing_id = d.listing_id
         and d.listing_id > %s and d.listing_id <= %s
    $f$, set_list, lo, lo + k);
    get diagnostics batch = row_count;
    n := n + batch;
    lo := lo + k;
    exit when lo > coalesce((select max(listing_id) from _rich_diff), 0);
  end loop;

  return n;
end
$fn$;

-- barrier check C rebuilt on the same derived list
create or replace function public.mon_rich_attrs_barrier()
returns integer
language plpgsql
as $fn$
declare total int := 0; v int; missing text; def text; cmd text; cols text[]; diff_list text;
begin
  -- A. the (source_table, listing_id) key must stay 1:1 — downstream DISTINCT ON would otherwise
  --    pick a branch arbitrarily instead of failing (see souq24 double-emit, migration 20260809154813)
  select count(*) into v from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1) q;
  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_duplicate_key', v,
            format('listing_rich_attrs emits %s duplicated (source_table, listing_id) keys.', v));
  end if;

  -- B. a cohort platform with no branch = captured data that can never reach search
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select string_agg(distinct s.source_table, ', ') into missing
    from public.search_listings_ar s
   where s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي' and s.type_ar = 'شقة'
     and s.production_ready and position(s.source_table in def) = 0;
  if missing is not null then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_platform_unmapped', 1,
            'Annual Rent -> Apartment platforms with NO listing_rich_attrs branch: ' || missing);
  end if;

  -- C. index must not drift from the view, over the DERIVED column set
  cols := public._rich_attr_columns();
  select string_agg(format('s.%I is distinct from r.%I', c, c), ' or ') into diff_list from unnest(cols) c;
  execute format($f$
    select count(*) from public.search_listings_ar s
     join public.listing_rich_attrs r
       on r.source_table = s.source_table and r.listing_id = s.listing_id
    where (%s)$f$, diff_list) into v;
  if v > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_index_drift', v,
            format('%s listings whose rich columns disagree with listing_rich_attrs.', v));
  end if;

  -- D. the plumbing itself must still be connected (removing a guard inverts its monitor)
  select command into cmd from cron.job where jobid = 28 and active;
  if cmd is null or (cmd not like '%sync_listing_rich_attrs%' and cmd not like '%sync_all_rich_attrs%') then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_sync_unwired', 1, 'cron jobid 28 no longer syncs rich attrs.');
  end if;
  if not exists (select 1 from cron.job where active
                  and command like '%sync_listing_rich_attrs%' and command like '%wasalt%') then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('rich_attrs_wasalt_sync_unwired', 1, 'no active cron job syncs wasalt rich attrs.');
  end if;

  return total;
end
$fn$;
