-- platform_registry rows for wave 3 batch 5. Each note records what was MEASURED, including the traps.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('holoul', 'active', 'source', 24, 7,
   'حلول (holoul.io) — developer units for sale, anonymous JSON API app.holoul.io/customer/api/v1/units/. TRAPS: '
   'the feed IGNORES every query filter and always returns the whole table (238: drafts, unlisted projects, '
   'test rows) — kept only when project AND unit are listed, the unit has a REGA ad licence (P100069''s 4 units '
   'carry placeholder deeds and none) and its own record states a Sale (10 do not). Money is in HALALAS '
   '(78,500,000 → SAR 785,000). Area from the unit''s design total_area. Accept-Language: ar for Arabic names.'),
  ('eightfloor', 'active', 'source', 24, 7,
   'الطابق الثامن (www.8floor.sa) — a Nuzul SaaS tenant; public API /api/public/v2/properties. The BARE domain '
   '8floor.sa has no DNS (it was wrongly called dead) — www works. 2 Riyadh rentals; its 9 projects are unbuilt / '
   'off-plan and excluded by the owner (2026-09-27). The period is the record''s own rent_price_annually field.'),
  ('manzo', 'active', 'source', 24, 7,
   'مانزو (manzo.com.sa; manzoproptech.com.sa redirects here) — open JSON API api.manzo.com.sa. Exactly 1 live '
   'listing (Dhahran apartment 48,000/yr, REGA licence active); owner 2026-09-27: include. property_age is a '
   'BUILD YEAR (2019). Photos on media-stg.manzo.com.sa verified 200 image/jpeg.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('holoul','eightfloor','manzo') and status = 'active' and kind = 'source';
  if n <> 3 then
    raise exception 'expected 3 active source rows for wave-3 batch 5, found %', n;
  end if;
  raise notice 'wave-3 batch 5 is registered active+source';
end $verify$;