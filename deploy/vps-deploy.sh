#!/usr/bin/env bash
#
# Candle Rush — first-time deploy to a fresh Ubuntu/Debian VPS.
#
# Removes any previous install, provisions what is missing, builds, migrates, and puts the
# game behind nginx with TLS. Safe to re-run; use deploy/update.sh for routine redeploys,
# which does not delete anything.
#
# Usage, as root:
#   RHC_CHAIN_ID=<id> DOMAIN=candlerush.fun EMAIL=you@example.com \
#     bash deploy/vps-deploy.sh -y
#
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/candlerush}
REPO_URL=${REPO_URL:-https://github.com/fourtisf/candlerush.git}
BRANCH=${BRANCH:-claude/new-session-2pbliw}
DOMAIN=${DOMAIN:-candlerush.fun}
EMAIL=${EMAIL:-}
DB_NAME=${DB_NAME:-candlerush}
DB_USER=${DB_USER:-candlerush}
NODE_MAJOR=${NODE_MAJOR:-22}
ASSUME_YES=${ASSUME_YES:-0}
SKIP_TLS=${SKIP_TLS:-0}
# Dropping the database destroys the ledger, which is the one thing in this system that
# cannot be reconstructed. Off unless asked for explicitly.
RESET_DB=${RESET_DB:-0}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1 ;;
    --skip-tls) SKIP_TLS=1 ;;
    --reset-db) RESET_DB=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  read -r -p "  $1 [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# ── preflight ────────────────────────────────────────────────────────────────

[ "$(id -u)" = "0" ] || die "run this as root"

if [ -z "${RHC_CHAIN_ID:-}" ]; then
  die "RHC_CHAIN_ID is not set.

The API will not boot without it, deliberately. A wrong Robinhood Chain id does not fail
loudly — it silently accepts SIWE signatures that were scoped to a different network, which
means accepting a wallet signature meant for somewhere else.

Take the value from https://docs.robinhood.com/chain and re-run:
  RHC_CHAIN_ID=<id> bash deploy/vps-deploy.sh -y"
fi

say "Deploying $REPO_URL#$BRANCH to $APP_DIR for $DOMAIN"

# ── 1. previous installs ─────────────────────────────────────────────────────

say "Looking for a previous install"

FOUND=()
while IFS= read -r d; do [ -n "$d" ] && FOUND+=("$d"); done < <(
  find / -xdev -maxdepth 5 -type d \( -name candlerush -o -name candle-rush \) \
    -not -path '*/node_modules/*' -not -path '/proc/*' -not -path '/sys/*' 2>/dev/null || true
)

if command -v pm2 >/dev/null 2>&1; then
  PM2_APPS=$(pm2 jlist 2>/dev/null | grep -o '"name":"candle-rush[^"]*"' | cut -d'"' -f4 | sort -u || true)
else
  PM2_APPS=""
fi

