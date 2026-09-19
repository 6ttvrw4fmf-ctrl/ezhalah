-- Rotating Results-Found sentence for the search-completion bubble (owner rule 2026-09-19).
--
-- Replaces the fixed "لقينا {n} إعلان يطابق طلبك." rendered at agent.tsx:3363. Four SEPARATE pools
-- keyed on (lang, has_name) — Arabic-logged-in, Arabic-guest, English-logged-in, English-guest —
-- each seeded with the owner-authored 10 templates. Templates use {count} and, in the logged-in
-- variants, {name} — filled at the CALL SITE with the real search total and the same user display
-- name already shown in the account menu (src/store.tsx AuthUser.nameAr / .nameEn). The count is
-- ALWAYS the exact backend-returned total, never derived; the name comes ONLY from the existing
-- authenticated profile (never an email, never a guess, never the LLM).
--
-- Same shape as public.ui_filter_greetings (2026-09-18): security-definer RPC, anon-executable,
-- default-deny RLS on the table itself. See scripts/verify-results-found-rotation.ts for the
-- byte-for-byte-with-the-baked-copy check that keeps the DB and the code list in lockstep.

create table public.ui_results_found (
  id bigint generated always as identity primary key,
  lang text not null check (lang in ('ar','en')),
  has_name boolean not null,             -- logged-in row (true) vs guest row (false)
  sort_order int not null,
  template text not null,                -- must contain {count}, and {name} iff has_name
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lang, has_name, sort_order)
);

comment on table public.ui_results_found is
  'Rotation pool for the Results-Found sentence rendered after a successful search. Four pools keyed on (lang, has_name). Owner rule 2026-09-19.';

alter table public.ui_results_found enable row level security;
-- Same posture as ui_filter_greetings: no policy — the anon client reads ONLY through the RPC below.

create or replace function public.ui_results_found_ar()
returns table(lang text, has_name boolean, template text)
language sql
stable
security definer
set search_path = public
as $$
  select lang, has_name, template
  from public.ui_results_found
  where active
  order by lang, has_name, sort_order;
$$;

comment on function public.ui_results_found_ar() is
  'All active Results-Found rotation rows across the four pools. Consumed by src/data/loaderResultsFound.ts. Owner rule 2026-09-19.';

revoke all on function public.ui_results_found_ar() from public;
grant execute on function public.ui_results_found_ar() to anon, authenticated;

-- ── AR logged-in (owner-authored 2026-09-19) ─────────────────────────────────────────────────────
insert into public.ui_results_found (lang, has_name, sort_order, template) values
  ('ar', true, 1,  'لقينا لك {count} نتيجة تطابق بحثك يا {name} 🎉'),
  ('ar', true, 2,  'أبشر يا {name}، طلع لنا {count} نتيجة على بحثك 🏡'),
  ('ar', true, 3,  'يا سلام يا {name}، لقينا {count} نتيجة تطابق مواصفات بحثك 🙌'),
  ('ar', true, 4,  'تم يا {name}، عندنا {count} نتيجة مطابقة لبحثك ✨'),
  ('ar', true, 5,  'لقيناها يا {name}، {count} نتيجة على بحثك 🔎'),
  ('ar', true, 6,  'تمام يا {name}، بحثك رجّع لنا {count} نتيجة 🥳'),
  ('ar', true, 7,  'تم البحث يا {name}، وطلع لنا {count} نتيجة ✅'),
  ('ar', true, 8,  'لقينا {count} نتيجة على بحثك الحالي يا {name} 🔍'),
  ('ar', true, 9,  'عندنا {count} نتيجة يا {name} تطابق بحثك الحالي 🏘️'),
  ('ar', true, 10, 'لقينا نتائج يا {name}، وعددها {count} 🏡'),

-- ── AR guest (never inserts a name) ──────────────────────────────────────────────────────────────
  ('ar', false, 1,  'لقينا لك {count} نتيجة تطابق بحثك 🎉'),
  ('ar', false, 2,  'أبشر، طلع لنا {count} نتيجة على بحثك 🏡'),
  ('ar', false, 3,  'يا سلام، لقينا {count} نتيجة تطابق مواصفات بحثك 🙌'),
  ('ar', false, 4,  'تم، عندنا {count} نتيجة مطابقة لبحثك ✨'),
  ('ar', false, 5,  'بحثك رجّع لنا {count} نتيجة 🥳'),
  ('ar', false, 6,  'تم البحث، وطلع لنا {count} نتيجة ✅'),
  ('ar', false, 7,  'لقينا {count} نتيجة تطابق اللي بحثت عنه 🔍'),
  ('ar', false, 8,  'تمام، عندنا {count} نتيجة من بحثك الحالي 💯'),
  ('ar', false, 9,  'عندنا {count} نتيجة تطابق بحثك ⚡'),
  ('ar', false, 10, 'تم، لقينا {count} نتيجة حسب مواصفات بحثك 🏡'),

-- ── EN logged-in ─────────────────────────────────────────────────────────────────────────────────
  ('en', true, 1,  'We found {count} results matching your search, {name} 🎉'),
  ('en', true, 2,  'Good news, {name}, we found {count} results matching your search 🏡'),
  ('en', true, 3,  'Search complete, {name}, we found {count} results ✅'),
  ('en', true, 4,  'Your search returned {count} results, {name} 💫'),
  ('en', true, 5,  'We found {count} results for your current search, {name} 🔍'),
  ('en', true, 6,  'Done, {name}, we found {count} results matching your criteria ⚡'),
  ('en', true, 7,  'Good news, {name}, we found {count} results matching your criteria 🎯'),
  ('en', true, 8,  'Search complete, {name}, we found {count} matching results 🙌'),
  ('en', true, 9,  'Good news, {name}, we found {count} results matching your search ⚡'),
  ('en', true, 10, 'Done, {name}, we found {count} results based on your search criteria 🏡'),

-- ── EN guest ─────────────────────────────────────────────────────────────────────────────────────
  ('en', false, 1,  'We found {count} results matching your search 🎉'),
  ('en', false, 2,  'Good news, we found {count} results matching your search 🏡'),
  ('en', false, 3,  'Search complete, we found {count} results ✅'),
  ('en', false, 4,  'Your search returned {count} results 💫'),
  ('en', false, 5,  'We found {count} results for your current search 🔍'),
  ('en', false, 6,  'Done, we found {count} results matching your criteria ⚡'),
  ('en', false, 7,  'Good news, we found {count} results matching your criteria 🎯'),
  ('en', false, 8,  'Search complete, we found {count} matching results 🙌'),
  ('en', false, 9,  'Good news, we found {count} results matching your search ⚡'),
  ('en', false, 10, 'Done, we found {count} results based on your search criteria 🏡');
