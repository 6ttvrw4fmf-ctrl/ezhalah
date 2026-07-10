-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 2 / 6
-- Shared BEFORE-UPDATE trigger that maintains deactivated_at for EVERY hide/restore path.
-- =====================================================================================================
--
-- WHY A TRIGGER (and not per-scraper edits)
--   Rows are hidden by at least FIVE independent code paths, and restored by a sixth:
--     1. mark_stale_listings_inactive()      — cron 04:00, active=false on stale rows          (SQL)
--     2. prune_unseen() 3-strike             — scrapers/common/db.py, active=false at mc>=3     (Python)
--     3. sold-pin                            — post-upsert UPDATE {active:false, mc:3}          (Python)
--     4. enumeration/HTTP liveness sweeps    — e.g. aqar_residential                           (Python)
--     5. price-guard (_sanitize_price)       — upsert forces active=false on price typos        (Python)
--     6. auto_recover_false_inactive()       — cron 05:20, active=true on false-inactive rows   (SQL)
--   Editing each of these to also write deactivated_at would be error-prone and easy to miss on the
--   next new source. A single BEFORE-UPDATE trigger on the `active` column captures ALL of them at the
--   one place they converge — the row write — with ZERO scraper changes. This is the safe design.
--
-- WHAT IT DOES (owner-locked policy)
--   * active goes true -> false (any HIDE path): stamp deactivated_at = now(), but ONLY if it is
--     currently NULL. The "only if null" guard makes the clock PERMANENT within one inactive spell —
--     a later touch that keeps the row inactive can never push the 7-day deletion clock forward.
--   * active goes false -> true (a genuine REACTIVATION): clear deactivated_at = NULL. This is policy
--     point 5 (reappear within 7d -> auto-restore AND clear the clock) satisfied automatically, so a
--     listing that comes back and is later hidden again starts a FRESH 7-day window.
--
-- WHY BEFORE (not AFTER)
--   A BEFORE ROW trigger mutates NEW.* and returns NEW; that mutated NEW is exactly what Postgres
--   persists to the heap. So deactivated_at is written in the SAME UPDATE, with no second write, no
--   race, and no possibility of an AFTER trigger observing a value that never got stored.
--
-- WHY THE `WHEN (OLD.active IS DISTINCT FROM NEW.active)` CLAUSE
--   The vast majority of upserts touch already-active rows without changing `active` (a seen listing:
--   last_seen_at/missing_count refresh, active stays true). The WHEN clause makes the trigger body run
--   ONLY when `active` actually flips, so the hot path pays nothing. `active` is boolean NOT NULL on
--   every table (verified), so IS DISTINCT FROM behaves like <> here; it is used for total safety.
--
-- KNOWN, ACCEPTED LIMITATION (surfaced to owner — safe direction, not a data-loss risk)
--   For a sold-pinned row the source STILL SHOWS every crawl, the Python path does: batch upsert
--   (sets active=true via setdefault -> trigger CLEARS deactivated_at) immediately followed by the
--   sold-pin UPDATE (active=false, mc=3 -> trigger RE-STAMPS deactivated_at=now()). Net: deactivated_at
--   is refreshed each crawl, so such rows never age past 7 days and are NEVER purged. This errs toward
--   OVER-RETENTION (a hidden row lingers in the table), never over-deletion, so it is the safe failure
--   mode for a mass-deletion-adjacent change. ~602 rows are in this state today. If the owner wants
--   these eventually purged, the follow-up is to stop the transient reactivation (a scraper change) or
--   to only clear deactivated_at from the auto_recover path — both are out of scope for this package.
--
-- FILES ONLY. Not applied. No cron changed.
-- =====================================================================================================

-- ---- trigger function --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_deactivated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- The trigger's WHEN clause guarantees active actually changed, so exactly one branch runs.
  IF NEW.active = false THEN
    -- HIDE: record the permanent deletion clock, but never overwrite an existing stamp.
    IF NEW.deactivated_at IS NULL THEN
      NEW.deactivated_at := now();
    END IF;
  ELSE
    -- REACTIVATION (NEW.active = true): clear the clock so a reappeared listing starts fresh.
    NEW.deactivated_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---- attach to every listings table -----------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '_(residential|commercial)_listings$'
  LOOP
    -- DROP + CREATE (not CREATE OR REPLACE, which triggers don't support) => idempotent re-runs.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_deactivated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_deactivated_at '
      'BEFORE UPDATE ON public.%I '
      'FOR EACH ROW '
      'WHEN (OLD.active IS DISTINCT FROM NEW.active) '
      'EXECUTE FUNCTION public.set_deactivated_at()',
      t
    );
  END LOOP;
END $$;
