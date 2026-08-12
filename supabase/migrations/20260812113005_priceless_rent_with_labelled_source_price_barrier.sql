-- Barrier for the class the 2026-08-12 senior audit found on 1october: a Rent listing SERVED to
-- users with no price at all, while the listing's own captured body states the rent on a labelled
-- line. Seven of october's eight active rents were in that state (production_ready, price NULL,
-- period NULL) with «💰 الإيجار السنوي: 85,000 ريال» sitting in their description, because the
-- scraper read price only from JSON-LD offers.price / the numeric RSC "price" key.
--
-- Scoped to the LABELLED shape on purpose. Token presence anywhere in a blob is the oracle killed
-- on 2026-08-11 (it matched RNPL lines, the similar-listings strip and seller prose); this requires
-- the rent label, the amount and the currency adjacent and in that order, which is the accepted
-- 2026-08-10 aqar «السعر: N ريال» precedent. It therefore cannot fire on «تأمين مسترد: 2,000 ريال».
--
-- Deliberately fleet-wide rather than october-only: the same measurement found 24 such rows across
-- 2,632 priceless active rents, so any scraper that later loses a structured price field trips this
-- instead of silently serving priceless listings.
create or replace function public.mon_detect_priceless_rent_with_labelled_source_price()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  t text; p text; n_rows int;
  total int := 0;
  by_platform jsonb := '{}'::jsonb;
  n int := 0;
  pat text := 'ال[إا]يجار[[:space:]]*(السنوي|الشهري)?[[:space:]]*[:：][[:space:]]*[0-9][0-9,.]*[[:space:]]*ريال';
begin
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
    group by c.table_name
    having count(*) filter (where c.column_name in
        ('description','price_annual','price_total','transaction_type','active','id')) = 6
  loop
    t := rec.table_name;
    p := split_part(t, '_', 1);
    execute format($f$
      select count(*)
      from public.%I r
      join public.search_listings_ar s
        on s.source_table = %L and s.listing_id = r.id
      where r.active
        and s.production_ready
        and r.price_annual is null
        and r.price_total is null
        and (r.transaction_type ilike '%%rent%%' or r.transaction_type ilike '%%إيجار%%')
        and r.description ~ %L
    $f$, t, t, pat) into n_rows;

    if n_rows > 0 then
      total := total + n_rows;
      by_platform := by_platform
        || jsonb_build_object(p, coalesce((by_platform ->> p)::int, 0) + n_rows);
    end if;
  end loop;

  if total > 0 then
    n := public.mon_raise('P2', 'priceless_rent_labelled_source_price', 'all',
      'priceless_rent_labelled_source_price',
      jsonb_build_object(
        'served_priceless_rows', total,
        'by_platform', by_platform,
        'why', 'These Rent listings are production_ready and served with NO price, but their own '
               'captured description states the rent on a labelled «الإيجار …: N ريال» line. The '
               'source published a price and the scraper did not capture it, so the listing is '
               'unreachable by every price filter. Fix the PARSER for the named platform (read the '
               'labelled body line when the structured price field is absent) — never infer a '
               'figure from an unlabelled number, and never store an amount whose period the '
               'source did not state.'));
  else
    perform public.mon_resolve_key('priceless_rent_labelled_source_price',
                                   'priceless_rent_labelled_source_price');
  end if;

  return n;
end
$function$;

-- Roster wiring, in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors would raise on it. Guarded needle-edit rather than a hand-copied
-- full body — four recorded roster losses (2026-08-04, 2026-08-10 x2, and the 20260810202219
-- wholesale replacement) all came from re-pasting the whole function from a stale base.
do $do$
declare
  src text;
  before_n int;
  after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_priceless_rent_with_labelled_source_price''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;

  if position('mon_detect_priceless_rent_with_labelled_source_price' in src) > 0 then
    raise notice 'already wired - no-op';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  -- Count roster entries before and after: the splice must add EXACTLY one. This is the check
  -- that catches a malformed needle (a stray quote produced a doubled '' on the first attempt of
  -- this very migration and Postgres rejected the whole function), not just a missing one.
  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;

  -- Re-assert the new entry AND a sample of pre-existing ones survived, so a botched edit cannot
  -- silently shrink the roster the way the recorded losses did.
  if position('mon_detect_priceless_rent_with_labelled_source_price' in src) = 0
     or position('mon_detect_rent_period_unreachable' in src) = 0
     or position('mon_detect_price_source_mismatch' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
