-- مرافق خدمية GAINS FOUR SOURCE-WORDED TYPES (owner rule 2026-09-28).
--
-- «Anything commercial ... we're not sure of, we just put it in مرافق خدمية. It still is labeled as
-- قاعة.» A commercial space that fits no box goes in the مرافق خدمية box and its card keeps the
-- source's own word:
--   Event Hall   → قاعة           Aqar «قاعة للحجز» (DailyRenting category 108)
--   Meeting Room → غرفة اجتماعات  SuperOffice «غرفة الاجتماعات»
--   Storage Yard → ساحة تخزين     Sirdab «ساحات تخزين»
--   Self Storage → تخزين ذاتي     Sirdab «تخزين ذاتي»
-- 'Event Hall' is deliberately NOT 'Hall' (صالة → Commercial Building, 2026-07-07).
--
-- enforce_price_size_sanity replaces any type_ar absent from known_type_ar with «غير معروف», so the
-- labels must exist before the scrapers write these types. Rows below are exactly the additions in
-- sql/*.generated.sql (regenerated from src/data/taxonomy.source.json by `npm run verify:emit-sql`;
-- the taxonomy gate asserts zero drift). Additive only: the live tables equal the committed seeds
-- (55 / 44 rows, verified before applying), so nothing is truncated.
insert into public.known_type_ar (type_ar, macro) values
  ('تخزين ذاتي', 'Commercial'),
  ('ساحة تخزين', 'Commercial'),
  ('غرفة اجتماعات', 'Commercial'),
  ('قاعة', 'Commercial')
on conflict (type_ar) do nothing;

insert into public.type_label_ar (en, ar) values
  ('Event Hall', 'قاعة'),
  ('Meeting Room', 'غرفة اجتماعات'),
  ('Self Storage', 'تخزين ذاتي'),
  ('Storage Yard', 'ساحة تخزين')
on conflict (en) do nothing;

insert into public.known_property_types (raw_type) values
  ('Event Hall'), ('Meeting Room'), ('Self Storage'), ('Storage Yard'),
  ('تخزين ذاتي'), ('ساحة تخزين'), ('غرفة اجتماعات'), ('قاعة')
on conflict (raw_type) do nothing;

do $$
begin
  if (select count(*) from public.known_type_ar
      where type_ar in ('تخزين ذاتي', 'ساحة تخزين', 'غرفة اجتماعات', 'قاعة')) <> 4
     or (select count(*) from public.type_label_ar
         where (en, ar) in (('Event Hall', 'قاعة'), ('Meeting Room', 'غرفة اجتماعات'),
                            ('Self Storage', 'تخزين ذاتي'), ('Storage Yard', 'ساحة تخزين'))) <> 4
     or (select ar from public.type_label_ar where en = 'Hall') <> 'صالة' then
    raise exception 'service-facility labels did not land as generated';
  end if;
end $$;

notify pgrst, 'reload schema';
