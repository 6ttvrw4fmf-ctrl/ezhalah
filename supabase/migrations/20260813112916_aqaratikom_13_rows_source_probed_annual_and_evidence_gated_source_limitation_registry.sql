-- THE "HONEST NULL" COHORT WAS NOT HONEST. Senior run #15, corrective pass (owner-directed).
--
-- Earlier today this same run repaired 15 aqaratikom rows whose OWN capture held «سنوي» and
-- concluded the REMAINING 13 periodless rows were a source limitation, on the reasoning that they
-- carry no additional_info.subtype_ar. That reasoning was WRONG, and it was wrong in the one
-- direction the fidelity rules exist to prevent: absence of a captured token is equally consistent
-- with "the source publishes nothing" and with "our detail fetch failed", and I had treated the
-- benign reading as established without asking the source.
--
-- The source was then asked. All 13 ads were re-fetched live from the production API through
-- pg_net (the scraper's own endpoint, GET https://nawait.sa/api/v1/ad/<uuid>, 2026-08-13, request
-- ids 99-111 in net._http_response):
--
--     responses=13  http_200=13  data.type='rent'=13  data.subtype='سنوي'=13  distinct ads=13
--
-- Every one of the 13 publishes «سنوي». Their source `price` fields also match our stored
-- price_annual exactly, row for row (75,000 / 65,000 / 80,000 / 70,000 / 150,000 / 70,000 / 70,000 /
-- 46,000 / 60,000 / 35,000 / 75,000 / 50,000 / 70,000), which independently confirms we probed the
-- right ads. So this cohort is NOT a source limitation at all: it is Ezhalah failing to capture a
-- period the source states plainly, and the searchability_collapse P1 was pointing at a real defect
-- the whole time.
--
-- MECHANISM, and why the rows never self-healed. `subtype` is read ONLY from the /ad/<id> DETAIL
-- payload (run.py:380). When that fetch fails, fetch_detail() returns None, so rent_period is None
-- and _unknown_must_not_overwrite_known() DROPS the key -- which correctly protects an existing
-- value but cannot create one that was never stored. additional_info, being a non-NULL dict, IS
-- written, minus subtype_ar. That produces exactly this signature: no token, no period, forever,
-- however many times the row is re-crawled. It is the same failed-detail-fetch path identified
-- earlier in this run; what was wrong was the assumption that it had not occurred here.
--
-- Nothing is inferred, defaulted or multiplied below: the value written is the value the source
-- returned, and it is the value the current parser (_rent_period('سنوي') -> 'annual') produces from
-- it, so the next successful crawl re-asserts the same thing.

-- ═══ 1. Durable probe evidence — the proof, kept queryable, not just narrated in a comment ═══
create table if not exists public.ops_rent_period_source_probe (
  source_table   text        not null,
  listing_id     bigint      not null,
  probed_at      timestamptz not null default now(),
  http_status    int         not null,
  observed_subtype text,                      -- exactly what the source returned; NULL = source silent
  method         text        not null,
  evidence       text        not null,
  primary key (source_table, listing_id, probed_at)
);
comment on table public.ops_rent_period_source_probe is
  'Recorded LIVE re-fetches of a listing''s source page/API used to decide whether the source '
  'publishes a rental period. This table is the ONLY admissible basis for calling a periodless row '
  'a source limitation (see ops_rent_period_source_limited): a missing captured token is NOT '
  'evidence, because a failed detail fetch looks identical (run #15, 2026-08-13).';

insert into public.ops_rent_period_source_probe
  (source_table, listing_id, http_status, observed_subtype, method, evidence)
select 'aqaratikom_residential_listings', v.id, 200, 'سنوي',
       'pg_net GET https://nawait.sa/api/v1/ad/<source_id> (net._http_response ids 99-111)',
       'Senior run #15 corrective probe, 2026-08-13: all 13 periodless active aqaratikom rent '
       'apartments re-fetched from the scraper''s own detail endpoint. Every response was HTTP 200 '
       'with data.type=''rent'' and data.subtype=''سنوي''; source data.price matched the stored '
       'price_annual on every row. The source DOES publish the period — the NULL was an Ezhalah '
       'capture failure (failed detail fetch), not source silence.'
