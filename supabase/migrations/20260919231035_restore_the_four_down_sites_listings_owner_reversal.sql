-- REVERSES 20260919230553 — the owner changed his mind, same evening, and he is right about why.
--
-- Owner 2026-09-19: "YK WHAT LETS KEEP IT HOW IT WAS SHOW THERE LISTINGS THATS FINE SO THE USER IS
-- AWARE ITS THERE WEBSITE ISSUE" and, when asked whether a user would understand whose fault it is:
-- "NO THEY KNOW THEY GET REDIRECTED SO ITS FINE".
--
-- The reasoning: clicking through lands the user on the SOURCE's own domain showing the source's own
-- "Coming Soon" / "Account Suspended" / 502 page. The redirect itself is the explanation — the user
-- sees eastabha.sa, not Ezhalah, telling them the site is unavailable. Hiding the listings would
-- instead make the inventory silently shrink with no explanation anywhere.
--
-- SCOPE — restores EXACTLY the 334 rows that 20260919230553 deactivated, and not one more. Those
-- rows are identified by deactivated_at >= the moment that migration ran. The four tables also hold
-- listings that were ALREADY inactive before tonight (eastabha 41, souq24 16, sadin 24) because the
-- source genuinely dropped them; those are legitimately dead and MUST stay dead. Reactivating them
-- would resurrect listings no source ever re-confirmed, which is the opposite of source-is-truth.
--
-- The sites are still down. Nothing here claims otherwise: last_seen_at / last_scraped are
-- untouched, so freshness and liveness monitoring keep reporting exactly what they reported before,
-- and sadin's open P0 'silent_scraper_death' stays open. This migration changes what we SHOW, never
-- what we CLAIM to have verified.

do $$
declare
  v_tbl      text;
  v_one      bigint;
  v_restored bigint := 0;
  v_sync     record;
  v_back     bigint;
  c_cutoff constant timestamptz := '2026-09-19 23:05:00+00';
  c_tables constant text[] := array[
    'eastabha_residential_listings', 'eastabha_commercial_listings',
    'souq24_residential_listings',   'souq24_commercial_listings',
    'sadin_residential_listings',    'sadin_commercial_listings',
    'october_residential_listings',  'october_commercial_listings'
  ];
begin
  foreach v_tbl in array c_tables loop
    execute format(
      'update public.%I set active = true, deactivated_at = null '
      'where not active and deactivated_at >= %L', v_tbl, c_cutoff);
    get diagnostics v_one = row_count;
    v_restored := v_restored + v_one;
    raise notice 'restored % row(s) in %', v_one, v_tbl;
  end loop;

  if v_restored <> 334 then
    raise exception 'REFUSING: expected to restore exactly the 334 rows 20260919230553 hid, got %',
      v_restored;
  end if;

  -- Back into search. The incremental sync would normally skip rows whose last_updated predates its
  -- watermark (sadin's are 12 days old), but its WHERE clause also admits any row NOT PRESENT in the
  -- index — which is precisely these, since the prune deleted them. So they all return, stale ones
  -- included, without anyone touching a freshness timestamp to force it.
  select * into v_sync from public.sync_search_listings_ar();
  raise notice 'sync upserted %, deleted %', v_sync.upserted, v_sync.deleted;

  select count(*) into v_back from public.search_listings_ar
   where split_part(source_table, '_', 1) in ('eastabha','souq24','sadin','october');
  if v_back <> 334 then
    raise exception 'REFUSING: expected 334 rows back in search, found %', v_back;
  end if;

  raise notice 'DONE: % listing(s) visible again across the four sites', v_restored;
end $$;
