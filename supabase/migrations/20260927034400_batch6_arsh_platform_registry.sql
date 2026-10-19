-- platform_registry row for Arsh (wave 3 batch 6). The note records what was MEASURED, including the traps.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('arsh', 'active', 'source', 24, 7,
   'عرش العقارية (arshglobal.com.sa) — a hand-built Duda site, no API: the index /عقارات-عرش lists its land '
   'pages; 16 are BLOCKS in one header shape («أراضي سكنية حي … مخطط رقم … بلك رقم …») with map coordinates. '
   'NO PRICE anywhere (owner 2026-09-27: include as «السعر عند الطلب»). 19 of 23 pages state no deal — owner '
   '2026-09-27: treat as for sale; only an explicit «للبيع»/«للإيجار»/«للتأجير» phrase counts («عمليات البيع '
   'والتأجير» and «فريق المبيعات» are prose). Plot areas are a screenshot; prose areas are the whole PLAN''s → '
   'area NULL. Type/district read from the header line only, never the prose. The site menu prints twice.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
begin
  if not exists (select 1 from public.platform_registry where platform = 'arsh' and status = 'active' and kind = 'source') then
    raise exception 'arsh is not registered active+source';
  end if;
  raise notice 'arsh is registered active+source';
end $verify$;