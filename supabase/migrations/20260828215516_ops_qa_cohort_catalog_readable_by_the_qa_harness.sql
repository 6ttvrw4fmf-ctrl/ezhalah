-- The daily RPC coverage layer must build its requests from the HARVESTED cohort/scope truth
-- (§1: no hardcoded control list; §41.6: never guess the client's table scope). ops_qa_cohort and
-- ops_qa_scope are RLS-blocked for anon, and the QA harness holds only the client-public key, so it
-- could not read them and had to re-derive the mapping by hand every run — which is exactly how
-- traps §41.6 / §41.14 / §41.17 produced false "product defects" on previous runs.
--
-- This is a PURE PROJECTION of those two tables. It deliberately contains NO serialization logic:
-- deciding when the monthly-only sources attach, and how p_types2 excludes «عمارة», stays in the
-- repo next to src/data/remote.ts's rules where it can be unit-tested and mutation-proven. A second
-- implementation of that logic living in the database is the divergence §41.14 warns about.
create or replace function public.ops_qa_cohort_catalog()
returns table (
  ui_type text, ui_category text, macro text,
  scope text, scope2 text, types_ar text[],
  scope_tables text[],            -- the client's p_tables for this cohort (annual / buy)
  scope_monthly_tables text[],    -- the same scope plus the two monthly-only sources, when harvested
  scope2_tables text[]            -- the overlay's p_tables2 candidate pool
)
language sql
stable
security definer
set search_path = public
as $$
  select c.ui_type, c.ui_category, c.macro,
         c.scope, c.scope2, c.types_ar,
         s.tables, sm.tables, s2.tables
  from public.ops_qa_cohort c
  join public.ops_qa_scope s        on s.scope  = c.scope
  left join public.ops_qa_scope sm  on sm.scope = c.scope || 'm'
  left join public.ops_qa_scope s2  on s2.scope = c.scope2
$$;

comment on function public.ops_qa_cohort_catalog() is
  'Read-only projection of ops_qa_cohort x ops_qa_scope for the QA coverage harness (anon-safe). '
  'Harvested facts only — request serialization lives in e2e/qa-coverage/request.mjs.';

grant execute on function public.ops_qa_cohort_catalog() to anon, authenticated;
