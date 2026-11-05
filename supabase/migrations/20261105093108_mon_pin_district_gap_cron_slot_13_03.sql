-- mon-pin-district-gap moves 13:41 → 13:03 UTC (cron slot discipline, owner decision 6 2026-11-03): :41 already starts
-- bundle-locations-10min and mon-search-latency-sample every hour, so 13:41 would be a third job on one minute.
select cron.schedule('mon-pin-district-gap', '3 13 * * *',
  $c$set statement_timeout to '600s'; select public.mon_detect_pin_district_gap();$c$);
