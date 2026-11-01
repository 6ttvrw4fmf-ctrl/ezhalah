#!/usr/bin/env bash
# Ezhalah runner host setup — run ONCE, as root, on a fresh Ubuntu 24.04 server (Hetzner AX102 recommended).
# Full guide, trial checklist and rollback: docs/ops/OWN_SERVER_RUNNERS.md. Nothing here touches GitHub settings:
# jobs move only when the owner sets the repo variable EZ_RUNNER=ezhalah-own, and move back when it is deleted.
#   usage:  OWNER_IP=<your home IP> bash setup.sh
set -euo pipefail
: "${OWNER_IP:?set OWNER_IP to the one address allowed to SSH in}"

# 1. Updates + automatic security updates.
apt-get update && apt-get -y upgrade
apt-get install -y unattended-upgrades ufw fail2ban docker.io docker-compose-v2 git
dpkg-reconfigure -f noninteractive unattended-upgrades

# 2. Firewall: nothing comes in except SSH from the owner's address. Runners only make OUTBOUND https calls.
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$OWNER_IP" to any port 22 proto tcp
ufw --force enable

# 3. SSH: keys only, no root password login.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# 4. The runner token: a fine-grained GitHub token limited to THIS repo, permission "Administration: read and write"
#    (that is what registering a runner needs), 90-day expiry. Stored root-only, never in git.
install -d -m 700 /opt/ezhalah-runner
if [ ! -f /opt/ezhalah-runner/.env ]; then
  read -r -s -p "Paste the fine-grained GitHub token: " PAT; echo
  BASE_DIGEST=$(docker pull -q myoung34/github-runner:ubuntu-noble >/dev/null && docker inspect --format '{{index .RepoDigests 0}}' myoung34/github-runner:ubuntu-noble)
  umask 077
  printf 'GH_RUNNER_PAT=%s\nBASE_IMAGE=%s\nRUNNERS=12\nCPUS_PER_RUNNER=2.5\nMEM_PER_RUNNER=9g\n' "$PAT" "$BASE_DIGEST" > /opt/ezhalah-runner/.env
fi
cp Dockerfile docker-compose.yml /opt/ezhalah-runner/

# 5. Build and start. `docker compose ps` should show 12 runners; GitHub → Settings → Actions → Runners shows them Idle.
cd /opt/ezhalah-runner
docker compose --env-file .env up -d --build
docker compose ps
echo "Runners started. Nothing uses them until the repo variable EZ_RUNNER=ezhalah-own is set (see the guide)."
