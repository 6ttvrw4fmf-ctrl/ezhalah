-- 🔬 AF engineer 2026-10-07 (backlog 135): gathern bathrooms from the unit page's own «دورات المياة»
-- section, for units whose list item carried no bathtub icon (stored NULL). The section agrees with the
-- icon on 2,002 of 2,009 units that carry both. Fills NULL only — a stored count is never rewritten
-- (dry run: 10,060 NULL→count, 0 rewrites, 2,722 of them active). The parser now does the same on every
-- detail back-fill (scrapers/gathern/run.py _bathrooms_from_sections). Reaches search on the next crawl.
with sec as (
  select g.id,
         case when btrim(x->>'content') = 'دورة مياه واحدة' then 1
              else nullif(substring(btrim(x->>'content') from '^(\d{1,2})\s+دورات المياة$'), '')::int end as n
  from public.gathern_residential_listings g,
       jsonb_array_elements(case jsonb_typeof(g.additional_info->'extra_sections')
                              when 'array' then g.additional_info->'extra_sections' else '[]'::jsonb end) x
  where g.bathrooms is null and x->>'header' = 'دورات المياة'
)
update public.gathern_residential_listings g
   set bathrooms = sec.n
  from sec
 where sec.id = g.id and sec.n > 0 and g.bathrooms is null;
