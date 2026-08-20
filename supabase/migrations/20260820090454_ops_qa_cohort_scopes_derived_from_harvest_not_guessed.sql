-- The previous revision hand-assigned (scope, scope2) per نوع from a partial listing instead of deriving
-- it mechanically from the harvested requests. That made the oracle scope فندق / سكن عمال / أرض صناعية /
-- محطة وقود / مرافق خدمية to commercial tables only, while production actually sends the both-kind scope
-- for them — so the oracle under-counted five searches and would have been read as a product defect.
-- This mapping is derived line-for-line from templates harvested off real production requests 2026-08-20.
update public.ops_qa_cohort c set scope=v.s, scope2=v.s2 from (values
('شقة','res','com'),('دور','res','com'),('استوديو','s1',null),('غرفة','res','com'),
('عمارة سكنية','res','com'),('فيلا','res','com'),('دوبلكس','s1',null),('استراحة','s1',null),
('شاليه','res','com'),('مخيم','res','com'),('مزرعة','s1',null),('أرض زراعية','s1',null),
('أرض سكنية','s1',null),('مكتب','s2',null),('محل','com',null),('معرض','com',null),
('مستودع','s1',null),('ورشة','com',null),('مصنع','com',null),('مبنى تجاري','com',null),
('فندق','s1',null),('محطة وقود','s1',null),('سكن عمال','s1',null),('مرافق خدمية','s1',null),
('أرض تجارية','s1',null),('أرض صناعية','s1',null)
) v(t,s,s2) where c.ui_type = v.t;
-- re-adjudicate everything against the corrected scopes
update public.ops_qa_search_run set verdict=null, sql_total=null, sql_hash=null where run_date=current_date;
