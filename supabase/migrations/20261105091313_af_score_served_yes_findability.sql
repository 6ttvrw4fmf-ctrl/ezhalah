-- 🔬 2026-11-05 (owner: «we need this 100», measured over EVERY site, not a sample). The page-stated findability
-- in ops_af_score tried only 87 of 142 websites on 11-05: a site whose pages the reader cannot see (an SPA shell,
-- prose the reader does not quote) never produced a customer question. The served-answer half asks the PUBLIC anon
-- RPC, for ads that carry a served Advanced Filter yes, whether the customer who picks that answer reaches the ad.
-- It is a second, independent measurement of the same promise (owner rule 11-05: big numbers are checked twice).
alter table public.ops_af_score
  add column if not exists served_tried integer,
  add column if not exists served_found integer,
  add column if not exists served_missed_ids text[];
comment on column public.ops_af_score.served_tried is
  'Ads with a served AF yes asked through the anon RPC with that answer (decided only; scrapers/common/af_score.py served_findability).';