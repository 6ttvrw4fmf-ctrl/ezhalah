-- platform_registry rows for superoffice (owner-approved 2026-09-27). Each note records what was
-- MEASURED, including the traps.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('superoffice', 'active', 'source', 24, 7,
   'سوبر أوفيس (superoffice.sa) — Riyadh serviced offices, Laravel HTML. Sitemap lists 184 Arabic office pages, each TWICE (deduped). Only «مكاتب خاصة» whose first action is «احجز» (a /book/<n> link) is a listing: 12 of 177; 165 «محجوز» and 7 meeting rooms skipped. Price «X ريال / شهر» → monthly. District from the page''s own address line one «،» part at a time (the السويدي branch''s address says الدريهمية); road parts never read. No area published (capacity in persons). Map iframe centre is a viewport → no coordinates. Switchboard phone/email never read.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('superoffice') and status = 'active' and kind = 'source';
  if n <> 1 then
    raise exception 'expected 1 active source rows for superoffice, found %', n;
  end if;
  raise notice 'superoffice is registered active+source';
end $verify$;