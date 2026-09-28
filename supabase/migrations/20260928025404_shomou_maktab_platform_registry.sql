-- platform_registry rows for shomou + maktab (owner-approved 2026-09-28). Each note records what was
-- MEASURED, including the traps.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('shomou', 'active', 'source', 24, 7,
   'مكتب شموع العقار (shomoalaqar.com.sa) — Al-Ahsa single office, Drupal 8 (Bossbih''s theme). Index = Views table, 26 pages, 1,028 ads; detail = one <article>. 835 ads are past their OWN «تاريخ إنتهاء الإعلان» and 37 carry a build/Hijri year in that field: only ad_expiry_state()=live is kept (142 with a stated deal on 2026-09-28; 13 state no deal). Price by label (السعر/السوم/الحد total, المتر per m² never × area, «على السوم» no figure). Rent period never stated → NULL unless the ad''s own text ties it to the price. City = the stated governorate الأحساء; «رقم الترخيص» is the office''s (same on every page) → no per-ad licence. District-plan jpg is not a photo.'),
  ('maktab', 'active', 'source', 24, 7,
   'منصة مكتب (maktab.sa) — office marketplace SPA; its public page loads backend.maktab.sa/apiBack/v1/user/offices (Laravel paginator, 11 offices 2026-09-28). Only office categories (مؤثث / غير مؤثث / للبيع); coworking desks and meeting rooms skipped. REGA ad licence per office (license_end_date) — only in-date kept, halted skipped. Prices tagged «سنوي»; the shared rule makes ≤10,000 monthly (9 of 11). space is what the site prints as «مساحة» (for 4 it is the building deed area). Names/phones in license_data never copied.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('shomou','maktab') and status = 'active' and kind = 'source';
  if n <> 2 then
    raise exception 'expected 2 active source rows for shomou/maktab, found %', n;
  end if;
  raise notice 'shomou + maktab are registered active+source';
end $verify$;