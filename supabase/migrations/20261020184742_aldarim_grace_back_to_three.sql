-- aldarim back to grace 3 (correction to 20261020183753): it is a FLEET_DAILY_DIRECT site, whose daily
-- revisit hides a listing on three direct readings (test_fleet_liveness pins grace 3 for that tier). sakan keeps
-- grace 1 (owner 2026-10-20 «once we see it, remove it»).
update public.ops_liveness_registry set grace = 3 where platform = 'aldarim';
