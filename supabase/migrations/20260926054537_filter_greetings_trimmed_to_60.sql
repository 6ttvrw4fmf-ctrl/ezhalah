-- Filter-greeting rotation trimmed from 100 Arabic rows to 60 (owner rule 2026-09-26).
--
-- Owner review of the original 100 (supabase/migrations/20260918214451_ui_filter_greetings_rotation.sql):
-- a few read Gulf-wide rather than Saudi, some leaned Emirati (notably "مرحبا الساع"), and others felt
-- forced or unnatural ("أرحب وأسهِل", "مرحبتين كبار", greetings ending randomly with "يا"). Owner's own
-- call: better 60 that sound natural in Saudi Arabia than 100 with filler. This is the owner's exact
-- replacement list, applied verbatim.
--
-- English rows (lang = 'en', stored for future English support, untouched here) are unaffected — only
-- lang = 'ar' rows are replaced. sort_order restarts at 1 for the new set; the unique(lang, sort_order)
-- constraint is satisfied because the old ar rows are deleted first, in the same transaction.
delete from public.ui_filter_greetings where lang = 'ar';

insert into public.ui_filter_greetings (lang, sort_order, greeting, emoji) values
  ('ar', 1, 'هلا', '👋'),
  ('ar', 2, 'يا هلا', '🙌'),
  ('ar', 3, 'هلا والله', '💚'),
  ('ar', 4, 'مرحبا', '😊'),
  ('ar', 5, 'أرحب', '✨'),
  ('ar', 6, 'يا مرحبا', '🤝'),
  ('ar', 7, 'حياك', '😎'),
  ('ar', 8, 'أهلين', '🌟'),
  ('ar', 9, 'هلا وغلا', '🤍'),
  ('ar', 10, 'يا هلا والله', '🔥'),
  ('ar', 11, 'مرحبتين', '😄'),
  ('ar', 12, 'أرحب والله', '🫡'),
  ('ar', 13, 'حيا الله', '🙏'),
  ('ar', 14, 'يا حي', '🌴'),
  ('ar', 15, 'هلا هلا', '🎉'),
  ('ar', 16, 'يا مرحبا والله', '💫'),
  ('ar', 17, 'أهلًا', '🌿'),
  ('ar', 18, 'أهلين وسهلين', '😁'),
  ('ar', 19, 'يا هلا وغلا', '🏡'),
  ('ar', 20, 'حياك الله', '☀️'),
  ('ar', 21, 'أرحب مليون', '🚀'),
  ('ar', 22, 'هلا بالزين', '😉'),
  ('ar', 23, 'يا مرحبتين', '🌹'),
  ('ar', 24, 'يالله حيه', '⚡'),
  ('ar', 25, 'يا هلا فيك', '🥳'),
  ('ar', 26, 'هلا بك', '🏠'),
  ('ar', 27, 'يا حيّك', '😌'),
  ('ar', 28, 'أرحب وألف هلا', '💯'),
  ('ar', 29, 'يا مرحبا مليون', '🌧️'),
  ('ar', 30, 'هلا بالطلة', '🌞'),
  ('ar', 31, 'حيا الله هالطلة', '🍃'),
  ('ar', 32, 'أهلًا وسهلًا', '🔎'),
  ('ar', 33, 'هلا من جديد', '🔄'),
  ('ar', 34, 'يا مرحبا تراحيب', '🌸'),
  ('ar', 35, 'حياك ربي', '👌'),
  ('ar', 36, 'هلا فيك', '🧭'),
  ('ar', 37, 'يا هلا بك', '💪'),
  ('ar', 38, 'حي الله من جانا', '🏘️'),
  ('ar', 39, 'أهلين والله', '😄'),
  ('ar', 40, 'يا حي من لفانا', '🛬'),
  ('ar', 41, 'مرحبا مليون', '💎'),
  ('ar', 42, 'هلا والله ومرحبا', '🎈'),
  ('ar', 43, 'حي الله', '😊'),
  ('ar', 44, 'يا مرحبا بك', '🧡'),
  ('ar', 45, 'أهلين فيك', '🪄'),
  ('ar', 46, 'يا مرحبا', '🥰'),
  ('ar', 47, 'أرحب تراحيب', '🌊'),
  ('ar', 48, 'يا هلا بالطلة', '📍'),
  ('ar', 49, 'حيّاك الله', '🏙️'),
  ('ar', 50, 'هلا ومرحبا', '🛋️'),
  ('ar', 51, 'يا مرحبا بالزين', '🌺'),
  ('ar', 52, 'أهلًا ومرحبًا', '🎯'),
  ('ar', 53, 'يا حي الله', '🍀'),
  ('ar', 54, 'أهلًا أهلًا', '🙋'),
  ('ar', 55, 'يا هلا مليون', '⭐'),
  ('ar', 56, 'يالله حيّك', '🎊'),
  ('ar', 57, 'هلا ومرحبتين', '🧩'),
  ('ar', 58, 'يا هلا يا هلا', '🎵'),
  ('ar', 59, 'أرحب وألف مرحبا', '🏅'),
  ('ar', 60, 'هلا بك والله', '🛎️');

do $verify$
declare v_count int;
begin
  select count(*) into v_count from public.ui_filter_greetings where lang = 'ar';
  if v_count <> 60 then
    raise exception 'expected exactly 60 ar rows after the trim, found %', v_count;
  end if;
end $verify$;