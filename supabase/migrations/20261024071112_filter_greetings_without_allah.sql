-- Filter greetings without the word «الله» (owner 2026-10-24: «الله is still spelled wrong, remove it, remove the word God»).
-- Same 11 short Saudi openings in the same order as 20261011081754; only rows 3 and 10 change:
--   «حياك الله ☕» -> «حياك ☕»,  «الله يحييك 🌴» -> «سلامات 🌴».
-- English rows (lang = 'en') are untouched. unique(lang, sort_order) holds: the old ar rows are deleted first, in the same transaction.
delete from public.ui_filter_greetings where lang = 'ar';

insert into public.ui_filter_greetings (lang, sort_order, greeting, emoji) values
  ('ar', 1, 'هلا', '👋'),
  ('ar', 2, 'يا هلا', '🤍'),
  ('ar', 3, 'حياك', '☕'),
  ('ar', 4, 'هلا ومسهلا', '🌿'),
  ('ar', 5, 'مرحبا بك', '😊'),
  ('ar', 6, 'أهلًا بك', '🌤️'),
  ('ar', 7, 'السلام عليكم', '🌿'),
  ('ar', 8, 'هلا فيك', '🤍'),
  ('ar', 9, 'يا مرحبا', '🏡'),
  ('ar', 10, 'سلامات', '🌴'),
  ('ar', 11, 'أرحب', '✨');
