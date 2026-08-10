-- RLS is on by default here, so the GRANT alone left the row invisible to anon —
-- CI reads through the anon key (MCP SQL bypasses RLS and would have lied about this).
-- The row is aggregate health state: counters plus the list of offending
-- (platform, column) pairs. No listing data, no PII.
create policy mon_safety_barrier_state_read_all
  on public.mon_safety_barrier_state
  for select to anon, authenticated
  using (true);
