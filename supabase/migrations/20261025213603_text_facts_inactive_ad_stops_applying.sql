-- TEXT FACTS: an ad that went INACTIVE stops applying too (found right after the switch went on, 2026-10-25).
--
-- 60 dealapp ads read active at 20:40 went inactive before 21:30. listing_rich_attrs reads active rows only, so
-- their 12 rich columns could never receive the merge, and mon_detect_text_facts would have called that a
-- «text fact not applied» (P1) for an ad nobody can be served. text_facts_mark_stale() now stamps those rows
-- too: the overlay drops them on the same pass, and text_facts_todo() lists them again (stale_at set) the
-- night the ad comes back, so a reactivated ad is re-read rather than served from an old reading.
-- Full replace of a function this work owns (20261025203351); its live md5 is checked in this step.
do $$
begin
  if md5(pg_get_functiondef('public.text_facts_mark_stale()'::regprocedure)) <> 'a7bb19afa9bd30691bb3055cb901e49f' then
    raise exception 'text_facts_mark_stale moved since 20261025203351; rebase this migration';
  end if;
end $$;

create or replace function public.text_facts_mark_stale()
returns bigint language plpgsql as $$
declare t text; n bigint := 0; k bigint;
begin
  for t in select distinct f.source_table from public.listing_text_facts f where f.stale_at is null loop
    continue when to_regclass('public.' || t) is null;
    execute format(
      'update public.listing_text_facts f set stale_at = now() from public.%I x
        where f.source_table = %L and f.listing_id = x.id and f.stale_at is null
          and (not x.active or %s is distinct from f.src_hash)', t, t, public.text_facts_hash_expr(t, 'x'));
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
  values ('text_facts_mark_stale', now(), n, format('rows newly stale this pass (text changed or ad inactive): %s', n))
  on conflict (object_name) do update
    set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  return n;
end $$;
revoke all on function public.text_facts_mark_stale() from public, anon, authenticated;
grant execute on function public.text_facts_mark_stale() to service_role;
