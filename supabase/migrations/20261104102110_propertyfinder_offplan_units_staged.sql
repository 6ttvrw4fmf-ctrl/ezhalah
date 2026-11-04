-- Property Finder's OFF-PLAN ads (completion_status off_plan / off_plan_primary — 155 of 3,461 sale ads on
-- 2026-11-04) are STORED but never shown (owner 2026-10-25: off-plan inventory is kept in its own table outside
-- the search pipeline). Their own table, deliberately NOT named *_listings: no search arm, no detector and no
-- sweep that walks the listing tables (auto_recover_false_inactive re-activates a recently hidden *_listings
-- row, so an "inactive row in the listing table" would not stay hidden) can ever reach it. No anon /
-- authenticated read. `record` is the ad's own Property Finder object with every person / contact field
-- removed by the crawler (agent, broker, client, contact_options), its free text phone-redacted.
create table if not exists public.propertyfinder_offplan_units (
  ad_number      text primary key,
  side           text not null check (side in ('res_buy', 'res_rent', 'com_buy', 'com_rent')),
  listing_url    text,
  completion_status text,
  record         jsonb not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
alter table public.propertyfinder_offplan_units enable row level security;
revoke all on public.propertyfinder_offplan_units from anon, authenticated;

do $verify$
begin
  if to_regclass('public.propertyfinder_offplan_units') is null then
    raise exception 'propertyfinder_offplan_units not created';
  end if;
  if has_table_privilege('anon', 'public.propertyfinder_offplan_units', 'SELECT')
     or has_table_privilege('authenticated', 'public.propertyfinder_offplan_units', 'SELECT') then
    raise exception 'propertyfinder_offplan_units is readable by anon/authenticated';
  end if;
  raise notice 'propertyfinder_offplan_units: present, RLS on, no public read';
end $verify$;
