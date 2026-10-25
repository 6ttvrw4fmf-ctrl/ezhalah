-- 🔧 Quality & Repair 2026-10-25 (alert scrape_suspect:0f83cc4b38b6, P3 in the repair queue): the scrape alarm
-- blocked one Phoenix / Cox residential address for 24 h at 11:50 UTC (ops_blocked_ip, enforced by robot_gate →
-- PT429 on EVERY request, the app's own included). edge_logs for that address over the same hours show a developer
-- machine, not a scraper: Mac browsers with referers http://localhost:8243/ … :8245/ and http://127.0.0.1:<port>/
-- (local dev servers), plus node, HeadlessChrome/151, Python-urllib/3.13 and curl, and an iPhone using the real app at
-- 06:00 — the owner session's replay work of 06:30–11:00 UTC (#8656, #8664, #8666 «replayed over every stored row»).
-- The alert's own action text for an own robot is to clear the block; the row is expired (not removed) so the
-- evidence stays. Identified by the alarm's reason text, so no address is written into git. The lasting fix is the
-- SCRAPE_ALARM_KNOWN_IPS repository variable (owner).
update public.ops_blocked_ip
   set blocked_until = now(),
       reason = reason || ' | expired 2026-10-25 by 🔧 QA: own machine (localhost referers, node + HeadlessChrome + Python + curl + the owner''s phone on the app); add it to SCRAPE_ALARM_KNOWN_IPS'
 where reason like 'scrape alarm: 108731 listing rows / 847 requests in the hour from 2026-10-25T06:00:00.000Z%'
   and blocked_until > now();