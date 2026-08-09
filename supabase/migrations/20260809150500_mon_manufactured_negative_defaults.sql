-- Permanent detector: the SCHEMA must never manufacture a negative.
-- docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md — "Never treat 'not mentioned' as 'no'".
-- This view stays EMPTY. A non-empty row means a default was reintroduced, or a new listing table
-- was created from a template that still carries one.
create or replace view mon_manufactured_negative_defaults as
select c.table_name, c.column_name, c.column_default,
       'DEFAULT false on a property-fact boolean manufactures "no" from silence' as why
from information_schema.columns c
where c.table_schema = 'public' and c.table_name like '%\_listings'
  and c.data_type = 'boolean' and c.column_default = 'false'
  and c.column_name not in ('ar_fetched', 'detail_enriched', 'fullparse_done', 'reparsed_v2',
                            'rega_location_verified')
order by c.table_name, c.column_name;

comment on view mon_manufactured_negative_defaults is
  'MUST BE EMPTY. Any row = a boolean property-fact column whose DEFAULT false invents "no" for '
  'every scraper that does not explicitly write it. See docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md.';
