-- engineer-automerge.yml is dispatched from the database every 15 minutes (backlog 671, 2026-10-18).
-- GitHub's own `schedule: */15` fired ONCE in the workflow's first seven hours (12:38 UTC; nothing at
-- :53, :08, :23, :38, :53, :08 — measured from the run list at 14:12), so AF's green scrapers-only PR
-- #7482 sat BEHIND for 3.7 h and merged only after a hand dispatch (run 39132786721, 13:43). The
-- repository already drives its sweeps this way (gh-aqar-sweep, gh-wasalt-res, … via
-- public.trigger_gh_workflow); the same path makes the night engineers' auto-merge independent of
-- GitHub's cron lag. Offsets :07/:22/:37/:52 so a pass lands ~9 min after a typical CI start.
select cron.schedule(
  'gh-engineer-automerge',
  '7,22,37,52 * * * *',
  $$select public.trigger_gh_workflow('engineer-automerge.yml')$$
);
