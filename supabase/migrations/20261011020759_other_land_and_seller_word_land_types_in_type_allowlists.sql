-- «أرض أخرى» (Other Land) and the seller's-own-word land types join the two type allowlists the regenerated
-- seeds carry (sql/known_type_ar.generated.sql, sql/known_property_types.generated.sql — owner 2026-10-10).
--   • «أرض» = Other Land: a plot whose source states NO usage (Aqar's «نوع العقار» absent and the seller's
--     description silent). Its home is the commercial land group «الأراضي», so its macro moves from
--     Residential (a guess, «أرض» = residential) to Commercial. 0 index rows carried «أرض» before this.
--   • «أرض سكني / تجاري / صناعي / زراعي / سكني تجاري»: an Aqar plot typed from the SELLER'S OWN words when
--     Aqar's field is silent, stored as that word so the card shows it (the feminine forms are already labels).
-- Must land before those rows are written: enforce_price_size_sanity turns a type_ar missing here into
-- «غير معروف». Additive, plus the one macro move.
update public.known_type_ar set macro = 'Commercial' where type_ar = 'أرض';
insert into public.known_type_ar (type_ar, macro) values
  ('أرض', 'Commercial'),
  ('أرض تجاري', 'Commercial'),
  ('أرض زراعي', 'Residential'),
  ('أرض سكني', 'Residential'),
  ('أرض سكني تجاري', 'Commercial'),
  ('أرض صناعي', 'Commercial')
on conflict (type_ar) do nothing;
insert into public.known_property_types (raw_type, note)
select v, 'owner 2026-10-10: Aqar land with no stated usage (أرض = Other Land) or typed from the seller''s own description'
from unnest(array['أرض', 'أرض تجاري', 'أرض تجارية', 'أرض زراعي', 'أرض زراعية', 'أرض سكني', 'أرض سكني تجاري',
                  'أرض سكنية', 'أرض صناعي', 'أرض صناعية']) v
where not exists (select 1 from public.known_property_types k where k.raw_type = v);