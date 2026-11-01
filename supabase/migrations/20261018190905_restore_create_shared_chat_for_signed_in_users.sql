-- APPLIED 2026-10-18 (owner session). FIX of my own regression in 20261018182626_secdef_functions_are_not_a_public_api.
--
-- WHAT BROKE: that migration revoked `authenticated` from every SECURITY DEFINER function not on the allowlist. Its caller
-- audit covered the 45 anon-callable functions and the anon-callable STABLE ones, but not create_shared_chat — a VOLATILE
-- definer granted to `authenticated` only (20261018031834_shared_chat_copy) that the web app calls when a signed-in user
-- shares a chat (src/lib/sharedChat.ts). From 18:26 to this migration a signed-in «share» failed with permission denied.
-- Found while preparing the shared-chat live check of 20261018190705.
--
-- THE FIX: one reasoned allowlist row and the grant back, to `authenticated` only (anon never had it). It already guards
-- what it writes: sign-in required (auth.uid()), sender name required, locale ar|en, object payloads, ≤ 3 MB, 60 shares
-- per user per hour. A full re-audit of every function the app or an edge function calls (src/, supabase/functions/, api/)
-- found no other definer function that lost a role it needs.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('create_shared_chat', '{authenticated}', 'web app: src/lib/sharedChat.ts creates a share link for a SIGNED-IN user. Validated: auth.uid() required, sender name, locale ar|en, object payloads, <= 3 MB, 60 shares per user per hour.')
on conflict (proname) do update set grant_to = excluded.grant_to, reason = excluded.reason;
grant execute on function public.create_shared_chat(text, text, jsonb, jsonb) to authenticated;

do $proof$
begin
  if not has_function_privilege('authenticated', 'public.create_shared_chat(text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_shared_chat(text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'PROOF: create_shared_chat must be callable by authenticated and not by anon';
  end if;
  if (select count(*) from public.ops_public_secdef_allowlist) <> 40 then
    raise exception 'PROOF: the allowlist should hold 40 reasoned rows';
  end if;
  raise notice 'PROOF OK: signed-in users can share a chat again; anon still cannot';
end
$proof$;
