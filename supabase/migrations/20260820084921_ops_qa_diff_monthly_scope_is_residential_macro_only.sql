-- HARVESTED from real production requests 2026-08-20 (not assumed): the client adds the two monthly-only
-- sources (gathern, aqarmonthly) to the PRIMARY table scope only when the cohort's macro is Residential —
-- شقة res→resm (31→33), استراحة/أرض سكنية s1→s1m (62→64) — and NEVER to a Commercial cohort
-- (مكتب stays 32, محل stays 31) nor to the secondary scope (p_tables2 is unchanged in every case).
-- The previous revision widened scope2 as well, which would have made the oracle disagree with the client
-- on every monthly residential search. 'comm' is therefore unused and dropped.
create or replace function public.ops_qa_diff(
  p_ui_type    text,
  p_deal       text     default null,
  p_period     text     default null,
  p_cities     text[]   default null,
  p_districts  text[]   default null,
  p_region_ids int[]    default null,
  p_amin       int      default null,
  p_amax       int      default null,
  p_beds       int[]    default null,
  p_bmin       int      default null,
  p_pmin       numeric  default null,
  p_pmax       numeric  default null
) returns table(n bigint, h text)
language sql stable as $$
  select d.n, d.h
  from public.ops_qa_cohort c
  cross join lateral public.ops_qa_search_differential(
    public.ops_qa_scope_tables(
      case when c.macro = 'Residential' and p_deal = 'إيجار' and p_period in ('شهري','كلاهما')
           then c.scope||'m' else c.scope end),
    c.types_ar,
    case when c.scope2 is null then null else public.ops_qa_scope_tables(c.scope2) end,
    case when c.scope2 is null then null else c.types_ar end,
    p_deal, p_period, c.macro, p_cities, p_districts, p_region_ids,
    p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d
  where c.ui_type = p_ui_type
$$;
delete from public.ops_qa_scope where scope in ('comm','s2m');
