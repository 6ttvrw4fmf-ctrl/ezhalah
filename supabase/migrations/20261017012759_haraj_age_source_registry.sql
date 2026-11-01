-- Haraj's «عمر العقار» reaches the Advanced Filter (owner 2026-10-16: «match it in the Filter and the Advanced
-- Filter»). The AF age producer only trusts a table registered here. Haraj stores property_age from REGA's own
-- licence line through normalize.exact_age() (an open bound «أكثر من 10» is NULL) plus REGA's English enum
-- words («New» → 0, «Seven Year» → 7) — exact values only, so canonical_column + trusted, like nafithh's licence.
insert into public.age_source_registry (source_table, strategy, trusted, note, jsonb_key, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-10-17 (Haraj, licensed offers only): REGA licence «عمر العقار» via normalize.exact_age() + the licence''s English enum words (scrapers/haraj/parse.py age_of); open bounds stay NULL.',
       null, now()
  from unnest(array['haraj_residential_listings','haraj_commercial_listings']) t
on conflict (source_table) do nothing;

do $verify$
begin
  if (select count(*) from public.age_source_registry
       where source_table in ('haraj_residential_listings','haraj_commercial_listings')
         and strategy = 'canonical_column' and trusted) <> 2 then
    raise exception 'haraj age sources are not registered trusted canonical_column';
  end if;
  raise notice 'haraj age sources registered';
end $verify$;