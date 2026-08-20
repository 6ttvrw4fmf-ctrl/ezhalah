-- The two remaining client table scopes, harvested from real production requests 2026-08-20. These were
-- first inserted ad hoc during the 2026-08-20 QA run; recording them as a migration so a replay of
-- supabase/migrations/ reproduces the registry the differential oracle depends on (AGENTS.md migration
-- drift guard). Idempotent.
--   s1  = residential ∪ commercial — the scope production sends for every cohort whose CleanQuery spans
--         both table kinds (استوديو · دوبلكس · استراحة · مزرعة · أرض زراعية · أرض سكنية · مستودع ·
--         أرض تجارية · أرض صناعية · فندق · محطة وقود · سكن عمال · مرافق خدمية).
--   s2  = commercial + the dealapp_residential overlay — the scope production sends for مكتب.
--   *m  = the monthly variant (adds the two monthly-only sources) used only for Residential-macro cohorts.
insert into public.ops_qa_scope (scope, tables, note)
select 's1',
       array(select unnest(tables) from public.ops_qa_scope where scope='res'
             union select unnest(tables) from public.ops_qa_scope where scope='com'),
       'both-kind scope: cohorts whose CleanQuery spans residential AND commercial tables (harvested 2026-08-20)'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

insert into public.ops_qa_scope (scope, tables, note)
select 's2',
       array(select unnest(tables) from public.ops_qa_scope where scope='com'
             union select 'dealapp_residential_listings'),
       'commercial scope + dealapp_residential overlay (مكتب) — harvested 2026-08-20'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

insert into public.ops_qa_scope (scope, tables, note)
select scope||'m',
       array(select unnest(tables) union select unnest(array['gathern_residential_listings','aqarmonthly_residential_listings'])),
       'monthly variant of '||scope
from public.ops_qa_scope where scope in ('s1')
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;
