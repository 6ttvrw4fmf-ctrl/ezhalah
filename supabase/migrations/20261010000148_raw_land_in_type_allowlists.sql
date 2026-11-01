-- «أرض خام» joins the two type allowlists the regenerated seeds now carry (sql/known_type_ar.generated.sql,
-- sql/known_property_types.generated.sql — owner 2026-10-09). It is a FILTER token (the clean type 'Raw
-- Land' → p_types 'أرض خام'), not a stored type, so no index row carries it today; listing it keeps the
-- live allowlists equal to what the app can reach, and a source that ever publishes «أرض خام» as its own
-- type lands under the Commercial land box instead of tripping the novel-type alarm. Additive only.
insert into public.known_type_ar (type_ar, macro) values ('أرض خام', 'Commercial')
on conflict (type_ar) do nothing;
insert into public.known_property_types (raw_type, note)
select 'أرض خام', 'owner 2026-10-09: raw-land filter token (clean type Raw Land)'
where not exists (select 1 from public.known_property_types where raw_type = 'أرض خام');
