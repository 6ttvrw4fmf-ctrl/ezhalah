-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 5 / 6
-- Create the archive table that MUST receive a full copy of every row before it is ever hard-deleted.
-- =====================================================================================================
--
-- POLICY (points 6 & 7): NEVER hard-delete a listing without first copying the FULL row here.
--   row_data holds to_jsonb(the entire source row) so the deletion is fully reversible/auditable —
--   REGA/PDPL retention questions, dispute resolution, or a re-ingest can all be served from this table.
--   listing_id + source_table let you find a specific archived listing fast; deleted_at supports
--   time-window retention reporting later. deletion_reason records WHY the row was purged.
--
-- Columns match the owner spec exactly. id/source_table/listing_id/row_data/deleted_at/deletion_reason
-- are NOT NULL so an archive row can never be written half-populated; missing_count and deactivated_at
-- are nullable because they are diagnostic snapshots of the source row at deletion time.
--
-- IDEMPOTENT: CREATE TABLE / CREATE INDEX IF NOT EXISTS. No data is touched.
-- FILES ONLY. Not applied.
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS public.purged_listings_archive (
  id              bigserial   PRIMARY KEY,
  source_table    text        NOT NULL,   -- e.g. 'aqar_residential_listings'
  listing_id      bigint      NOT NULL,   -- the source row's surrogate id (public.<table>.id)
  row_data        jsonb       NOT NULL,   -- to_jsonb(full source row) — complete, reversible snapshot
  missing_count   int,                    -- source row's missing_count at deletion time
  deactivated_at  timestamptz,            -- source row's deletion clock at deletion time
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  deletion_reason text        NOT NULL    -- e.g. '7d-confirmed-inactive'
);

-- Fast lookup of a specific archived listing (non-unique: a listing_id can recur if a source row is
-- purged, re-ingested with the same surrogate id, and purged again in a later cycle).
CREATE INDEX IF NOT EXISTS purged_listings_archive_src_lid_idx
  ON public.purged_listings_archive (source_table, listing_id);

-- Time-window retention/reporting.
CREATE INDEX IF NOT EXISTS purged_listings_archive_deleted_at_idx
  ON public.purged_listings_archive (deleted_at);
