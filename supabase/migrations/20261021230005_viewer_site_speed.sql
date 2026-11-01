-- The measured speed of every site that opens INSIDE Ezhalah (owner 2026-10-21: «if it's very slowly … show this
-- open a new window … create an agent that tracks the time»).
--
-- The ad-viewer speed guard (.github/workflows/ad-viewer-speed-live.yml, every 6 h and after every deploy) frames
-- each in-app site on a phone over throttled 4G and measures how long its ad takes to show. It now writes each
-- site's median here. The app reads the slow ones (median over 5 s, measured in the last 2 days) and shows its
-- «open in a new window» button the moment such an ad opens, instead of after a wait. Measured 2026-10-21:
-- aqaralmuhaysini.com 9.2 s, dallali.com 7.8 s; Ezhalah's own ad page 47–118 ms.
--
-- Public read (a host name and a number, nothing personal); writes only with the service key the workflow holds.
create table if not exists public.viewer_site_speed (
  host text primary key,
  median_ms integer not null check (median_ms >= 0),
  samples integer not null default 0,
  measured_at timestamptz not null default now()
);
comment on table public.viewer_site_speed is
  'Median time (ms) for each in-app viewer site to show its ad inside Ezhalah, phone on throttled 4G — written by e2e/viewer/speed-live.mjs every run; the app shows «open in a new window» at once for a site over 5 s (owner 2026-10-21).';

alter table public.viewer_site_speed enable row level security;
drop policy if exists viewer_site_speed_read on public.viewer_site_speed;
create policy viewer_site_speed_read on public.viewer_site_speed for select to anon, authenticated using (true);
grant select on public.viewer_site_speed to anon, authenticated;
