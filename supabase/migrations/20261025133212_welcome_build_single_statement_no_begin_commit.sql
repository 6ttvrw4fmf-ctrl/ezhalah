-- 🔧 Quality & Repair 2026-10-25: the welcome-facts cron job (jobid 185, build-welcome-insights, «45 */3») is the
-- ONLY cron command that opens an explicit transaction block (BEGIN … COMMIT), and every pg_cron «job startup
-- timeout» of the last 72 h (7 of 7: jobs 29, 44, 141, 174 at 00:45, 06:45, 09:45 and 12:45) fell inside its
-- 103–153 s run and ended at the exact second its last statement returned (12:46:42.85 build end, 12:46:42.87
-- four failures). The launcher sits on the open transaction's results and the jobs scheduled in the same minute
-- never get started. Jobs 17 and 28 (many long statements, no BEGIN) never show the pattern. So the three calls
-- move into ONE function and the command becomes «SET; SET; SELECT» — the same shape as job 29, which has never
-- frozen anything. Repeatable read is kept through default_transaction_isolation for the single SELECT's implicit
-- transaction; verify_welcome_insights() now runs inside that transaction and sees the same rows it saw before.
-- Previous command, for a byte-exact rollback with cron.alter_job(185, command => …):
--   set statement_timeout to '900s'; begin isolation level repeatable read; select public.build_welcome_insights();
--   select public.audit_welcome_insights(); commit; select public.verify_welcome_insights();
-- Proof: the next run (15:45 UTC) completes with 0 «job startup timeout» rows in cron.job_run_details for that
-- minute; the facts build/check/audit rows for the day still land.

create or replace function public.run_welcome_build()
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare built integer; audited jsonb; verified jsonb;
begin
  built := public.build_welcome_insights();
  audited := public.audit_welcome_insights();
  verified := public.verify_welcome_insights();
  return jsonb_build_object('built', built, 'audit', audited, 'verify', verified);
end;
$$;

comment on function public.run_welcome_build() is
  'One statement for cron job 185: build + audit + verify the welcome facts inside one repeatable-read transaction (the cron command sets default_transaction_isolation). Replaced the BEGIN…COMMIT command that froze the pg_cron launcher for the length of the build (🔧 2026-10-25).';

select cron.alter_job(185, command => $c$set statement_timeout to '900s'; set default_transaction_isolation to 'repeatable read'; select public.run_welcome_build();$c$);