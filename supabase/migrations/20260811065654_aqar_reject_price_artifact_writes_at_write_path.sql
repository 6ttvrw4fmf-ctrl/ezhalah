-- P1 (senior audit run #10, 2026-08-11): a SQL-side price repair on aqar has a ONE-SWEEP HALF-LIFE.
-- Applied to production via MCP apply_migration at 2026-08-11T06:56:54Z under deploy lock
-- 'production'; committed here verbatim per the AGENTS.md migration-drift rule.
--
-- EVIDENCE, independent of any claim: ids 1015536 / 1017694 / 1019212 carry price_per_meter = 1
-- (aqar's «سعر المتر 1» rial-per-meter gimmick) and price_total EXACTLY equal to area_m2
-- (680,000 / 3,000,000 / 2,000,000). aqar_parse() — carrying the AREA-ARTIFACT GUARD shipped by
-- 20260810202219 — returns NULL for all three, i.e. the parser already knows these are not prices
-- and PR#440 had NULLed them on 2026-08-10. Yet the rows held the artifact again and their
-- last_seen_at was 2026-08-11 01:00:19 — the daily aqar liveness sweep (cron jobid 6, '0 1 * * *').
-- scrape_runs for that window show price_updated=6/8/9 per shard, so the sweep is actively writing
-- prices. scrapers/aqar/liveness.py:price_from_body() takes the FIRST "price":N in the page body
-- regardless of what it labels — the same "first number wins" shape as the aqar_parse() bug fixed
-- in 20260811064231. Without this guard, that migration's 14-row repair would have been reverted at
-- the next 01:00 sweep.
--
-- WHY A DATABASE-LAYER GUARD
-- The liveness sweep UPDATEs price_total directly. trg_aqar_parse cannot stop it: its first branch
-- returns early when source_capture is unchanged and fullparse_done is true, which is exactly the
-- shape of a liveness write, so the parser never even runs. This is the 2026-08-06 wasalt lesson
-- (audit run #6) applied to aqar: a data-only repair of a scraper-introduced error has a one-crawl
-- half-life, and the fix must close the WRITE PATH — at the layer where the incoming value and the
-- stored source truth coexist. A Python-side guard protects one writer; this protects every writer,
-- present and future. (PR#450, open at the time of writing, adds the Python-side guard for the
-- liveness sweep specifically; the two are complementary, exactly as wasalt has both.)
--
-- THE PREDICATE is exactly mon_detect_price_eq_area_or_ppm()'s, applied before the write instead of
-- after it: a Buy price that equals the row's own area or its own per-meter figure is the proven
-- artifact class. The source-verified allowlist ops_price_eq_area_verified is honoured, so a
-- genuine coincidence (id 132677: «المطلوب: 2,000,000» for a 2,000,000 m² plot at 1 ﷼/m²) is
-- unaffected. NOTHING is fabricated: a rejected write simply leaves the stored value alone.
--
-- KNOWN BOUND (deliberate, documented rather than silently implied): this guards UPDATE only. A
-- fresh INSERT carrying the artifact is still caught after the fact by mon_detect_price_eq_area_or_ppm
-- and by aqar_parse's own area guard on the parse path; the UPDATE path is where a *repair* gets
-- reverted, which is the failure this exists to stop.
--
-- Guarded by scripts/verify-aqar-price-artifact-write-guard.ts (wired into `npm test`).
create or replace function public.trg_aqar_reject_price_artifact()
returns trigger
language plpgsql
as $function$
begin
  -- Only an UPDATE that actually changes the price to a non-null value can corrupt anything.
  -- Setting price_total to NULL is how an honest "unknown" is recorded and must always be allowed.
  if TG_OP <> 'UPDATE' or NEW.price_total is null
     or NEW.price_total is not distinct from OLD.price_total then
    return NEW;
  end if;
  if NEW.transaction_type is distinct from 'Buy' then
    return NEW;
  end if;

  if (NEW.area_m2 is not null and NEW.price_total = NEW.area_m2::bigint)
     or (NEW.price_per_meter is not null and NEW.price_total = NEW.price_per_meter::bigint)
  then
    if not exists (select 1 from public.ops_price_eq_area_verified v
                    where v.source_table = TG_TABLE_NAME and v.listing_id = NEW.id) then
      -- Reject the write, keep what was already stored. Never invent a replacement.
      NEW.price_total := OLD.price_total;
    end if;
  end if;

  return NEW;
end
$function$;

-- Fires AFTER aqar_parse_bi: 'aqar_parse_bi' < 'aqar_price_artifact_guard_bu' in name order, and
-- Postgres runs same-timing triggers alphabetically. So the parser writes first and this guard has
-- the last word on the value that actually lands.
drop trigger if exists aqar_price_artifact_guard_bu on public.aqar_residential_listings;
create trigger aqar_price_artifact_guard_bu
  before update on public.aqar_residential_listings
  for each row execute function public.trg_aqar_reject_price_artifact();

drop trigger if exists aqar_price_artifact_guard_bu on public.aqar_commercial_listings;
create trigger aqar_price_artifact_guard_bu
  before update on public.aqar_commercial_listings
  for each row execute function public.trg_aqar_reject_price_artifact();

-- Restore PR#440's repair that the 01:00 sweep reverted. The parser returns NULL for all three, so
-- NULL is the honest value; nothing is estimated. Verified in production after the guard was live,
-- so it cannot be reverted again by the same path.
update public.aqar_residential_listings set price_total = null
where id in (1015536, 1017694, 1019212);
