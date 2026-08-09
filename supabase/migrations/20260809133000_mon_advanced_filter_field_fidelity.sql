-- Permanent detector for the Advanced Filter source-truth rule
-- (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md, owner rule 2026-08-09).
--
-- Every field the Advanced Filter offers is three-valued: true / false / NULL-because-the-source-was
-- -silent. Two shapes prove a parser has stopped reading the source and started inventing:
--
--   NO_VARIANCE  — a populated boolean that is 100% true or 100% false. A real market is never
--                  unanimous; this is a parser stuck on a constant, which is exactly how aqar
--                  `parking` looked at 93.6% true on the June cohort before the 2026-08-09 repair.
--   NEVER_NULL   — a boolean populated on ~every row. A source that publishes a field still leaves
--                  it null on most listings; 100% coverage means "no" is being manufactured from
--                  silence, which is the NULL->false conversion the rule forbids.
--
-- Reads the SEARCH INDEX, i.e. the last hop before the user, so it catches a break anywhere in
-- SOURCE -> SCRAPER -> RAW -> CANONICAL -> SEARCH INDEX -> FILTER rather than only in the parser.
-- Bucket-count thresholds are deliberately loose: this flags shapes to investigate, never kills rows.

create or replace view mon_advanced_filter_field_fidelity as
with f(field) as (
  values ('furnished'), ('elevator'), ('parking'), ('kitchen'),
         ('air_conditioner'), ('maid_room'), ('driver_room'), ('private_entrance')
),
stats as (
  select s.platform,
         f.field,
         count(*)                                              as rows_total,
         count(*) filter (where (to_jsonb(s) ->> f.field) = 'true')  as n_true,
         count(*) filter (where (to_jsonb(s) ->> f.field) = 'false') as n_false,
         count(*) filter (where (to_jsonb(s) ->> f.field) is null)   as n_null
  from search_listings_ar s
  cross join f
  where s.production_ready
  group by s.platform, f.field
)
select platform,
       field,
       rows_total,
       n_true,
       n_false,
       n_null,
       round(100.0 * (n_true + n_false) / nullif(rows_total, 0), 2) as pct_populated,
       round(100.0 * n_true / nullif(n_true + n_false, 0), 2)       as pct_true_of_populated,
       case
         when n_true + n_false = 0                                    then 'UNPOPULATED'
         when n_true + n_false >= 200 and (n_true = 0 or n_false = 0) then 'NO_VARIANCE'
         when rows_total >= 200
              and (n_true + n_false) > 0.99 * rows_total              then 'NEVER_NULL'
         else 'OK'
       end as verdict
from stats
order by (case when n_true + n_false = 0 then 2 else 0 end), platform, field;

comment on view mon_advanced_filter_field_fidelity is
  'Advanced Filter source-truth detector. NO_VARIANCE = a populated boolean with no true/false mix '
  '(parser stuck on a constant). NEVER_NULL = populated on ~every row (silence being converted to '
  'a value). UNPOPULATED = the platform publishes nothing we read — honest, but it means the chip '
  'cannot match that platform. See docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md.';