if [ ${#FOUND[@]} -eq 0 ] && [ -z "$PM2_APPS" ]; then
  ok "nothing found — this is a clean box"
else
  for d in "${FOUND[@]}"; do warn "directory: $d ($(du -sh "$d" 2>/dev/null | cut -f1))"; done
  for a in $PM2_APPS; do warn "pm2 process: $a"; done

  if confirm "Remove all of the above?"; then
    for a in $PM2_APPS; do pm2 delete "$a" >/dev/null 2>&1 || true; done
    [ -n "$PM2_APPS" ] && { pm2 save --force >/dev/null 2>&1 || true; ok "pm2 processes removed"; }
    for d in "${FOUND[@]}"; do rm -rf "$d"; ok "removed $d"; done
  else
    die "aborted — nothing was deleted"
  fi

  if [ "$RESET_DB" = "1" ]; then
    warn "RESET_DB=1: dropping database '$DB_NAME'. The ledger goes with it."
    if confirm "Really drop the database?"; then
      su postgres -c "dropdb --if-exists $DB_NAME" || true
      ok "database dropped"
    fi
  else
    warn "database '$DB_NAME' left alone (pass --reset-db to drop it; it holds the ledger)"
  fi
fi

# ── 2. packages ──────────────────────────────────────────────────────────────

say "Installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git build-essential ufw >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

corepack enable >/dev/null 2>&1 || npm i -g corepack >/dev/null 2>&1
corepack prepare pnpm@10.33.0 --activate >/dev/null 2>&1 || npm i -g pnpm@10 >/dev/null
ok "pnpm $(pnpm -v)"

command -v pm2 >/dev/null 2>&1 || npm i -g pm2 >/dev/null
ok "pm2 $(pm2 -v 2>/dev/null | tail -1)"

apt-get install -y -qq postgresql postgresql-contrib redis-server nginx >/dev/null
systemctl enable --now postgresql redis-server nginx >/dev/null 2>&1 || true
ok "postgres, redis, nginx running"

# A Next.js production build is the memory spike on a small box. Swap is cheaper than a
# failed deploy at 3am.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  warn "${MEM_MB}MB RAM — adding a 2G swapfile so the web build does not get OOM-killed"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap enabled"
fi

# ── 3. source ────────────────────────────────────────────────────────────────

say "Cloning $BRANCH"
mkdir -p "$(dirname "$APP_DIR")"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR" >/dev/null 2>&1 \
  || die "clone failed — check REPO_URL and BRANCH"
cd "$APP_DIR"
ok "$(git -C "$APP_DIR" log --oneline -1)"

# ── 4. database ──────────────────────────────────────────────────────────────

say "Provisioning Postgres"
DB_PASS=$(openssl rand -hex 24)
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1 \
  && su postgres -c "psql -qc \"ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'\"" >/dev/null \
  || su postgres -c "psql -qc \"CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'\"" >/dev/null
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 \
  || su postgres -c "createdb -O $DB_USER $DB_NAME"
su postgres -c "psql -qc \"ALTER DATABASE $DB_NAME OWNER TO $DB_USER\"" >/dev/null
ok "database $DB_NAME owned by $DB_USER"

# ── 5. configuration ─────────────────────────────────────────────────────────

say "Writing configuration"
JWT_SECRET=$(openssl rand -hex 32)

cat > apps/api/.env <<EOF
NODE_ENV=production
PORT=4000
HOST=127.0.0.1

DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
REDIS_URL=redis://127.0.0.1:6379/0

JWT_SECRET=$JWT_SECRET
JWT_TTL_DAYS=7
COOKIE_NAME=cr_session
COOKIE_SECURE=true

CORS_ORIGINS=https://$DOMAIN
SIWE_DOMAIN=$DOMAIN
SIWE_URI=https://$DOMAIN
SIWE_STATEMENT=Sign in to Candle Rush.

RHC_CHAIN_ID=$RHC_CHAIN_ID
RHC_RPC_URL=${RHC_RPC_URL:-}

SESSION_MIN_ELAPSED_MS=80000
SESSION_MAX_ELAPSED_MS=300000
REPLAY_TIMEOUT_MS=2000
REPLAY_WORKERS=2
SESSION_START_PER_HOUR_PLAYER=20
SESSION_START_PER_HOUR_IP=60
JITTER_FLAG_MS=8
GUEST_MIGRATION_CAP=50000
EOF
chmod 600 apps/api/.env

# NEXT_PUBLIC_* are baked in at build time, so this has to exist before the web build.
cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_API_URL=https://$DOMAIN/api
NEXT_PUBLIC_SIWE_DOMAIN=$DOMAIN
NEXT_PUBLIC_SIWE_URI=https://$DOMAIN
NEXT_PUBLIC_RHC_CHAIN_ID=$RHC_CHAIN_ID
NEXT_PUBLIC_RHC_RPC_URL=${RHC_RPC_URL:-}
EOF
ok "apps/api/.env and apps/web/.env.local written (secrets generated locally)"

# ── 6. build ─────────────────────────────────────────────────────────────────

say "Installing dependencies"
pnpm install --frozen-lockfile 2>&1 | tail -3

say "Building (engine, then api, then web)"
pnpm --filter @candle-rush/engine build
pnpm --filter @candle-rush/api exec prisma generate >/dev/null
pnpm --filter @candle-rush/api build
pnpm --filter @candle-rush/web build 2>&1 | tail -8
ok "built"

# ── 7. migrate ───────────────────────────────────────────────────────────────

say "Applying migrations"
pnpm --filter @candle-rush/api exec prisma migrate deploy 2>&1 | tail -4
ok "schema is current"

# ── 8. processes ─────────────────────────────────────────────────────────────

say "Starting under pm2"
mkdir -p logs
pm2 start ecosystem.config.cjs --env production >/dev/null
pm2 save --force >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "$(pm2 jlist | grep -o '"name":"candle-rush[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')"

# ── 9. nginx and TLS ─────────────────────────────────────────────────────────

say "Configuring nginx"
sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx.conf.template > /etc/nginx/sites-available/candlerush
ln -sf /etc/nginx/sites-available/candlerush /etc/nginx/sites-enabled/candlerush
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "nginx config test failed — run 'nginx -t' to see why"
systemctl reload nginx
ok "proxying $DOMAIN to :3000, /api to :4000"

if [ "$SKIP_TLS" != "1" ]; then
  say "Issuing a certificate"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  CERTBOT_EMAIL_ARG="--register-unsafely-without-email"
  [ -n "$EMAIL" ] && CERTBOT_EMAIL_ARG="-m $EMAIL"
  if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --agree-tos --non-interactive \
       --redirect $CERTBOT_EMAIL_ARG 2>&1 | tail -5; then
    ok "https://$DOMAIN is live"
  else
    warn "certbot failed. The site is up on http://$DOMAIN — check that the A record for"
    warn "$DOMAIN points at this box and rerun: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
  fi
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q inactive; then
  warn "ufw is inactive. To close everything but ssh and web:"
  warn "  ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable"
fi

# ── 10. does it actually work ────────────────────────────────────────────────

say "Checking"
sleep 4
API_HEALTH=$(curl -fsS http://127.0.0.1:4000/health 2>/dev/null || echo '')
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || echo '000')

if [ -n "$API_HEALTH" ]; then ok "api  $API_HEALTH"; else warn "api not answering — pm2 logs candle-rush-api"; fi
if [ "$WEB_CODE" = "200" ]; then ok "web  HTTP 200"; else warn "web returned $WEB_CODE — pm2 logs candle-rush-web"; fi

printf '\n\033[1;32mDone.\033[0m  https://%s\n\n' "$DOMAIN"
cat <<EOF
  pm2 status                  what is running
  pm2 logs candle-rush-api    api logs
  bash deploy/update.sh       pull and redeploy, without touching data

  The chain id is set to $RHC_CHAIN_ID. If that was a placeholder, wallet sign-in is
  scoped to the wrong network — fix RHC_CHAIN_ID and NEXT_PUBLIC_RHC_CHAIN_ID and
  rerun deploy/update.sh before telling anyone the leaderboard means anything.
EOF