from (values (645385),(645386),(645387),(645388),(645389),(645390),(645392),(645393),
             (1203160),(4572609),(6110859),(7125930),(7589068)) v(id);

-- ═══ 2. Repair: write the period the source actually published ═══
do $$
declare v_n int;
begin
  update public.aqaratikom_residential_listings r
     set rent_period = 'annual'
   from public.ops_rent_period_source_probe p
   where p.source_table = 'aqaratikom_residential_listings'
     and p.listing_id = r.id
     and p.observed_subtype = 'سنوي'
     and p.http_status = 200
     and r.transaction_type ilike '%rent%'
     and r.rent_period is distinct from 'annual';
  get diagnostics v_n = row_count;
  raise notice 'aqaratikom rows repaired from live source probe: %', v_n;
  if v_n <> 13 then
    raise exception 'expected exactly 13 source-probed repairs, got %', v_n;
  end if;

  -- Index leg (sync_search_listings_ar is watermark-gated; cf. 20260811133417).
  update public.search_listings_ar s
     set rent_period_ar = 'سنوي', payment_monthly = false
    from public.aqaratikom_residential_listings r
   where s.platform = 'aqaratikom' and s.listing_id = r.id and s.deal_ar = 'إيجار'
     and r.rent_period = 'annual'
     and s.rent_period_ar is distinct from 'سنوي';
  get diagnostics v_n = row_count;
  raise notice 'index rows re-synced: %', v_n;
end $$;

-- ═══ 3. The registry the owner asked for: proven source limitations, evidence-gated ═══
-- A row may be called source-limited ONLY when a recorded probe shows the source returning NO
-- period. The FK to ops_rent_period_source_probe is the whole point: it makes "we checked" a
-- precondition of the waiver rather than an assumption, which is exactly the failure this run made.
create table if not exists public.ops_rent_period_source_limited (
  source_table text not null,
  listing_id   bigint not null,
  probed_at    timestamptz not null,
  reason       text not null,
  decided_at   timestamptz not null default now(),
  primary key (source_table, listing_id),
  foreign key (source_table, listing_id, probed_at)
    references public.ops_rent_period_source_probe (source_table, listing_id, probed_at)
);
comment on table public.ops_rent_period_source_limited is
  'Per-listing PROVEN source limitations: the source itself publishes no rental period. Rows here '
  'are excluded from the searchability denominator so they cannot create a permanent false P1 — but '
  'entry REQUIRES a matching ops_rent_period_source_probe row, and mon_detect_source_limited_'
  'contradicted re-checks every entry against captured evidence. Deliberately EMPTY for aqaratikom: '
  'all 13 candidates were probed on 2026-08-13 and the source published «سنوي» for every one.';

-- ═══ 4. Teach the searchability metric the difference ═══
-- Only change: proven source-limited rows leave the DENOMINATOR (they are unreachable by period
-- because the SOURCE said nothing, which is not an Ezhalah regression). Everything else is
-- untouched, so a row that is periodless for any OTHER reason — including one we simply failed to
-- capture — still drags the percentage down and still fires. Rebuilt from the live definition read
-- immediately before writing; the post-check asserts no column was lost.
create or replace view public.mon_searchability_now as
 select s.platform,
    count(*) as held,
    count(*) filter (where s.rent_period_ar = 'سنوي' and s.production_ready) as searchable_annual,
    round(100.0 * count(*) filter (where s.rent_period_ar = 'سنوي' and s.production_ready)::numeric
          / nullif(count(*), 0)::numeric, 1) as pct_annual_searchable,
    count(*) filter (where s.rent_period_ar = 'شهري') as monthly_by_source,
    count(*) filter (where s.rent_period_ar is null) as period_unknown,
    count(*) filter (where s.rent_period_ar is null and s.price_annual is null and s.price_total is null)
      as correctly_withheld_no_source_data,
    count(*) filter (where s.rent_period_ar is null and (s.price_annual is not null or s.price_total is not null))
      as suspect_price_without_period,
    count(*) filter (where not s.production_ready) as blocked_not_production_ready,
    count(*) filter (where s.last_updated > (now() - '48:00:00'::interval)) as new_last_48h,
    count(*) filter (where s.rent_period_ar = any (array['سنوي','شهري']) and s.production_ready)
      as searchable_by_period,
    -- denominator excludes PROVEN source-limited rows only
    round(100.0 * count(*) filter (where s.rent_period_ar = any (array['سنوي','شهري']) and s.production_ready)::numeric
          / nullif(count(*) filter (where sl.listing_id is null), 0)::numeric, 1) as pct_period_searchable,
    (s.platform in (select ops_rent_period_sourceless.platform from ops_rent_period_sourceless)) as period_waived,
    count(*) filter (where sl.listing_id is not null) as source_limited_excluded
   from search_listings_ar s
   left join public.ops_rent_period_source_limited sl
          on sl.source_table = s.source_table and sl.listing_id = s.listing_id
  where s.deal_ar = 'إيجار' and s.type_ar = 'شقة'
  group by s.platform;

