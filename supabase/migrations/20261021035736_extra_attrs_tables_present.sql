-- SECURITY PHASE 1.3 follow-up (2026-10-21): the live check keeps working with listing_extra_attrs_mv closed.
--
-- 20261021003001 closed listing_extra_attrs_mv to the publishable key (internal view, bypasses RLS). One live check,
-- scripts/verify-all-platforms-have-extra-attrs-branch-live.ts (loader-active-platforms-check.yml), read it with that
-- key to ask "does table X have any row in it?" and started answering 401. This function answers exactly that
-- question and nothing else: given table names, it returns the ones that have at least one row. No listing data.
-- Each probe is one index lookup on listing_extra_attrs_mv_key (source_table, listing_id); input capped at 300 names.
-- Rollback: drop function public.extra_attrs_tables_present(text[]); delete the allowlist row.
create or replace function public.extra_attrs_tables_present(p_tables text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $fn$
  select t
  from unnest(p_tables[1:300]) as t
  where exists (select 1 from public.listing_extra_attrs_mv m where m.source_table = t);
$fn$;
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('extra_attrs_tables_present', '{anon,authenticated}', 'live check: scripts/verify-all-platforms-have-extra-attrs-branch-live.ts asks which searchable tables have ≥1 row in listing_extra_attrs_mv (view closed to the public key by 20261021003001). Returns table names only; read-only STABLE; ≤ 300 index probes.')
on conflict do nothing;
grant execute on function public.extra_attrs_tables_present(text[]) to anon, authenticated;
