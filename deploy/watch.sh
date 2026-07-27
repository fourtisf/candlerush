#!/usr/bin/env bash
#
# Candle Rush — is it actually working?
#
# A wall-clock window written for the wrong version of this game once rejected every single
# submission on this box for days. Nothing reported it. The site was up, the API answered
# /health, pm2 said online, and not one score reached the ledger. This script is the answer
# to "how would we have known".
#
#   bash deploy/watch.sh                 once, prints a report
#   bash deploy/watch.sh --quiet         prints nothing unless something is wrong
#
# As a cron, every 15 minutes, mailing only when it complains:
#   */15 * * * * cd /opt/candlerush && bash deploy/watch.sh --quiet >> /var/log/candlerush-watch.log 2>&1
#
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/candlerush}
cd "$APP_DIR" 2>/dev/null || { echo "no $APP_DIR"; exit 1; }

# Thresholds. A run being rejected is normal; most runs being rejected is not.
REJECT_WARN=${REJECT_WARN:-0.30}
MIN_SESSIONS=${MIN_SESSIONS:-5} # below this, the rate is noise rather than a signal

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

API_PORT=$(grep '^API_PORT=' deploy/ports.env 2>/dev/null | cut -d= -f2); API_PORT=${API_PORT:-4000}
TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' apps/api/.env 2>/dev/null | tail -1)
BASE="http://127.0.0.1:$API_PORT"

say()   { [ "$QUIET" = "0" ] && printf '%s\n' "$*"; return 0; }
alarm() { printf '\033[31m[%s] ALARM: %s\033[0m\n' "$(date -Is)" "$*"; }
ok()    { [ "$QUIET" = "0" ] && printf '  \033[32mok\033[0m %s\n' "$*"; return 0; }

FAILED=0

# ── is it up at all ──────────────────────────────────────────────────────────
HEALTH=$(curl -fsS -m 10 "$BASE/health" 2>/dev/null)
if [ -z "$HEALTH" ]; then
  alarm "api is not answering on $BASE/health"
  exit 1
fi
say "health  $HEALTH"
case "$HEALTH" in
  *'"ok":true'*) ok "database and redis both answering" ;;
  *) alarm "health reports a dependency down: $HEALTH"; FAILED=1 ;;
esac

# ── is scoring actually working ──────────────────────────────────────────────
if [ -z "$TOKEN" ]; then
  say ""
  say "ADMIN_TOKEN is not set in apps/api/.env, so the funnel cannot be read."
  say "Generate one and redeploy:  openssl rand -hex 24"
  exit $FAILED
fi

STATS=$(curl -fsS -m 15 -H "Authorization: Bearer $TOKEN" "$BASE/admin/stats?hours=24" 2>/dev/null)
if [ -z "$STATS" ]; then
  alarm "admin stats did not answer — wrong ADMIN_TOKEN, or the API is only half up"
  exit 1
fi

field() { printf '%s' "$STATS" | sed -n "s/.*\"$1\":\([0-9.]*\).*/\1/p" | head -1; }
STARTED=$(printf '%s' "$STATS" | sed -n 's/.*"started":\([0-9]*\).*/\1/p')
SUBMITTED=$(printf '%s' "$STATS" | sed -n 's/.*"submitted":\([0-9]*\).*/\1/p')
REJECTED=$(printf '%s' "$STATS" | sed -n 's/.*"rejected":\([0-9]*\).*/\1/p')
RATE=$(field rejectRate)
PLAYERS=$(field players)

say ""
say "last 24h"
say "  players    ${PLAYERS:-0}"
say "  started    ${STARTED:-0}"
say "  submitted  ${SUBMITTED:-0}"
say "  rejected   ${REJECTED:-0}  (rate ${RATE:-0})"
printf '%s' "$STATS" | grep -o '"rejectReasons":\[[^]]*\]' | sed 's/^/  /' | while IFS= read -r line; do say "$line"; done

# The check that matters. Everything else on this box was green while this was broken.
if [ "${STARTED:-0}" -ge "$MIN_SESSIONS" ]; then
  if awk "BEGIN{exit !(${RATE:-0} > $REJECT_WARN)}"; then
    alarm "$REJECTED of $STARTED sessions rejected in 24h (rate $RATE) — scoring is broken, not the players"
    printf '%s' "$STATS" | grep -o '"rejectReasons":\[[^]]*\]'
    FAILED=1
  else
    ok "reject rate $RATE is within tolerance"
  fi
  if [ "${SUBMITTED:-0}" = "0" ]; then
    alarm "$STARTED sessions started and not one was scored"
    FAILED=1
  fi
else
  say "  (only ${STARTED:-0} sessions — too few to judge the reject rate)"
fi

exit $FAILED
