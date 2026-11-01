-- 🔬 Advanced Filter Engineer's nightly computed score (owner 2026-10-04). One row per website per night,
-- written by scrapers/common/af_score.py via the af-score.yml workflow (CI holds the service key).
-- Ops-only, no PII: id arrays are our own "<source_table>:<id>" keys, never a URL, a name or a phone.
create table if not exists public.ops_af_score (
  night           date    not null,
  platform        text    not null,
  sampled         integer not null default 0 check (sampled >= 0),
  fields          jsonb   not null default '{}'::jsonb,
  find_tried      integer not null default 0 check (find_tried >= 0),   -- customer requests that could be decided
  find_found      integer not null default 0 check (find_found >= 0),   -- of those, the listing was in the results
  af_claimed      integer not null default 0 check (af_claimed >= 0),
  af_agree        integer not null default 0 check (af_agree >= 0),
  af_page_states  integer not null default 0 check (af_page_states >= 0),
  af_captured     integer not null default 0 check (af_captured >= 0),
  parity_tried    integer check (parity_tried >= 0),                    -- NULL = not measured (never 0)
  parity_ok       integer check (parity_ok >= 0),
  mismatch_ids    text[]  not null default '{}',
  find_missed_ids text[]  not null default '{}',
  note            text,
  created_at      timestamptz not null default now(),
  primary key (night, platform),
  check (find_found <= find_tried),
  check (af_agree <= af_claimed),
  check (af_captured <= af_page_states)
);
alter table public.ops_af_score enable row level security;
revoke all on table public.ops_af_score from anon, authenticated;
comment on table public.ops_af_score is
  'Advanced Filter score, one row per website per night (scrapers/common/af_score.py). findability = '
  'find_found/find_tried; precision = af_agree/af_claimed; capture = af_captured/af_page_states; parity = '
  'parity_ok/parity_tried (NULL until measured). Silent pages and unreadable pages are in no ratio.';

select cron.schedule('gh-af-score', '0 8 * * *',
  $$select public.trigger_gh_workflow('af-score.yml')$$);
