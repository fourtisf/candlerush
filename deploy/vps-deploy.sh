#!/usr/bin/env bash
#
# Candle Rush — first-time deploy to a fresh Ubuntu/Debian VPS.
#
# Removes any previous install, provisions what is missing, builds, migrates, and puts the
# game behind nginx with TLS. Safe to re-run; use deploy/update.sh for routine redeploys,
# which does not delete anything.
#
# Usage, as root:
#   RHC_CHAIN_ID=YOUR_CHAIN_ID DOMAIN=candlerush.fun EMAIL=you@example.com \
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
# Debian numbers a second cluster 5433, and `su postgres -c psql` hides that because the
# Debian psql wrapper resolves the default cluster's port for you. A TCP connection does
# not, so assuming 5432 means testing against whatever else happens to be on 5432 —
# on this box, a different Postgres that has never heard of our role.
detect_pg_port() {
  local p
  p=$(pg_lsclusters -h 2>/dev/null | awk '$4 == "online" {print $3; exit}')
  [ -n "$p" ] && printf '%s' "$p" || printf '5432'
}
DB_PORT=${DB_PORT:-$(detect_pg_port)}
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

Take the value from https://docs.robinhood.com/chain and re-run, substituting the number
(no angle brackets — bash reads < and > as redirection and will fail before this script
even starts):
  RHC_CHAIN_ID=42161 bash deploy/vps-deploy.sh -y"
fi

WEB_PORT=${WEB_PORT:-3000}
API_PORT=${API_PORT:-4000}
REDIS_DB=${REDIS_DB:-}

port_taken() {
  if command -v ss >/dev/null 2>&1; then ss -tlnH 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  elif command -v netstat >/dev/null 2>&1; then netstat -tln 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  else return 1; fi
}

pick_port() {
  local want=$1 p=$1
  while port_taken "$p"; do p=$((p + 1)); done
  [ "$p" != "$want" ] && warn "port $want is already in use — using $p instead" >&2
  printf '%s' "$p"
}

say "Deploying $REPO_URL#$BRANCH to $APP_DIR for $DOMAIN"

# ── 0. who else lives here ───────────────────────────────────────────────────
# This box may already host other production apps. Everything below is scoped by name,
# and the ports and Redis database are chosen around whatever is already running.

say "Checking what else is on this box"
NEIGHBOURS=0
if command -v pm2 >/dev/null 2>&1; then
  OTHER=$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort -u | grep -v '^candle-rush' || true)
  [ -n "$OTHER" ] && { NEIGHBOURS=1; for a in $OTHER; do warn "pm2 app: $a"; done; }
fi
OTHERNG=$(ls -1 /etc/nginx/sites-enabled 2>/dev/null | grep -v -i candle || true)
[ -n "$OTHERNG" ] && { NEIGHBOURS=1; for n in $OTHERNG; do warn "nginx site: $n"; done; }
if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1 \
   && su postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
  OTHERDB=$(su postgres -c "psql -tAc \"SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','$DB_NAME')\"" 2>/dev/null)
  [ -n "$OTHERDB" ] && { NEIGHBOURS=1; for d in $OTHERDB; do warn "database: $d"; done; }
fi
if [ "$NEIGHBOURS" = "1" ]; then
  warn "this deploy will not touch any of the above"
else
  ok "nothing else hosted here"
fi

WEB_PORT=$(pick_port "$WEB_PORT")
API_PORT=$(pick_port "$API_PORT")
ok "web on :$WEB_PORT, api on :$API_PORT"

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

CURRENT_NODE=$(node -v 2>/dev/null || echo none)
if [ "$CURRENT_NODE" != "none" ] && [ "$(echo "$CURRENT_NODE" | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  warn "node $CURRENT_NODE is installed and will be replaced by $NODE_MAJOR.x."
  warn "Anything else on this box running on $CURRENT_NODE will be moved with it."
  confirm "Upgrade node to $NODE_MAJOR.x?" || die "aborted — set NODE_MAJOR to match, or upgrade manually"
fi
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

# ON_ERROR_STOP, because psql exits 0 on a failed statement by default — without it a
# CREATE ROLE that errored looks exactly like one that worked, and the failure only
# surfaces minutes later as an authentication error.
pgx() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtAc \"$1\"" 2>&1; }

if pgx "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  pgx "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null \
    || die "could not set the password on the existing role $DB_USER"
else
  pgx "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null \
    || die "could not create the role $DB_USER"
fi
if ! pgx "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  su postgres -c "createdb -O $DB_USER $DB_NAME" || die "could not create the database $DB_NAME"
fi
pgx "ALTER DATABASE $DB_NAME OWNER TO $DB_USER" >/dev/null
ok "database $DB_NAME owned by $DB_USER"

