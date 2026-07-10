-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 1 / 6
-- Add a PERMANENT deactivated_at clock to every listings table.
-- =====================================================================================================
--
-- WHY THIS COLUMN EXISTS
--   The retention clock for the 7-day purge MUST NOT be last_seen_at. Every scraper upsert stamps
--   last_seen_at = now() on any row it touches, INCLUDING sold-pinned rows the source still displays
--   (مباع/مؤجر badges). Using last_seen_at as the deletion clock therefore never elapses for those
--   rows — the exact bug the owner-locked policy (point 3) forbids. deactivated_at is a dedicated
--   timestamp that records WHEN a row became inactive and is only cleared on genuine reactivation
--   (handled by the trigger in step 2), so it is a trustworthy deletion clock.
--
-- SAFETY
--   * Pure additive DDL. Nullable, default NULL. No existing row's data changes here; no reads break.
--   * IF NOT EXISTS on every ALTER, so re-running this migration is a no-op (idempotent).
--   * Applied to EVERY public.*_(residential|commercial)_listings table via a dynamic loop so a new
--     platform table added later is the ONLY thing that would need a re-run — nothing is hardcoded.
--   * Wasalt tables are included on purpose: the column is harmless there (wasalt is excluded from the
--     purge itself), and keeping the schema uniform means the shared trigger can attach everywhere.
--
-- This migration is FILES ONLY. It is NOT applied to production by this package. No cron is touched.
-- =====================================================================================================

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
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deactivated_at timestamptz',
      t
    );
  END LOOP;
END $$;
