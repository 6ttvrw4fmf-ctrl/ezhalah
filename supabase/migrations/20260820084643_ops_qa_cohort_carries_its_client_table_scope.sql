-- Each UI نوع maps to a FIXED pair of client table scopes (scope, scope2), harvested with the cohort
-- itself, plus the monthly variant the client swaps in when the period scope includes شهري. Storing it
-- next to the cohort means the differential oracle resolves the scope the same way the client does,
-- from harvested truth, instead of the caller re-asserting it at every call site.
alter table public.ops_qa_cohort add column if not exists scope  text;
alter table public.ops_qa_cohort add column if not exists scope2 text;

update public.ops_qa_cohort set scope='res',  scope2='com'  where ui_type in ('شقة','دور','غرفة','عمارة سكنية','فيلا','شاليه','مخيم');
update public.ops_qa_cohort set scope='s1',   scope2=null   where ui_type in ('استوديو','دوبلكس','استراحة','مزرعة','أرض زراعية','أرض سكنية','مستودع','أرض تجارية');
update public.ops_qa_cohort set scope='s2',   scope2=null   where ui_type in ('مكتب');
update public.ops_qa_cohort set scope='com',  scope2=null   where scope is null;

-- Monthly-aware, scope-resolving entry point: the ONLY call shape the QA differential uses.
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
    -- the client adds the two monthly-only sources whenever the period scope includes شهري
    public.ops_qa_scope_tables(case when p_deal='إيجار' and p_period in ('شهري','كلاهما')
                                    then c.scope||'m' else c.scope end),
    c.types_ar,
    case when c.scope2 is null then null
         else public.ops_qa_scope_tables(case when p_deal='إيجار' and p_period in ('شهري','كلاهما')
                                              then c.scope2||'m' else c.scope2 end) end,
    case when c.scope2 is null then null else c.types_ar end,
    p_deal, p_period, c.macro, p_cities, p_districts, p_region_ids,
    p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d
  where c.ui_type = p_ui_type
$$;
-- the client does NOT add monthly-only sources to a scope2 that is commercial-only; res/com scope2='com'
-- has no gathern/aqarmonthly table anyway, so 'com'||'m' must exist and simply equal com + the two.
insert into public.ops_qa_scope (scope, tables, note)
select 'comm', array(select unnest(tables) union select unnest(array['gathern_residential_listings','aqarmonthly_residential_listings'])), 'monthly variant of com'
from public.ops_qa_scope where scope='com'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;
grant execute on function public.ops_qa_diff(text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric) to authenticated, service_role;