# Prove the credentials work over TCP before three minutes of building depend on them.
# This is where a pre-existing Postgres with a hand-edited pg_hba.conf shows up, and the
# error it produces at migration time ("provide valid database credentials") says nothing
# about which of the several possible causes it is.
db_reachable() {
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc 'SELECT 1' 2>&1 >/dev/null
}

PGCONN_ERR=$(db_reachable) || {
  # Most common cause on a cluster that predates this deploy: pg_hba.conf asks for
  # scram-sha-256 while the server still hashes new passwords as md5 (or the reverse),
  # usually because the cluster was upgraded from PG 13 or earlier and only one of the two
  # settings was moved. The password is then stored in a form the negotiated method cannot
  # verify. Re-hash it the other way and try once more before giving up.
  CURRENT_ENC=$(pgx "SHOW password_encryption" | tr -d ' ')
  OTHER_ENC=$([ "$CURRENT_ENC" = "md5" ] && echo "scram-sha-256" || echo "md5")
  warn "auth failed with password_encryption=$CURRENT_ENC — retrying as $OTHER_ENC"
  pgx "SET password_encryption = '$OTHER_ENC'; ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS'" >/dev/null 2>&1
  PGCONN_ERR=$(db_reachable) && ok "connected after re-hashing the password as $OTHER_ENC"
}
[ -n "${PGCONN_ERR:-}" ] && {
  HBA=$(ls /etc/postgresql/*/main/pg_hba.conf 2>/dev/null | head -1)
  die "the role and database exist, but connecting as '$DB_USER' over TCP fails:

  $PGCONN_ERR

This box had Postgres before this deploy, so pg_hba.conf is not necessarily the default.
Check that it allows password auth from localhost:

  grep -v '^#' $HBA | grep -v '^\$'

It needs a line like this ABOVE any conflicting rule, then 'systemctl reload postgresql':

  host    $DB_NAME    $DB_USER    127.0.0.1/32    scram-sha-256
  host    $DB_NAME    $DB_USER    ::1/128         scram-sha-256

If Postgres is not on port $DB_PORT (check with 'pg_lsclusters'), re-run with DB_PORT set."
}
ok "connected as $DB_USER over TCP on port $DB_PORT"

# ── 5. configuration ─────────────────────────────────────────────────────────

say "Writing configuration"
JWT_SECRET=$(openssl rand -hex 32)

# Pick an empty Redis database. Candle Rush's keys are prefixed (player:, lb:, siwe:, rl:)
# so a collision is unlikely, but sharing db 0 with another app means one FLUSHDB takes
# out both. An empty database of its own costs nothing.
if [ -z "$REDIS_DB" ]; then
  REDIS_DB=0
  if command -v redis-cli >/dev/null 2>&1; then
    for i in $(seq 0 15); do
      n=$(redis-cli -n "$i" dbsize 2>/dev/null | awk '{print $1}')
      if [ "${n:-0}" = "0" ]; then REDIS_DB=$i; break; fi
    done
  fi
fi
ok "redis database $REDIS_DB"

cat > apps/api/.env <<EOF
NODE_ENV=production
PORT=$API_PORT
HOST=127.0.0.1

DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:$DB_PORT/$DB_NAME
REDIS_URL=redis://127.0.0.1:6379/$REDIS_DB

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

# pm2 reads these on every reload, so a restart months from now still lands on the ports
# nginx is proxying to.
cat > deploy/ports.env <<EOF
WEB_PORT=$WEB_PORT
API_PORT=$API_PORT
EOF

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
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__WEB_PORT__/$WEB_PORT/g" -e "s/__API_PORT__/$API_PORT/g" \
  deploy/nginx.conf.template > /etc/nginx/sites-available/candlerush
ln -sf /etc/nginx/sites-available/candlerush /etc/nginx/sites-enabled/candlerush
# The default site is deliberately left in place. On a shared box another app may BE the
# default site, and removing it would take that app offline. Candle Rush matches on
# server_name, so it does not need the default slot.
if [ -e /etc/nginx/sites-enabled/default ]; then
  warn "sites-enabled/default left alone — remove it yourself if nothing else uses it"
fi
nginx -t >/dev/null 2>&1 || die "nginx config test failed — run 'nginx -t' to see why"
systemctl reload nginx
ok "proxying $DOMAIN to :$WEB_PORT, /api to :$API_PORT"

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
  warn "ufw is inactive. Before enabling it, check nothing else on this box serves a port"
  warn "directly — enabling with only ssh and web open would cut those off:"
  warn "  ss -tlnp        # see what is listening"
  warn "  ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable"
fi

# ── 10. does it actually work ────────────────────────────────────────────────

say "Checking"
sleep 4
API_HEALTH=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null || echo '')
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" 2>/dev/null || echo '000')

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
