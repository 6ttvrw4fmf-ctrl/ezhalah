-- Filter-greeting rotation cut from 60 Arabic rows to 11 short Saudi ones (owner 2026-10-11).
--
-- Owner review: «there is a lot of cringe, we want to remove some … just 2 words with an emoji, give me
-- 10, … add the word أرحب». The owner's exact list, applied verbatim in his order, with «أرحب ✨» added.
-- English rows (lang = 'en') are untouched; only lang = 'ar' rows are replaced. sort_order restarts at 1;
-- unique(lang, sort_order) holds because the old ar rows are deleted first, in the same transaction.
delete from public.ui_filter_greetings where lang = 'ar';

insert into public.ui_filter_greetings (lang, sort_order, greeting, emoji) values
  ('ar', 1, 'هلا', '👋'),
  ('ar', 2, 'يا هلا', '🤍'),
  ('ar', 3, 'حياك الله', '☕'),
  ('ar', 4, 'هلا ومسهلا', '🌿'),
  ('ar', 5, 'مرحبا بك', '😊'),
  ('ar', 6, 'أهلًا بك', '🌤️'),
  ('ar', 7, 'السلام عليكم', '🌿'),
  ('ar', 8, 'هلا فيك', '🤍'),
  ('ar', 9, 'يا مرحبا', '🏡'),
  ('ar', 10, 'الله يحييك', '🌴'),
  ('ar', 11, 'أرحب', '✨');
