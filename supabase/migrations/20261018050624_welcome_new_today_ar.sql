-- NEW ON EZHALAH TODAY (owner 2026-10-18, option A: «{n} إعلان جديد اليوم على إزهله»). How many listings
-- Ezhalah first saw since midnight Riyadh time that are searchable right now. first_seen_at is
-- EZHALAH-OWNED (when this system first saw the listing — see its column comment), so this is "new to
-- Ezhalah", never a claim about when the source published it. Read-only; one ~150 ms count; anon-callable
-- because the line is prepared in the background for the next visit.
create or replace function public.welcome_new_today_ar()
returns bigint
language sql stable security definer set search_path = public
as $$
  select count(*)
    from public.search_listings_ar
   where first_seen_at >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh');
$$;
revoke all on function public.welcome_new_today_ar() from public;
grant execute on function public.welcome_new_today_ar() to anon, authenticated;
