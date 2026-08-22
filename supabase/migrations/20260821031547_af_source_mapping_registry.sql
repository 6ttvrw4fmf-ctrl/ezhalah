-- Senior Production Engineer run #33 (2026-08-21), owner-directed.
--
-- The registry the AF integrity barriers key off. It declares, per (source_table, af_field), the
-- INDEPENDENT SQL that derives the field's expected value straight from the retained source payload
-- on the raw table. The barriers evaluate this expression and compare it against what the canonical
-- AF layer (listing_rich_attrs) and the search index (search_listings_ar) actually carry.
--
-- WHY THE DERIVATION IS DUPLICATED HERE rather than calling the same helper the pipeline uses:
-- an oracle that shares its predicate with the thing it audits cannot detect a change to that
-- predicate. The pipeline calls public.sanadak_service_flag(); this registry restates the rule
-- inline. If someone edits the helper's semantics, the two disagree and the barrier fires -- which
-- is the point. (Run #31's lesson applies to raise/resolve sharing ONE predicate; an oracle and its
-- subject must NOT.)
--
-- Adding a row here permanently guards a mapping. Nothing is guarded implicitly, so a mapping that
-- is never registered is never claimed to be protected -- the coverage-cliff barrier is the generic
-- net that still watches unregistered fields.

create table if not exists public.ops_af_source_mapping (
  id            bigserial primary key,
  source_table  text    not null,
  af_field      text    not null,
  derivation    text    not null,   -- SQL boolean/text expression over alias `r` (the raw row)
  tri_state     boolean not null default true,
  note          text,
  registered_at timestamptz not null default now(),
  unique (source_table, af_field)
);

comment on table public.ops_af_source_mapping is
  'Declared source->canonical AF field mappings. The derivation is an INDEPENDENT restatement of the '
  'rule (never a call into the pipeline''s own helper) so the barriers can detect a semantics change. '
  'Senior run #33.';

insert into public.ops_af_source_mapping (source_table, af_field, derivation, note) values
 ('sanadak_residential_listings','water_supply',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='مياه') then true
        else false end$d$,
  'REGA «خدمات العقار» closed multi-select. Panel absent -> UNKNOWN. Verified live 2026-08-21.'),
 ('sanadak_residential_listings','electricity',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='كهرباء') then true
        else false end$d$, 'as above'),
 ('sanadak_residential_listings','sanitation',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='صرف صحي') then true
        else false end$d$, 'as above'),
 ('sanadak_commercial_listings','water_supply',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='مياه') then true
        else false end$d$, 'as above'),
 ('sanadak_commercial_listings','electricity',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='كهرباء') then true
        else false end$d$, 'as above'),
 ('sanadak_commercial_listings','sanitation',
  $d$case when (select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1) is null then null
        when exists (select 1 from unnest(string_to_array((select x->>'value' from jsonb_array_elements(case jsonb_typeof(r.additional_info) when 'array' then r.additional_info else '[]'::jsonb end) x where x->>'label'='خدمات العقار' limit 1), ',')) t where btrim(t)='صرف صحي') then true
        else false end$d$, 'as above')
on conflict (source_table, af_field) do nothing;
