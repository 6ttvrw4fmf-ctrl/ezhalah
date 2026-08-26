-- Evidence-backed de-fabrication, bounded to the 51 listings this run probed INDIVIDUALLY.
--
-- Not a cohort-wide rewrite: clearing all 8,183 non-Villa assertions is a bulk field rewrite and
-- therefore RED (docs/ops/AGENT_AUTHORITY.md #4) -- it is escalated to the owner, not done here.
-- These 51 rows are different: each one's LIVE aqar page was fetched and PARSED by this run
-- (0 fetch failures) through production's own _listing_json oracle, and none of them carries a
-- `maid` or `driver` key at all, while the 10 Villa controls in the same probe carry both. So the
-- stored true on each of these rows is provably Ezhalah's, not aqar's.
--
-- The value goes to NULL (UNKNOWN), never to false: aqar did not say "no", it said nothing.
create table if not exists public.ops_amenity_defabrication_evidence (
  id            bigserial primary key,
  repaired_at   timestamptz not null default now(),
  source_table  text not null,
  listing_id    bigint not null,
  ad_id         text not null,
  property_type text,
  column_name   text not null,
  value_before  boolean,
  value_after   boolean,
  probe_method  text not null,
  probe_result  text not null
);
comment on table public.ops_amenity_defabrication_evidence is
  'Row-level before-state for every amenity de-fabrication write, captured BEFORE the write. '
  'A repair without a row here is not evidence-backed and must not happen.';

with probed(ad_id) as (values
 ('6621333'),('6751787'),('6642770'),('6823947'),('6649204'),('6619607'),('6755133'),('6744307'),
 ('6815685'),('6651979'),('6635662'),('6781874'),('6826547'),('6812325'),('6803804'),('6644223'),
 ('6808165'),('6662032'),('6809686'),('6771827'),('6771919'),('6653462'),('6812758'),('6761262'),
 ('6580250'),('6765884'),('6655802'),('6554659'),('6666095'),('6537840'),
 ('6675678'),('6607390'),('6579494'),('6743596'),('6344380'),('6413115'),('6740377'),('6821168'),
 ('6743477'),('6440955'),('6472708'),('6791943'),('6777825'),('6802229'),('6575233'),('6614124'),
 ('6403760'),('6599574'),('6536663'),('6699683'),('6770042')),
target as (
  select a.id, p.ad_id, a.property_type, a.maid_room, a.driver_room
  from public.aqar_residential_listings a
  join probed p on split_part(a.listing_url,'-',array_length(string_to_array(a.listing_url,'-'),1)) = p.ad_id
  where a.property_type <> 'Villa'          -- guard: the Villa form DOES publish these
)
insert into public.ops_amenity_defabrication_evidence
  (source_table, listing_id, ad_id, property_type, column_name, value_before, value_after, probe_method, probe_result)
select 'aqar_residential_listings', t.id, t.ad_id, t.property_type, c.col, c.val, null,
       'production _listing_json oracle (AST-lifted from scrapers/aqar/enrich_residential.py) over the live https://sa.aqar.fm/ad/<id> page, 2026-08-24',
       'page parsed; no `maid` and no `driver` key present in aqar''s payload (10/10 Villa controls in the same probe carried both)'
from target t
cross join lateral (values ('maid_room', t.maid_room), ('driver_room', t.driver_room)) as c(col, val)
where c.val is true;

update public.aqar_residential_listings a
   set maid_room   = case when a.maid_room   is true then null else a.maid_room   end,
       driver_room = case when a.driver_room is true then null else a.driver_room end
 where a.id in (select listing_id from public.ops_amenity_defabrication_evidence
                 where source_table = 'aqar_residential_listings');
