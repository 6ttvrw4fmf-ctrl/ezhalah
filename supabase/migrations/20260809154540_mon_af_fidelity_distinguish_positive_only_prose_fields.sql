-- Refine the Advanced Filter fidelity detector so a real alarm is never drowned out by an expected
-- one. A permanently-red monitor is a monitor nobody reads.
--
-- After the 2026-08-09 repair, aqar's maid_room / driver_room are 100% true. That LOOKS like
-- NO_VARIANCE but is the correct, honest state: aqar publishes no structured key for either, so the
-- only signal is a prose hit, which can say "the ad advertises it" or nothing — never "no". A
-- positive-only field being all-true is expected; the same shape on a field the source states
-- explicitly is a parser stuck on a constant.
--
-- The allowlist is deliberately narrow and per (platform, field): adding to it is a claim that the
-- platform publishes NO structured counterpart, which must be proven by reading the payload — the
-- exact premise that was wrong about aqar parking. New verdict POSITIVE_ONLY_PROSE keeps them
-- visible without firing an alarm, and NEVER_NULL still applies to them.

create or replace view mon_advanced_filter_field_fidelity as
with f(field) as (
  values ('furnished'), ('elevator'), ('parking'), ('kitchen'),
         ('air_conditioner'), ('maid_room'), ('driver_room'), ('private_entrance')
),
-- (platform, field) pairs with NO structured counterpart on that platform, verified by reading the
-- payload. Prose can only ever produce true-or-NULL for these, so all-true is the expected shape.
positive_only(platform, field) as (
  values ('aqar', 'maid_room'), ('aqar', 'driver_room')
),
stats as (
  select s.platform,
         f.field,
         count(*)                                                    as rows_total,
         count(*) filter (where (to_jsonb(s) ->> f.field) = 'true')  as n_true,
         count(*) filter (where (to_jsonb(s) ->> f.field) = 'false') as n_false,
         count(*) filter (where (to_jsonb(s) ->> f.field) is null)   as n_null
  from search_listings_ar s
  cross join f
  where s.production_ready
  group by s.platform, f.field
)
select st.platform,
       st.field,
       st.rows_total,
       st.n_true,
       st.n_false,
       st.n_null,
       round(100.0 * (st.n_true + st.n_false) / nullif(st.rows_total, 0), 2) as pct_populated,
       round(100.0 * st.n_true / nullif(st.n_true + st.n_false, 0), 2)       as pct_true_of_populated,
       case
         when st.n_true + st.n_false = 0                                     then 'UNPOPULATED'
         when st.rows_total >= 200
              and (st.n_true + st.n_false) > 0.99 * st.rows_total            then 'NEVER_NULL'
         when po.field is not null and st.n_false = 0                        then 'POSITIVE_ONLY_PROSE'
         when st.n_true + st.n_false >= 200
              and (st.n_true = 0 or st.n_false = 0)                          then 'NO_VARIANCE'
         else 'OK'
       end as verdict
from stats st
left join positive_only po on po.platform = st.platform and po.field = st.field
order by (case when st.n_true + st.n_false = 0 then 2 else 0 end), st.platform, st.field;

comment on view mon_advanced_filter_field_fidelity is
  'Advanced Filter source-truth detector. ALARMS: NO_VARIANCE = a populated boolean with no '
  'true/false mix (parser stuck on a constant). NEVER_NULL = populated on ~every row (silence being '
  'converted into a value). NOT alarms: POSITIVE_ONLY_PROSE = the platform publishes no structured '
  'counterpart, so a prose hit can only ever say yes (all-true is expected); UNPOPULATED = we read '
  'nothing for it, honest but the chip cannot match that platform. '
  'See docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md.';