do $$
declare missing text[];
begin
  select array_agg(c) into missing from unnest(array[
    'platform','held','searchable_annual','pct_annual_searchable','monthly_by_source','period_unknown',
    'correctly_withheld_no_source_data','suspect_price_without_period','blocked_not_production_ready',
    'new_last_48h','searchable_by_period','pct_period_searchable','period_waived']) c
   where c not in (select column_name from information_schema.columns
                    where table_schema='public' and table_name='mon_searchability_now');
  if missing is not null then
    raise exception 'view rebuild LOST columns: %', missing;
  end if;
end $$;

-- ═══ 5. The registry must not become a silent amnesty ═══
-- Fires when a row we called source-limited is contradicted by our own captured evidence — i.e. the
-- source DOES state a period after all (registration was wrong, or the source started publishing
-- one). This is the owner's condition "the source provides سنوي/شهري but Ezhalah fails to capture
-- it" applied to the waiver itself, so a waiver can never quietly outlive its justification.
create or replace function public.mon_detect_source_limited_contradicted()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows jsonb; total int := 0; n int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_table', sl.source_table, 'listing_id', sl.listing_id,
           'captured_token', a.additional_info->>'subtype_ar',
           'probed_at', sl.probed_at)), '[]'::jsonb)
    into v_rows
    from public.ops_rent_period_source_limited sl
    join public.aqaratikom_residential_listings a
      on sl.source_table = 'aqaratikom_residential_listings' and a.id = sl.listing_id
   where public.aqaratikom_period_from_token(a.additional_info->>'subtype_ar') is not null;
  total := jsonb_array_length(v_rows);

  if total > 0 then
    n := public.mon_raise('P1', 'source_limited_contradicted', 'aqaratikom',
      'source_limited_contradicted',
      jsonb_build_object('rows', total, 'sample', v_rows,
        'why', 'A listing recorded as a PROVEN source limitation (source publishes no rental '
               'period) now carries a real period token in its own capture. Either the waiver was '
               'wrong or the source started publishing a period. Re-probe the source, repair the '
               'row, and remove it from ops_rent_period_source_limited — do NOT leave it waived, '
               'because a waived row is excluded from the searchability denominator and would hide '
               'a genuine Ezhalah capture failure.'));
  else
    perform public.mon_resolve_key('source_limited_contradicted', 'source_limited_contradicted');
  end if;
  return n;
end $function$;

-- ═══ 6. Roster wiring by NEEDLE-EDIT of the LIVE body (never a hand-pasted one) ═══
do $$
declare
  v_def text; v_new text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text := '''mon_detect_source_limited_contradicted''';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position(want in v_def) = 0 then
    if position(anchor in v_def) = 0 then
      raise exception 'roster anchor % not found -- refusing to guess an edit point', anchor;
    end if;
    v_new := replace(v_def, anchor, anchor || ', ' || want);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position(want in v_def) = 0 then raise exception 'post-check: detector NOT in roster'; end if;
  if position(anchor in v_def) = 0 then raise exception 'post-check: anchor detector lost'; end if;
  if position('''mon_detect_rent_period_contradicts_capture''' in v_def) = 0 then
    raise exception 'post-check: this run''s earlier detector fell out of the roster';
  end if;
end $$;