-- Let CI read the field contract through the ANON key so "backend-only stays backend-only" can be
-- asserted against the LIVE registry rather than a copy in the test file that would drift.
--
-- Both tables are pure contract metadata: field names, datatypes, Arabic labels, whether a field is
-- exposed and why not, and each platform's source key. No listing data, no PII, nothing a competitor
-- could not read off the platforms themselves.
alter table public.af_field_registry   enable row level security;
alter table public.af_platform_mapping enable row level security;

create policy af_field_registry_read_all on public.af_field_registry
  for select to anon, authenticated using (true);
create policy af_platform_mapping_read_all on public.af_platform_mapping
  for select to anon, authenticated using (true);

grant select on public.af_field_registry   to anon, authenticated;
grant select on public.af_platform_mapping to anon, authenticated;
