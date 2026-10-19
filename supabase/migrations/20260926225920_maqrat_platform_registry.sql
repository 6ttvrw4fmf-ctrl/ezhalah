-- platform_registry row for MAQRAT (wave 3 batch 3). The note records what was MEASURED, including the
-- traps that would have mis-onboarded the platform, so the next engineer does not rediscover them.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('maqrat', 'active', 'source', 24, 7,
   'MAQRAT (maqrat.com, «منصة MAQRAT» — the site has no Arabic name). ASP.NET MVC; every GET paging '
   'parameter on /Property returns the same 12 cards — the real paging is the page script''s own '
   'multipart POST /Property/_Properities (start=N, length=12, Language=ar) with #TotalRecord (83). '
   'Each /Property/Details/<id> page renders the REGA licence block BY LABEL (pd-overview / ap-ro-field). '
   'TRAPS: (1) every rent card prints «سنويًا» (25 of 25) but some ads state a MONTHLY price in their '
   'own text («1800 ريال سعودي شهريًا») and others a monthly figure whose ×12 IS the price; the ad''s '
   'text tied to its price decides, else a price ≤ 10,000 is monthly (owner rule 2026-09-26; rooms '
   '1,800-4,500 vs everything else ≥ 15,000). (2) Land sales print «سعر المتر» AND «إجمالي سعر بيع '
   'الأرض»; the published total is stored. (3) The page renders OTHER listings'' thumbnails; only '
   'Property_<own id>_* photos are kept. (4) PDPL: «اسم مسؤول الإعلان» / «رقم جوال مسؤول الإعلان» are '
   'never stored. Measured 2026-09-26: 83 ads → 82 rows (1 «مجمع» unmapped); 15 have only the site''s '
   'default placeholder image, stored as no photo.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
begin
  if not exists (select 1 from public.platform_registry
                  where platform = 'maqrat' and status = 'active' and kind = 'source') then
    raise exception 'maqrat is not registered active+source';
  end if;
  raise notice 'maqrat is registered active+source';
end $verify$;