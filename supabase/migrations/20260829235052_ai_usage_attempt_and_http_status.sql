-- MIRROR of the migration applied to production on 2026-08-29 (migration-mirror rule).
--
-- Close two structural undercounts in the cost data:
--   1. An HTTP-FAILED call wrote nothing — runModel's `!res.ok` path returned before logUsage(), so a
--      402/401/5xx call (transmitted, possibly billed) left zero cost telemetry.
--   2. A RETRIED attempt was invisible — the loop retries once on 429/5xx; if attempt 0 failed and
--      attempt 1 succeeded, ONE row was written for TWO transmitted calls.
-- ai_usage therefore undercounted exactly when things were going wrong, which is when a bill spikes
-- — and the spend circuit breaker counts rows, so an undercount weakens the breaker itself.
alter table public.ai_usage add column if not exists attempt smallint not null default 1;
alter table public.ai_usage add column if not exists http_status integer;

comment on column public.ai_usage.attempt is
  'HTTP attempt number within one runModel call (the loop retries once on 429/5xx). Every transmitted attempt gets a row, so call counts are true even when calls are failing.';
comment on column public.ai_usage.http_status is
  'DeepSeek HTTP status. NULL on success-with-body; set on a failed attempt so failures are counted, not silently dropped.';
