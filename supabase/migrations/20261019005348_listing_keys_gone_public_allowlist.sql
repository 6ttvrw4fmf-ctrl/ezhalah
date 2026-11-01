-- APPLIED 2026-10-19 00:53:48 UTC (owner session).
-- listing_keys_gone (20261018232227) is SECURITY DEFINER and the web app calls it as a visitor reopening a saved chat
-- (src/lib/deadCards.ts). Under 20261018182626 a definer function keeps public roles only with an allowlist row.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('listing_keys_gone', '{anon,authenticated}', 'web app: src/lib/deadCards.ts — a reopened history chat asks which of its cards'' rows are now active = false (owner 2026-10-18, shaded «انتهى الإعلان»). Read-only STABLE; ≤ 600 «table:id» keys; only *_residential/_commercial_listings tables; returns keys only.')
on conflict do nothing;
grant execute on function public.listing_keys_gone(text[]) to anon, authenticated;
