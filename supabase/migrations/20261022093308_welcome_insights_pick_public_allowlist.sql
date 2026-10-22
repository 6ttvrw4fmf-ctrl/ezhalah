-- The home headline reads today's insight facts and sentence shapes through welcome_insights_pick (migration
-- 20261022081647) from the signed-in browser, so it stays callable by anon/authenticated under the
-- security-definer guard. Read-only STABLE; returns at most ~200 rows of non-personal aggregate facts.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('welcome_insights_pick', '{anon,authenticated}', 'home headline: today''s aggregate insight facts + approved sentence shapes for the signed-in welcome line (lib/insightWelcome.ts). Read-only STABLE, no personal data, bounded sample.')
on conflict do nothing;
grant execute on function public.welcome_insights_pick(text, text) to anon, authenticated;
