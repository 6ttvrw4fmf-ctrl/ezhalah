# Ezhalah self-hosted Actions runner image (security plan Phase 2 — docs/ops/OWN_SERVER_RUNNERS.md).
# One container = one job (EPHEMERAL), then it is thrown away, so nothing a job leaves behind reaches the next one.
# Base: the widely used myoung34/github-runner image. setup.sh pins it BY DIGEST at install time and writes the digest
# into .env, so a re-pushed tag can never change what runs our jobs.
ARG BASE=myoung34/github-runner:ubuntu-noble
FROM ${BASE}
# What our 108 workflows expect from ubuntu-latest beyond checkout/setup-node/setup-python (measured 2026-10-21):
#   gh (48 workflows), jq, curl, git, unzip, and Playwright's system libraries (29 workflows run `playwright install`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git jq unzip xz-utils gnupg build-essential \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
