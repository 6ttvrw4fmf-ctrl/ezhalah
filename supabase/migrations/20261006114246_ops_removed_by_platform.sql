-- ♻️ Lifecycle Engineer, 2026-10-06. The owner (2026-10-05): «are we removing a good amount of dead
-- ads on ALL sites?» — the ~140 small sites had no single removal ledger, so nobody could answer how
-- many ads each site removed per day. One read-only function over what every listing table already
-- records (active = false with its own deactivated_at, set by trg_set_deactivated_at or the hide
-- patch itself): hides per platform in the last p_hours. The nightly report's line
-- «🗑️ Removed last 24 h» is read from it.
create or replace function public.ops_removed_by_platform(p_hours integer default 24)
returns table(platform text, removed bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  t record;
  n bigint;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
    where c.relkind = 'r'
      and c.relname ~ '_(residential|commercial)_listings$'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'deactivated_at' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'active' and not a.attisdropped)
  loop
    execute format('select count(*) from public.%I where active = false and deactivated_at >= now() - make_interval(hours => $1)', t.relname)
      into n using p_hours;
    if n > 0 then
      platform := regexp_replace(t.relname, '_(residential|commercial)_listings$', '');
      removed := n;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.ops_removed_by_platform(integer) from public, anon, authenticated;
