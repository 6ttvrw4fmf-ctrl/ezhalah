-- Senior Production Engineer run #33 (2026-08-21). Recorded as a migration for the drift guard:
-- this function was created live earlier in the same run via execute_sql while the fix was being
-- validated. CREATE OR REPLACE is idempotent, so re-applying it here is a no-op against production
-- and simply puts the definition under source control where AGENTS.md requires it.
--
-- The tri-state reader for Sanadak's REGA «خدمات العقار» panel, used by both sanadak branches of
-- listing_rich_attrs. Sanadak publishes the panel as a closed comma-separated multi-select
-- (مياه / كهرباء / صرف صحي / هاتف), resolved out of the Next.js RSC lazy ref by the scraper and
-- retained verbatim in <table>.additional_info.
--
-- STRICT TRI-STATE -- the whole point of this function existing rather than an inline LIKE:
--   panel absent            -> NULL   UNKNOWN. Never fabricate false from missing data.
--   service enumerated      -> true
--   panel present, absent   -> false  A REAL negative. Verified live 2026-08-21: ad 7201088580, a
--                                     Jeddah land plot, publishes «كهرباء» alone -- it genuinely has
--                                     electricity and no water or sewage connection.
-- Matching is token-exact (split on ',' then btrim), never a substring test, so «مياه» cannot be
-- matched by an unrelated longer token.

create or replace function public.sanadak_service_flag(p_additional_info jsonb, p_service text)
returns boolean
language sql
immutable
as $function$
  select case
           when svc is null then null
           when exists (select 1 from unnest(string_to_array(svc, ',')) tok
                         where btrim(tok) = p_service) then true
           else false
         end
  from (select (select r->>'value'
                  from jsonb_array_elements(
                         case jsonb_typeof(p_additional_info)
                           when 'array' then p_additional_info else '[]'::jsonb end) r
                 where r->>'label' = 'خدمات العقار'
                 limit 1)) q(svc);
$function$;

comment on function public.sanadak_service_flag(jsonb, text) is
  'Tri-state reader for Sanadak''s REGA «خدمات العقار» multi-select. Panel absent -> NULL (UNKNOWN); '
  'service listed -> true; panel present but service not listed -> false (real negative). Senior run #33.';
