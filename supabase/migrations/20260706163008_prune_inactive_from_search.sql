-- P1-3: live-active prune. Removes any search_listings_ar row whose underlying raw listing is
-- inactive OR gone, regardless of MV staleness → guarantees "search = active-only".
-- Per-source, guarded (table+columns must exist) and each table wrapped in its own exception block
-- so a single odd table can NEVER break the run. Returns rows pruned.
create or replace function public.prune_inactive_from_search()
returns bigint
language plpgsql
as $$
declare r_src text; v_pruned bigint; v_total bigint := 0;
begin
  for r_src in select distinct source_table from search_listings_ar loop
    if to_regclass('public.'||r_src) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=r_src and column_name='active')
       and exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=r_src and column_name='id') then
      begin
        execute format(
          'delete from search_listings_ar s where s.source_table=%L '
          'and not exists (select 1 from public.%I x where x.id = s.listing_id and x.active)',
          r_src, r_src);
        get diagnostics v_pruned = row_count;
        v_total := v_total + v_pruned;
      exception when others then
        raise notice 'prune skipped % : %', r_src, sqlerrm;
      end;
    end if;
  end loop;
  return v_total;
end $$;