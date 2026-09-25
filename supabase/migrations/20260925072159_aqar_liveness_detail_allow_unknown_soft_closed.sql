-- 2026-09-25 (routine #3, data integrity) — record the UNKNOWN verdict the repaired aqar
-- soft-close oracle produces.
--
-- WHY. scrapers/aqar/liveness.py looks_closed() had stopped matching anything: its factor 1 looked
-- for server-rendered markup around «مغلق», and aqar moved the listing page to client-side
-- rendering, so the only «مغلق» left in the HTML is an i18n label bundle shipped to EVERY page,
-- live ones included. Closed ads therefore took the ALIVE branch and had last_verified_alive_at
-- written onto them (rows 874 and 882 were certified alive on 2026-09-25 while aqar served
-- closed:true with price/area/content all null).
--
-- Factor 1 now reads aqar's own `closed` flag. Deactivating on it is a BULK listing operation
-- (measured firing rate 5.3% of never-re-enriched priced rows, 4/75 sampled — order 2,500 rows),
-- which AGENTS.md puts behind owner approval, so the repaired oracle ships DISARMED and emits
-- UNKNOWN: it neither deactivates the row nor certifies it alive, per docs/ops/LISTING_LIVENESS.md.
--
-- Without this constraint change that evidence row would fail its insert, and the insert is
-- deliberately best-effort (an audit write must never roll back a sweep) — so the verdict would be
-- swallowed and the disarmed oracle would look exactly like a silent one. Additive only: the three
-- existing verdicts keep their meaning.
alter table public.aqar_liveness_detail
  drop constraint if exists aqar_liveness_detail_verdict_check;

alter table public.aqar_liveness_detail
  add constraint aqar_liveness_detail_verdict_check
  check (verdict = any (array['strike'::text, 'kill'::text, 'transient'::text,
                              'unknown_soft_closed'::text]));
