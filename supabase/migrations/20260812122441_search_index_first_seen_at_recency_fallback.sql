-- STAGE A of the 2026-08-12 discoverability fix (see the RPC ordering migration that follows).
--
-- THE DEFECT. location_search_candidates_ar orders by `last_updated desc NULLS LAST`, and 4,509
-- production_ready listings (2.42%) carry last_updated = NULL — dealapp 3,059 (28% of its entire
-- searchable inventory), aqar 1,128, wasalt 301. They therefore sit behind ~186,000 rows on every
-- default browse. Measured at the RPC layer: page 1 of the plain Buy browse contained ZERO of them
-- and its newest row was 2026-08-11, i.e. nothing discovered that day was reachable by browsing.
--
-- WHY last_updated CANNOT BE THE FIX. It is copied verbatim from the source by
-- sync_search_listings_ar and is never fabricated; a NULL means the platform published no update
-- date. Writing anything into it would invent a source fact. It stays exactly as it is.
--
-- THE FIX. Carry an EZHALAH-OWNED first-seen timestamp into the index as a SEPARATE column and use
-- it only as an ordering fallback. first_seen_at is our own observation (the raw table's
-- scraped_at = when this system first saw the listing), never presented as a source value: the RPC
-- keeps returning last_updated unchanged in its output, so a card still shows an honest "no source
-- date". Only the ORDER BY consults the fallback.
--
-- Why a plain column and not a generated/indexed one: EXPLAIN ANALYZE of the live Buy browse shows
-- a Seq Scan over search_listings_ar followed by an external merge sort (15,720 kB on disk) — the
-- count(*) over() and the partition-by-platform window force a full scan and sort regardless, and
-- NONE of the three last_updated indexes are used for ordering. So the ordering expression is free
-- to change, and a STORED generated column would have forced a full table rewrite (ACCESS
-- EXCLUSIVE on the live search index) to buy nothing. Adding a nullable column with no default is
-- metadata-only and instant.
alter table public.search_listings_ar
  add column if not exists first_seen_at timestamptz;

comment on column public.search_listings_ar.first_seen_at is
  'EZHALAH-OWNED: when this system first saw the listing (raw table scraped_at). NOT a source '
  'value and never returned as one — used only as the ORDER BY fallback when the source published '
  'no last_updated. Maintained by sync_search_first_seen_at() (pg_cron), which only ever fills '
  'NULLs.';

-- Fills first_seen_at ONLY where it is missing AND the source gave no last_updated — i.e. only the
-- rows whose ordering actually depends on the fallback. That keeps the write volume at ~4.5k rows
-- instead of 186k of pointless churn on a 12-index table, and makes the function idempotent and
-- cheap enough to run on a short cron. A listing's first-seen never changes, so a filled value is
-- never revisited.
create or replace function public.sync_search_first_seen_at()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  filled int := 0;
  n int;
begin
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
      and c.column_name = 'scraped_at'
  loop
    execute format($f$
      update public.search_listings_ar s
         set first_seen_at = r.scraped_at
        from public.%I r
       where s.source_table = %L
         and s.listing_id = r.id
         and s.first_seen_at is null
         and s.last_updated is null
         and r.scraped_at is not null
    $f$, rec.table_name, rec.table_name);
    get diagnostics n = row_count;
    filled := filled + n;
  end loop;
  return filled;
end
$function$;

-- Every 10 minutes: a new listing that arrives without a source date becomes orderable within one
-- tick instead of being parked at the bottom of every browse indefinitely. Minute 7 is unused by
-- any existing job (mon_detect_cron_minute_collision guards that invariant).
select cron.schedule('sync-search-first-seen-at', '7-59/10 * * * *',
                     'select public.sync_search_first_seen_at();');

-- BARRIER. The bug this closes is "a served listing has no usable ordering key", which is exactly
-- the state that made 4,509 listings unreachable. This fires if that state ever returns — whether
-- because the backfill job stops running, a new platform lands without scraped_at, or someone
-- reverts the fallback. It watches the OUTCOME (an unsortable served row), not the mechanism.
create or replace function public.mon_detect_unsortable_served_listing()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  total bigint := 0;
  by_platform jsonb := '{}'::jsonb;
  n int := 0;
begin
  select coalesce(sum(c), 0), coalesce(jsonb_object_agg(platform, c), '{}'::jsonb)
    into total, by_platform
  from (
    select platform, count(*) c
    from public.search_listings_ar
    where production_ready
      and last_updated is null
      and first_seen_at is null
    group by platform
  ) t(platform, c);

  if total > 0 then
    n := public.mon_raise('P2', 'unsortable_served_listing', 'all',
      'unsortable_served_listing',
      jsonb_build_object(
        'rows', total,
        'by_platform', by_platform,
        'why', 'These listings are production_ready and served, but have NEITHER a source '
               'last_updated NOR an Ezhalah first_seen_at — so the recency ordering key is NULL and '
               'they sort behind every other listing on every default browse, exactly the state '
               'that hid 4,509 listings before 2026-08-12. Do NOT write into last_updated (it is '
               'source truth). Check that the sync-search-first-seen-at cron is running and that '
               'the platform''s raw table populates scraped_at.'));
  else
    perform public.mon_resolve_key('unsortable_served_listing', 'unsortable_served_listing');
  end if;

  return n;
end
$function$;

-- Roster wiring in the SAME migration (AGENTS.md). Guarded needle-edit against the LIVE body, with
-- the before/after entry count asserted — never a hand-copied full body.
do $do$
declare
  src text;
  before_n int;
  after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_unsortable_served_listing''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;
  if position('mon_detect_unsortable_served_listing' in src) > 0 then
    raise notice 'already wired - no-op';
    return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1', before_n, after_n;
  end if;
  if position('mon_detect_unsortable_served_listing' in src) = 0
     or position('mon_detect_priceless_rent_with_labelled_source_price' in src) = 0
     or position('mon_detect_rent_period_unreachable' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
