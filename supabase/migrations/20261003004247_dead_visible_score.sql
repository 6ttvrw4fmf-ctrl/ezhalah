-- ops_dead_visible_score: dead ads a customer can see, one row per website per night.
--
-- Described by kit/dead-visible-score (2026-10-02) and applied 2026-10-03. Until the table existed,
-- dead-visible-score.yml printed its rows and exited 0.
--
-- WHY. The owner's one number is "dead ads a customer can see". Every night
-- scrapers/common/dead_visible_score.py opens a random sample of production-served ads
-- (search_listings_ar.production_ready) on every registered website through that website's own
-- check, with known-live controls, and writes what it found here. The ♻️ Lifecycle Engineer's rating
-- is READ from these rows (docs/ops/LIFECYCLE_ENGINEER.md, "Rating"): gone share > 2% on a website with
-- >= 50 decided answers, or > 5% anywhere, caps the rating at 5; fleet gone share 0 with every website
-- measured is the only 10. UNKNOWN is never dead (live + gone = decided; unknown is neither).
--
-- Ops-only, no PII: gone_ids are our own "<source_table>:<id>" keys, never a URL, a name or a phone.

create table if not exists public.ops_dead_visible_score (
  night       date    not null,
  platform    text    not null,
  method      text,                                  -- site-reader | site-oracle | registered-marker | status-only
  shown       integer not null check (shown >= 0),   -- production_ready rows the night it was sampled
  sampled     integer not null default 0 check (sampled >= 0),
  live        integer not null default 0 check (live >= 0),
  gone        integer not null default 0 check (gone >= 0),
  unknown     integer not null default 0 check (unknown >= 0),
  gated       boolean not null default false,        -- known-live controls opened the website (>= 5 ads)
  gone_ids    text[]  not null default '{}',         -- evidence: source_table:id of every gone ad
  note        text,                                  -- 'void: …' (controls failed), 'error: …', or the gate note
  run_url     text,
  created_at  timestamptz not null default now(),
  primary key (night, platform),
  check (live + gone + unknown = sampled),
  check (cardinality(gone_ids) = gone)
);

alter table public.ops_dead_visible_score enable row level security;
revoke all on table public.ops_dead_visible_score from anon, authenticated;

comment on table public.ops_dead_visible_score is
  'Dead ads a customer can see: one row per website per night from dead-visible-score.yml '
  '(scrapers/common/dead_visible_score.py). gone / (live + gone) is the gone share; unknown is neither. '
  'A row with live + gone = 0 is a website NOT measured that night (see note), never a clean one. '
  'The Lifecycle Engineer rating is read from these rows (LIFECYCLE_ENGINEER.md, Rating).';

-- The engineer's one number per night, computed the way the rulebook says (dead share × shown, summed).
create or replace view public.ops_dead_visible_fleet as
  select night,
         count(*)                                            as websites,
         count(*) filter (where live + gone > 0)             as measured,
         sum(live + gone)                                    as decided,
         sum(gone)                                           as gone,
         case when sum(live + gone) > 0
              then round(sum(gone)::numeric / sum(live + gone), 4) end as gone_share,
         sum(case when live + gone > 0
                  then round(gone::numeric * shown / (live + gone)) else 0 end)::bigint
                                                             as visible_dead_estimate,
         array_agg(platform order by platform)
           filter (where live + gone > 0
                     and (gone::numeric / (live + gone) > 0.05
                          or (live + gone >= 50 and gone::numeric / (live + gone) > 0.02)))
                                                             as over_the_line,
         array_agg(platform order by platform) filter (where live + gone = 0) as unmeasured
    from public.ops_dead_visible_score
   group by night;

revoke all on table public.ops_dead_visible_fleet from anon, authenticated;
comment on view public.ops_dead_visible_fleet is
  'Per night: the fleet gone share, the estimated number of dead ads customers can see, the websites '
  'over the rulebook lines (rating cap 5) and the websites not measured (never a 10).';

-- The workflow bridges its result to alert_event with kind lifecycle_check_failed (routed to ♻️
-- routine 11 by the ^lifecycle_ pattern in scripts/lib/alertRouting.ts). Same shared resolver as the
-- seven kinds registered by migrations 20260905110220 and 20260913134418: a green run calls
-- mon_resolve_key on the same dedup key. Registered so the first red run does not read as unresolvable.
insert into public.ops_alert_kind_external_resolver (kind, resolved_by, evidence) values
  ('lifecycle_check_failed',
   'scripts/ops/raise-workflow-alert.mjs (via .github/workflows/dead-visible-score.yml)',
   'Same shared bridge as barrier_check_failed (migration 20260913134418): buildRpcCall() calls '
   'mon_resolve_key on dedup workflow_failed:dead-visible-score.yml when --status is success; '
   'the step runs under if: always(). Never fired before this migration.')
on conflict (kind) do nothing;
