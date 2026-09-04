-- Give the 5 newly activated platforms the SAME Advanced Filter attribute coverage every other
-- platform has (owner, 2026-09-03).
--
-- WHAT WAS MISSING. listing_extra_attrs and listing_rich_attrs are the two views sync_all_rich_attrs
-- reads to populate the AF columns of search_listings_ar. They carry one arm per platform table, and
-- the five platforms activated today had none — so real, already-captured data was invisible to the
-- Advanced Filter: 372 property_age values (abralosol), 635 street_width_m (arkaan) and 51
-- reception_rooms_majlis (arkaan). Area/price/bedrooms/bathrooms already worked, because those
-- columns travel through active_listing_ids_v2 rather than these views.
--
-- WHY THIS IS SAFE. Both objects are plain VIEWS, not matviews, and adding UNION ALL arms leaves the
-- column list untouched, so CREATE OR REPLACE VIEW applies in place: no DROP, no CASCADE, no
-- dependent rebuild, and no lock beyond the statement itself.
--
-- HOW THE ARMS ARE BUILT. Cloned from the LIVE october arm rather than hand-written. october is an
-- exact aqar-shaped clone, the same shape these five use, so its arm already encodes every
-- convention that matters — canon_direction_ar() on direction, the rent_now_pay_later ->
-- installment_available/amount mapping, balcony_terrace -> balcony, reception_rooms_majlis ->
-- majlis_rooms, and the additional_info latitude/longitude extraction (which is exactly where
-- arkaan's coordinates were folded, so they now flow through for free). Generating from the live
-- text means this cannot drift from whatever the other platforms currently do.
--
-- SOURCE IS TRUTH is unchanged: every column these sources do not publish stays NULL, and a NULL AF
-- attribute is excluded from a strict AF predicate rather than being treated as false.
DO $do$
DECLARE
  v          text;
  src        text;
  arm        text;
  arms       text;
  st         int;
  en         int;
  t          text;
  tbls       text[] := ARRAY[
    'therc_residential_listings','therc_commercial_listings',
    'aouj_residential_listings','aouj_commercial_listings',
    'abralosol_residential_listings','abralosol_commercial_listings',
    'arkaan_residential_listings','arkaan_commercial_listings',
    'rawasidark_residential_listings','rawasidark_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_extra_attrs','listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');

    IF position('therc_residential_listings' in src) > 0 THEN
      RAISE NOTICE '% already carries the new arms — skipping', v;
      CONTINUE;
    END IF;

    -- Extract october's arm verbatim: from its SELECT through its terminating "WHERE x.active".
    st := position('SELECT ''october_residential_listings''::text AS source_table' in src);
    IF st = 0 THEN
      RAISE EXCEPTION '% has no october arm to clone — shape changed, refusing to guess', v;
    END IF;
    en := st + position('FROM october_residential_listings x' in substring(src from st)) - 1;
    en := en + position('WHERE x.active' in substring(src from en)) - 1 + length('WHERE x.active');
    arm := substring(src from st for en - st);

    arms := '';
    FOREACH t IN ARRAY tbls LOOP
      arms := arms || E'\nUNION ALL\n ' || replace(arm, 'october_residential_listings', t);
    END LOOP;

    EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v, src || arms);
    RAISE NOTICE 'wired 10 arms into %', v;
  END LOOP;
END
$do$;

select
  (select count(*) from listing_extra_attrs
     where source_table ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_') extra_rows,
  (select count(*) from listing_rich_attrs
     where source_table ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_') rich_rows,
  (select count(property_age) from listing_extra_attrs
     where source_table ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_') ages,
  (select count(street_width_m) from listing_extra_attrs
     where source_table ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_') street_widths,
  (select count(majlis_rooms) from listing_rich_attrs
     where source_table ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_') majlis;
