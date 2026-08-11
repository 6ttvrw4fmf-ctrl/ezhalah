-- Registry addendum: three more platforms whose period parsers PROVABLY read the source and store
-- NULL only when the source states nothing (audit trail 2026-08-11): eaqartabuk (mixed 108∅/3شهري/3سنوي,
-- token-read), mustqr (mixed 80/69/10∅, source-read), dealapp (badge-only parser since the 2026-08-05
-- P0 fix; 26∅ rows are badge-less ads). Their NULLs are honest-unknown, not defects. aqar and october
-- are deliberately NOT here: aqar's 94 periodless rows are the known stub-capture defect (re-enrich in
-- progress) and october is unaudited — mon_detect_rent_period_unreachable keeps paging on both.
insert into ops_rent_period_sourceless(platform, reason) values
  ('eaqartabuk','audit 2026-08-11: token-reading parser; NULL = source states no period'),
  ('mustqr','audit 2026-08-11: source-read periods (mixed vocabulary); NULL = source silent'),
  ('dealapp','badge-only parser since 2026-08-05 P0 fix; NULL = no «إيجار سنوي/شهري» badge on ad')
on conflict (platform) do nothing;
