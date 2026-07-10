-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 3 / 6
-- Backfill deactivated_at for EXISTING inactive rows. OWNER CHOOSES the option; SAFEST is the default.
-- =====================================================================================================
--
-- THE PROBLEM
--   Steps 1-2 give new hides a correct deactivated_at going forward. But ~6,447 rows are ALREADY
--   inactive (active=false) with deactivated_at IS NULL. The purge (step 6) requires
--   deactivated_at IS NOT NULL, so with no backfill those rows would be permanently un-purgeable.
--   How we stamp them decides WHEN the existing backlog becomes deletable.
--
-- INTERACTION WITH THE STEP-2 TRIGGER (safe)
--   Each backfill UPDATE sets deactivated_at on rows WHERE active=false and does NOT change `active`.
--   The step-2 trigger only fires WHEN OLD.active IS DISTINCT FROM NEW.active, so it does NOT fire on
--   these UPDATEs — the explicit value written here is exactly what persists. No churn, no surprise.
--
-- IDEMPOTENT
--   Every option is guarded by `deactivated_at IS NULL`, so re-running never overwrites a value that
--   the trigger or a previous run already set.
--
-- ---- OPTION A — CONSERVATIVE (DEFAULT, ACTIVE) ------------------------------------------------------
--   Stamp deactivated_at = now() for ALL existing inactive rows.
--   EFFECT: nothing in the existing backlog can satisfy `deactivated_at < now() - 7 days` until a full
--   7 days after this migration is applied. Maximum observation window; the first purge run (and every
--   run within 7 days of apply) deletes ZERO existing rows. This is the safest possible starting point
--   for a mass-deletion-adjacent change, so it is the default active choice.
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
    EXECUTE format(
      'UPDATE public.%I SET deactivated_at = now() '
      'WHERE active = false AND deactivated_at IS NULL',
      t
    );
  END LOOP;
END $$;

-- ---- OPTION B — PROXY (COMMENTED; owner may switch to this) -----------------------------------------
--   Stamp deactivated_at = last_seen_at for existing inactive rows. For rows that DISAPPEARED or were
--   liveness-killed, last_seen_at is a good proxy for the true hide time, so the genuine backlog
--   (~1,436 rows already older than 7 days) becomes archivable+deletable on the FIRST run instead of
--   waiting a fresh 7 days. NOTE: for sold-pin rows the source still shows, last_seen_at is fresh, so
--   they are (correctly) retained.
--
-- DO $$
-- DECLARE
--   t text;
-- BEGIN
--   FOR t IN
--     SELECT tablename FROM pg_tables
--     WHERE schemaname = 'public' AND tablename ~ '_(residential|commercial)_listings$'
--   LOOP
--     EXECUTE format(
--       'UPDATE public.%I SET deactivated_at = last_seen_at '
--       'WHERE active = false AND deactivated_at IS NULL',
--       t
--     );
--   END LOOP;
-- END $$;

-- ---- OPTION C — HYBRID (COMMENTED; RECOMMENDED by the build) ----------------------------------------
--   Best of both: use the last_seen_at proxy ONLY for rows that already satisfy the mc>=3 purge gate
--   (these are genuinely confirmed-gone, so clear the real backlog on schedule), and the conservative
--   now() stamp for mc<3 rows (which cannot be purged yet anyway — buys them the full observation
--   window before they could ever qualify). This is the recommended production choice.
--
-- DO $$
-- DECLARE
--   t text;
-- BEGIN
--   FOR t IN
--     SELECT tablename FROM pg_tables
--     WHERE schemaname = 'public' AND tablename ~ '_(residential|commercial)_listings$'
--   LOOP
--     EXECUTE format(
--       'UPDATE public.%I '
--       'SET deactivated_at = CASE WHEN coalesce(missing_count,0) >= 3 THEN last_seen_at ELSE now() END '
--       'WHERE active = false AND deactivated_at IS NULL',
--       t
--     );
--   END LOOP;
-- END $$;
