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
SELF_BEFORE=$(git rev-parse "HEAD:deploy/update.sh" 2>/dev/null || echo none)
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"
ok "$(git log --oneline -1)"
[ "$BEFORE" = "$(git rev-parse HEAD)" ] && warn "already up to date — rebuilding anyway"

# This script has just overwritten itself.
#
# Bash reads a script incrementally from a byte offset, so replacing the file underneath a
# running one means the rest of this run is whatever happens to sit at that offset in the
# new file. In practice the old logic finished — which is how a deploy that shipped a wider
# replay window went on to report the old one "left as is", and why the ceiling on this box
# was still the number written for a shorter game.
#
# So: if the script changed, hand over to the new one and let it start from the top. The
# pull is already done, and CR_UPDATE_REEXEC stops the handover from happening twice.
SELF_AFTER=$(git rev-parse "HEAD:deploy/update.sh" 2>/dev/null || echo none)
if [ "$SELF_BEFORE" != "$SELF_AFTER" ] && [ -z "${CR_UPDATE_REEXEC:-}" ]; then
  ok "deploy/update.sh changed in this pull — restarting with the new one"
  export CR_UPDATE_REEXEC=1
  exec bash "$APP_DIR/deploy/update.sh" "$@"
fi

# NEXT_PUBLIC_* are baked into the bundle at build time, so publishing the contract address
# is a rebuild rather than a restart. Set it on the command line and this writes it in:
#
#   CONTRACT_ADDRESS=0xabc… bash deploy/update.sh
#
# Left unset, whatever is already in .env.local stands — and if that is empty too, the
# opening screen reads COMING SOON, which is the honest answer until there is a token.
WEBENV=apps/web/.env.local
upsert() { # key value file
  if grep -q "^$1=" "$3" 2>/dev/null; then
    sed -i "s#^$1=.*#$1=$2#" "$3"
  else
    printf '%s=%s\n' "$1" "$2" >> "$3"
  fi
}
if [ -f "$WEBENV" ]; then
  DOMAIN_GUESS=$(sed -n 's#^NEXT_PUBLIC_SIWE_URI=##p' "$WEBENV" | tail -1)
  [ -n "${DOMAIN_GUESS:-}" ] && upsert NEXT_PUBLIC_SITE_URL "$DOMAIN_GUESS" "$WEBENV"
  if [ -n "${CONTRACT_ADDRESS:-}" ]; then
    upsert NEXT_PUBLIC_CONTRACT_ADDRESS "$CONTRACT_ADDRESS" "$WEBENV"
    ok "contract address set to $CONTRACT_ADDRESS"
  fi
fi

# Deployed before /admin/stats existed, so there is no token and the funnel cannot be read
# — which is the state this box was in while it rejected every run for days.
if [ -f apps/api/.env ] && ! grep -q '^ADMIN_TOKEN=' apps/api/.env; then
  printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 24)" >> apps/api/.env
  ok "minted an ADMIN_TOKEN — deploy/watch.sh can now read the funnel"
fi

say "Installing and building"
pnpm install --frozen-lockfile 2>&1 | tail -3
pnpm --filter @candle-rush/engine build
pnpm --filter @candle-rush/api exec prisma generate >/dev/null
pnpm --filter @candle-rush/api build
pnpm --filter @candle-rush/web build 2>&1 | tail -6
ok "built"

say "Applying migrations"
pnpm --filter @candle-rush/api exec prisma migrate deploy 2>&1 | tail -3

# The one configuration value this script will touch, and only when it holds a number
# written for a shorter game than the one now installed.
#
# This has bitten twice. The original 80s/300s pair was written for a single 90-second
# session: under levels it rejected every short run as TOO_FAST and every deep one as
# TOO_SLOW, and the box credited nobody for days without saying so. The 900s ceiling that
# replaced it was written for a fifteen-level ladder; thirty levels is 990 seconds of play,
# so it would have done the same thing again to exactly the players who earned the most.
#
# Anything that is not one of those two known-stale values is left alone — that is
# somebody's deliberate choice, not a leftover.
say "Checking replay window"
ENVF=apps/api/.env
CUR_MIN=$(sed -n 's/^SESSION_MIN_ELAPSED_MS=//p' "$ENVF" | tail -1)
CUR_MAX=$(sed -n 's/^SESSION_MAX_ELAPSED_MS=//p' "$ENVF" | tail -1)
WANT_MIN=2000
WANT_MAX=1800000
CHANGED=0
backup_env() { [ "$CHANGED" = "0" ] && cp -a "$ENVF" "$ENVF.bak.$(date +%Y%m%d%H%M%S)"; CHANGED=1; }

if [ "${CUR_MIN:-}" = "80000" ]; then
  backup_env
  sed -i "s/^SESSION_MIN_ELAPSED_MS=80000$/SESSION_MIN_ELAPSED_MS=$WANT_MIN/" "$ENVF"
  ok "floor 80s -> ${WANT_MIN}ms (it was rejecting every run that ended early)"
fi
case "${CUR_MAX:-}" in
  300000|900000)
    backup_env
    sed -i "s/^SESSION_MAX_ELAPSED_MS=$CUR_MAX\$/SESSION_MAX_ELAPSED_MS=$WANT_MAX/" "$ENVF"
    ok "ceiling ${CUR_MAX}ms -> ${WANT_MAX}ms (a thirty-level run is 990s of play)"
    ;;
esac
[ "$CHANGED" = "0" ] && ok "replay window ${CUR_MIN:-unset}/${CUR_MAX:-unset} — left as is"

# A cold worker's first replay of a full-length run measured 750ms. Two seconds was set for
# a game a third of this length.
CUR_TO=$(sed -n 's/^REPLAY_TIMEOUT_MS=//p' "$ENVF" | tail -1)
if [ "${CUR_TO:-}" = "2000" ]; then
  sed -i 's/^REPLAY_TIMEOUT_MS=2000$/REPLAY_TIMEOUT_MS=5000/' "$ENVF"
  ok "replay timeout 2s -> 5s"
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
# The ports the deploy actually chose, which may not be the defaults if something else on
# this box already had them.
API_PORT=$(grep '^API_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); API_PORT=${API_PORT:-4000}
WEB_PORT=$(grep '^WEB_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); WEB_PORT=${WEB_PORT:-3000}

# Prisma's client init and the replay worker pool take a moment. A single four-second sleep
# reported a healthy API as down often enough to be worse than useless.
API_HEALTH=''
for _ in $(seq 1 15); do
  API_HEALTH=$(curl -fsS -m 3 "http://127.0.0.1:$API_PORT/health" 2>/dev/null || echo '')
  [ -n "$API_HEALTH" ] && break
  sleep 2
done
WEB_CODE=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" 2>/dev/null || echo '000')

if [ -n "$API_HEALTH" ]; then
  ok "api  $API_HEALTH"
else
  warn "api still not answering after 30s — the reason, from its own log:"
  pm2 logs candle-rush-api --lines 25 --nostream --err 2>/dev/null | tail -25 | sed 's/^/    /'
fi
[ "$WEB_CODE" = "200" ] && ok "web  HTTP 200" || warn "web returned $WEB_CODE — pm2 logs candle-rush-web"

if [ -z "$API_HEALTH" ]; then
  printf '\n\033[31mDeployed, but the API is down. Nothing will be scored until it is up.\033[0m\n'
  exit 1
fi
printf '\n\033[1;32mDone.\033[0m\n'
