-- The LIVE Normal Filter taxonomy, harvested from real production browser requests on 2026-08-20:
-- every فئة → مجموعة → نوع the user can actually pick, with the exact p_types cohort the client sends
-- for it. §1/§2 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md forbid a hardcoded control list, so this table is
-- re-harvested each run rather than hand-maintained; it exists so the QA differential oracle can be driven
-- by a UI label, and so cohort-expansion drift (a نوع that silently stops expanding to a type_ar it used to
-- reach) is visible as a diff against the previous harvest.
create table if not exists public.ops_qa_cohort (
  ui_type      text primary key,
  ui_category  text not null,
  ui_group     text not null,
  types_ar     text[] not null,
  macro        text not null,
  harvested_at timestamptz not null default now()
);
create or replace function public.ops_qa_cohort_types(p_ui_type text)
returns text[] language sql stable as $$ select types_ar from public.ops_qa_cohort where ui_type = p_ui_type $$;

insert into public.ops_qa_cohort (ui_type, ui_category, ui_group, types_ar, macro) values
('شقة','سكني','الشقق والسكن المشترك',array['شقة','مبنى شقق مخدومة','ملحق علوي'],'Residential'),
('دور','سكني','الشقق والسكن المشترك',array['دور'],'Residential'),
('استوديو','سكني','الشقق والسكن المشترك',array['استوديو','ستوديو','شقَّة صغيرة (استوديو)'],'Residential'),
('غرفة','سكني','الشقق والسكن المشترك',array['غرفة'],'Residential'),
('عمارة سكنية','سكني','الشقق والسكن المشترك',array['عمارة','مجمع سكني','مجمع','برج'],'Residential'),
('فيلا','سكني','الفلل والبيوت',array['فيلا','تاون هاوس','بيت'],'Residential'),
('دوبلكس','سكني','الفلل والبيوت',array['دوبلكس'],'Residential'),
('استراحة','سكني','الاستراحات والريف',array['استراحة','إستراحة'],'Residential'),
('شاليه','سكني','الاستراحات والريف',array['شاليه'],'Residential'),
('مخيم','سكني','الاستراحات والريف',array['مخيم'],'Residential'),
('مزرعة','سكني','الاستراحات والريف',array['مزرعة'],'Residential'),
('أرض زراعية','سكني','الاستراحات والريف',array['أرض زراعية'],'Residential'),
('أرض سكنية','سكني','الأراضي السكنية',array['أرض سكنية','أرض','حوش'],'Residential'),
('مكتب','تجاري','التجزئة والمكاتب',array['مكتب','مكاتب مشتركة'],'Commercial'),
('محل','تجاري','التجزئة والمكاتب',array['محل','كشك','درايف ثرو'],'Commercial'),
('معرض','تجاري','التجزئة والمكاتب',array['معرض'],'Commercial'),
('مستودع','تجاري','الصناعة واللوجستيات',array['مستودع','مخازن سحابية'],'Commercial'),
('ورشة','تجاري','الصناعة واللوجستيات',array['ورشة'],'Commercial'),
('مصنع','تجاري','الصناعة واللوجستيات',array['مصنع'],'Commercial'),
('مبنى تجاري','تجاري','المباني والمرافق',array['مبنى تجاري','عمارة','صالة','سينما'],'Commercial'),
('فندق','تجاري','المباني والمرافق',array['فندق'],'Commercial'),
('محطة وقود','تجاري','المباني والمرافق',array['محطة وقود','محطة','محطة بنزين'],'Commercial'),
('سكن عمال','تجاري','المباني والمرافق',array['سكن عمال'],'Commercial'),
('مرافق خدمية','تجاري','المباني والمرافق',array['بنك','مدرسة','مركز صحي','برج اتصالات','مواقف'],'Commercial'),
('أرض تجارية','تجاري','الأراضي التجارية والصناعية',array['أرض تجارية'],'Commercial'),
('أرض صناعية','تجاري','الأراضي التجارية والصناعية',array['أرض صناعية'],'Commercial')
on conflict (ui_type) do update
  set ui_category=excluded.ui_category, ui_group=excluded.ui_group,
      types_ar=excluded.types_ar, macro=excluded.macro, harvested_at=now();

-- UI-label overload of the differential oracle: ops_qa_search_differential_ui('شقة','res','com', …)
create or replace function public.ops_qa_search_differential_ui(
  p_ui_type    text,
  p_scope      text,
  p_scope2     text     default null,
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
  select d.n, d.h from public.ops_qa_search_differential(
    p_scope, public.ops_qa_cohort_types(p_ui_type),
    p_scope2, case when p_scope2 is null then null else public.ops_qa_cohort_types(p_ui_type) end,
    p_deal, p_period, (select macro from public.ops_qa_cohort where ui_type=p_ui_type),
    p_cities, p_districts, p_region_ids, p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d
$$;
grant execute on function public.ops_qa_cohort_types(text) to authenticated, service_role;
grant execute on function public.ops_qa_search_differential_ui(text,text,text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric) to authenticated, service_role;
