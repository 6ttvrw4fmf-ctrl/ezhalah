-- SUPERSEDED the same day by 20260810123304_mon_pii_dynamic_all_text_columns.sql, which DROPs this
-- view. Committed for migration-history parity with production (AGENTS.md "Migration drift guard").
--
-- Why it was replaced: it watched ONE column (`description`) on FIVE tables and reported all-zero
-- while 78 broker mobiles sat publicly readable in `street_name`. A guard that only looks where you
-- already looked is not a guard.
create or replace view mon_pii_in_user_visible_text as
select 'aqar_residential_listings' as table_name, 'description' as col,
       count(*) filter (where description ~ '(\+?966|00966|0)?5[0-9]{8}')                     as phones,
       count(*) filter (where description ~ '(wa\.me|t\.me)/\s*[0-9A-Za-z]')                  as messaging_links,
       count(*) filter (where description ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') as emails,
       count(*) filter (where description ~ '\y920[0-9]{5,8}\y')                               as business_lines
from aqar_residential_listings where active;
