#!/usr/bin/env bash
#
# Candle Rush — routine redeploy.
#
# Pulls, rebuilds, migrates, reloads. Touches no configuration and deletes no data, so it
# is the one to reach for after the first install. Run from the app directory:
#
#   cd /opt/candlerush && bash deploy/update.sh
#
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/candlerush}
BRANCH=${BRANCH:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR"
[ -f apps/api/.env ] || die "apps/api/.env is missing — run deploy/vps-deploy.sh first"

say "Pulling $BRANCH"
BEFORE=$(git rev-parse HEAD)
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"
ok "$(git log --oneline -1)"
[ "$BEFORE" = "$(git rev-parse HEAD)" ] && warn "already up to date — rebuilding anyway"

say "Installing and building"
pnpm install --frozen-lockfile 2>&1 | tail -3
pnpm --filter @candle-rush/engine build
pnpm --filter @candle-rush/api exec prisma generate >/dev/null
pnpm --filter @candle-rush/api build
pnpm --filter @candle-rush/web build 2>&1 | tail -6
ok "built"

say "Applying migrations"
pnpm --filter @candle-rush/api exec prisma migrate deploy 2>&1 | tail -3

# The one configuration value this script will touch, and only when it still holds the
# number written for the old single 90-second session.
#
# A run is now a ladder of 25-second levels: an 80-second floor rejects every short run as
# TOO_FAST and a 300-second ceiling rejects every deep one as TOO_SLOW, so a box that was
# first deployed before levels credits nobody at all. Anything other than the exact legacy
# pair is left alone — that is somebody's deliberate choice, not a leftover.
say "Checking replay window"
ENVF=apps/api/.env
CUR_MIN=$(sed -n 's/^SESSION_MIN_ELAPSED_MS=//p' "$ENVF" | tail -1)
CUR_MAX=$(sed -n 's/^SESSION_MAX_ELAPSED_MS=//p' "$ENVF" | tail -1)
if [ "$CUR_MIN" = "80000" ] && [ "$CUR_MAX" = "300000" ]; then
  cp -a "$ENVF" "$ENVF.bak.$(date +%Y%m%d%H%M%S)"
  sed -i 's/^SESSION_MIN_ELAPSED_MS=80000$/SESSION_MIN_ELAPSED_MS=2000/;
          s/^SESSION_MAX_ELAPSED_MS=300000$/SESSION_MAX_ELAPSED_MS=900000/' "$ENVF"
  ok "replay window widened for levels (was 80s/300s, now 2s/900s; .env backed up)"
else
  ok "replay window ${CUR_MIN:-unset}/${CUR_MAX:-unset} — left as is"
fi

# If this deploy changed gameplay, ENGINE_VERSION must have been bumped with it — a tape
# recorded against the old engine replays to garbage on the new one. Sessions still open
# across the restart are then rejected on submit with ENGINE_VERSION_MISMATCH, which is the
# correct outcome: the player loses one run, rather than the ledger gaining a fake number.
say "Reloading"
pm2 reload ecosystem.config.cjs --env production >/dev/null
pm2 save --force >/dev/null
ok "reloaded"

say "Checking"
sleep 4
# The ports the deploy actually chose, which may not be the defaults if something else on
# this box already had them.
API_PORT=$(grep '^API_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); API_PORT=${API_PORT:-4000}
WEB_PORT=$(grep '^WEB_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); WEB_PORT=${WEB_PORT:-3000}
API_HEALTH=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null || echo '')
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" 2>/dev/null || echo '000')
[ -n "$API_HEALTH" ] && ok "api  $API_HEALTH" || warn "api not answering — pm2 logs candle-rush-api"
[ "$WEB_CODE" = "200" ] && ok "web  HTTP 200" || warn "web returned $WEB_CODE — pm2 logs candle-rush-web"
printf '\n\033[1;32mDone.\033[0m\n'
