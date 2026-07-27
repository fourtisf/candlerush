#!/usr/bin/env bash
#
# Finish a deploy that already built but could not reach the database.
#
#   bash deploy/resume.sh
#
# Picks up from an existing /opt/candlerush: resets the database credentials until they
# actually work, migrates, starts pm2, configures nginx and issues the certificate.
# Nothing is rebuilt and nothing is deleted, so it is cheap to re-run.
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/candlerush}
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
SKIP_TLS=${SKIP_TLS:-0}

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root"
[ -d "$APP_DIR" ] || die "$APP_DIR does not exist — run deploy/vps-deploy.sh instead"
cd "$APP_DIR"
[ -f apps/api/.env ] || die "apps/api/.env is missing — run deploy/vps-deploy.sh instead"

DOMAIN=${DOMAIN:-$(grep '^SIWE_DOMAIN=' apps/api/.env | cut -d= -f2)}
DOMAIN=${DOMAIN:-candlerush.fun}
EMAIL=${EMAIL:-}
WEB_PORT=$(grep '^WEB_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); WEB_PORT=${WEB_PORT:-3000}
API_PORT=$(grep '^API_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); API_PORT=${API_PORT:-4000}

pgx() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtAc \"$1\"" 2>&1; }
db_ok() {
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc 'SELECT 1' >/dev/null 2>&1
}

# ── 1. make the database credentials actually work ───────────────────────────

say "Fixing database credentials"
su postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1 || die "cannot reach Postgres as the postgres user"

DB_PASS=$(openssl rand -hex 24)
pgx "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || pgx "CREATE ROLE $DB_USER LOGIN" >/dev/null
pgx "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || su postgres -c "createdb -O $DB_USER $DB_NAME" >/dev/null 2>&1
pgx "ALTER DATABASE $DB_NAME OWNER TO $DB_USER" >/dev/null 2>&1

ENC=$(pgx "SHOW password_encryption" | tr -d ' ')
ok "server hashes passwords as: $ENC"

# Try the server's own encoding, then the other one. A cluster upgraded from PG 13 or
# earlier often has pg_hba asking for scram-sha-256 while the server still writes md5,
# and the stored password is then in a form the negotiated method cannot verify.
FIXED=0
for enc in "$ENC" scram-sha-256 md5; do
  pgx "SET password_encryption = '$enc'; ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null 2>&1
  if db_ok; then ok "connected with password_encryption=$enc"; FIXED=1; break; fi
done

# Still no. The rule that would let this user in over TCP is probably not there at all.
if [ "$FIXED" = "0" ]; then
  HBA=$(su postgres -c "psql -tAc 'SHOW hba_file'" 2>/dev/null | tr -d ' ')
  [ -f "$HBA" ] || die "auth still failing and pg_hba.conf not found"
  warn "no rule lets '$DB_USER' in over TCP — adding one to $HBA"
  cp "$HBA" "$HBA.before-candlerush"
  {
    printf '# Added by Candle Rush deploy. Scoped to this database and user only.\n'
    printf 'host    %s    %s    127.0.0.1/32    scram-sha-256\n' "$DB_NAME" "$DB_USER"
    printf 'host    %s    %s    ::1/128         scram-sha-256\n' "$DB_NAME" "$DB_USER"
    cat "$HBA"
  } > /tmp/pg_hba.candlerush
  cp /tmp/pg_hba.candlerush "$HBA"
  chown postgres:postgres "$HBA"
  chmod 640 "$HBA"
  systemctl reload postgresql >/dev/null 2>&1 || su postgres -c "pg_ctlcluster $(pg_lsclusters -h | awk '{print $1, $2}' | head -1) reload" >/dev/null 2>&1
  sleep 2
  for enc in scram-sha-256 md5; do
    pgx "SET password_encryption = '$enc'; ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null 2>&1
    if db_ok; then ok "connected after adding the rule (password_encryption=$enc)"; FIXED=1; break; fi
  done
fi

if [ "$FIXED" = "0" ]; then
  ERR=$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' 2>&1 >/dev/null)
  die "still cannot connect as '$DB_USER':

  $ERR

  pg_lsclusters output:
$(pg_lsclusters 2>/dev/null | sed 's/^/    /')

  The original pg_hba.conf was saved next to it with a .before-candlerush suffix."
fi

# Write the working password into the file the API and Prisma both read.
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:$DB_PORT/$DB_NAME#" apps/api/.env
ok "apps/api/.env updated"

# ── 2. migrate ───────────────────────────────────────────────────────────────

say "Applying migrations"
pnpm --filter @candle-rush/api exec prisma migrate deploy 2>&1 | tail -4
pnpm --filter @candle-rush/api exec prisma migrate status >/dev/null 2>&1 \
  || warn "migrate status is unhappy — check the output above"

# ── 3. processes ─────────────────────────────────────────────────────────────

say "Starting under pm2"
mkdir -p logs
pm2 delete candle-rush-api candle-rush-web >/dev/null 2>&1
pm2 start ecosystem.config.cjs --env production >/dev/null || die "pm2 could not start the apps"
pm2 save --force >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "started"

# ── 4. nginx ─────────────────────────────────────────────────────────────────

say "Configuring nginx"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__WEB_PORT__/$WEB_PORT/g" -e "s/__API_PORT__/$API_PORT/g" \
  deploy/nginx.conf.template > /etc/nginx/sites-available/candlerush
ln -sf /etc/nginx/sites-available/candlerush /etc/nginx/sites-enabled/candlerush
nginx -t >/dev/null 2>&1 || die "nginx config test failed — run 'nginx -t'"
systemctl reload nginx
ok "$DOMAIN proxied to :$WEB_PORT, /api to :$API_PORT"

if [ "$SKIP_TLS" != "1" ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  say "Issuing a certificate"
  command -v certbot >/dev/null 2>&1 || apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  ARG="--register-unsafely-without-email"
  [ -n "$EMAIL" ] && ARG="-m $EMAIL"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --agree-tos --non-interactive --redirect $ARG 2>&1 | tail -4 \
    || warn "certbot failed — the site is up on http://$DOMAIN; rerun: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# ── 5. does it work ──────────────────────────────────────────────────────────

say "Checking"
sleep 5
API_HEALTH=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null || echo '')
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" 2>/dev/null || echo '000')
[ -n "$API_HEALTH" ] && ok "api  $API_HEALTH" || warn "api silent — pm2 logs candle-rush-api --lines 40"
[ "$WEB_CODE" = "200" ] && ok "web  HTTP 200" || warn "web returned $WEB_CODE — pm2 logs candle-rush-web --lines 40"

PUBLIC=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null || echo '000')
[ "$PUBLIC" = "200" ] && ok "https://$DOMAIN  HTTP 200" || warn "https://$DOMAIN returned $PUBLIC"

printf '\n\033[1;32mhttps://%s\033[0m\n\n' "$DOMAIN"
