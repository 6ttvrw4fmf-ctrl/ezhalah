# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Deploy rule (P0, non-negotiable — 2026-07-09)

If it's visible to users, it must be committed, pushed, and merged to `main` before it's ever
deployed. Never deploy a dirty or unpushed local working tree to production, even to "quickly fix"
something — that exact shortcut caused a P0 UI-rollback incident on 2026-07-09 (full story, pre-deploy
checklist, and emergency rollback procedure: `docs/DEPLOY_SAFETY.md`).

**Never run `vercel --prod` directly. Always run `scripts/safe-deploy.sh` instead** — it refuses to
deploy unless you're on `main`, the working tree is 100% clean, and local `main` matches
`origin/main` exactly. If it refuses, fix the underlying git state (commit → push → PR → merge) —
do not bypass it.
