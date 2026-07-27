#!/usr/bin/env bash
#
# Candle Rush — leftover audit.
#
# Read-only. Reports every trace a previous install could have left behind and deletes
# nothing, so it is safe to run on a live box. Everything it finds that you want gone has
# a matching removal command printed at the end.
#
#   bash deploy/audit.sh
#
# Note the two it deliberately treats as "keep unless you mean it": the Postgres database
# holds the ledger, and the ledger is the one thing in this system that cannot be
# rebuilt from anything else.

DOMAIN=${DOMAIN:-candlerush.fun}
DB_NAME=${DB_NAME:-candlerush}

hdr()  { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
none() { printf '  \033[32mnone\033[0m\n'; }
hit()  { printf '  \033[33m%s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

FOUND_ANY=0
mark() { FOUND_ANY=1; }

hdr "1. Directories"
DIRS=$(find / -xdev -maxdepth 6 -type d \( -name 'candlerush' -o -name 'candle-rush' -o -name 'cr-bootstrap' \) \
        -not -path '*/node_modules/*' -not -path '/proc/*' -not -path '/sys/*' 2>/dev/null)
if [ -n "$DIRS" ]; then
  mark
  while IFS= read -r d; do hit "$d  ($(du -sh "$d" 2>/dev/null | cut -f1))"; done <<< "$DIRS"
else
  none
fi

hdr "2. Stray files matching *candlerush*"
FILES=$(find / -xdev -maxdepth 6 -type f -iname '*candlerush*' \
         -not -path '*/node_modules/*' -not -path '/proc/*' -not -path '/sys/*' 2>/dev/null | head -40)
if [ -n "$FILES" ]; then mark; while IFS= read -r f; do hit "$f"; done <<< "$FILES"; else none; fi

hdr "3. pm2 processes"
if have pm2; then
  APPS=$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort -u)
  if [ -n "$APPS" ]; then mark; while IFS= read -r a; do hit "$a"; done <<< "$APPS"; else none; fi
  DUMP=/root/.pm2/dump.pm2
  [ -s "$DUMP" ] && { mark; hit "saved process list: $DUMP"; }
else
  printf '  pm2 not installed\n'
fi

hdr "4. Listening ports (3000 web, 4000 api, 5432 pg, 6379 redis)"
if have ss; then LISTEN=$(ss -tlnp 2>/dev/null)
elif have netstat; then LISTEN=$(netstat -tlnp 2>/dev/null)
elif have lsof; then LISTEN=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null)
else LISTEN=''; fi
if [ -z "$LISTEN" ]; then
  printf '  no ss, netstat or lsof — cannot check\n'
else
  PORTS=$(printf '%s' "$LISTEN" | grep -E '[:.](3000|4000|5432|6379)\b')
  if [ -n "$PORTS" ]; then mark; while IFS= read -r p; do hit "$p"; done <<< "$PORTS"; else none; fi
fi

hdr "5. nginx sites"
NG=$(ls -1 /etc/nginx/sites-available 2>/dev/null | grep -i -E 'candle|rush' ; \
     ls -1 /etc/nginx/sites-enabled 2>/dev/null | grep -i -E 'candle|rush')
if [ -n "$NG" ]; then mark; while IFS= read -r n; do hit "$n"; done <<< "$NG"; else none; fi

hdr "6. systemd units"
# Anchored: an unanchored 'pm2' also matches systemd-tpm2-setup.service.
SD=$(systemctl list-unit-files 2>/dev/null | awk '{print $1, $2}' | grep -E '^(pm2-|candle)')
if [ -n "$SD" ]; then mark; while IFS= read -r s; do hit "$s"; done <<< "$SD"; else none; fi

hdr "7. Postgres databases and roles"
if ! have psql || ! id postgres >/dev/null 2>&1; then
  printf '  postgres not installed\n'
elif ! su postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
  printf '  \033[33mpostgres is installed but not answering — cannot tell what is in it\033[0m\n'
  printf '    check: systemctl status postgresql\n'
  mark
else
  DBS=$(su postgres -c "psql -tAc \"SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')\"" 2>/dev/null)
  ROLES=$(su postgres -c "psql -tAc \"SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname <> 'postgres'\"" 2>/dev/null)
  if [ -n "$DBS" ]; then
    while IFS= read -r d; do
      [ -z "$d" ] && continue
      mark
      ROWS=$(su postgres -c "psql -tAd '$d' -c \"SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables\"" 2>/dev/null)
      hit "database: $d  (~${ROWS:-0} rows — KEEP unless you mean to lose the ledger)"
    done <<< "$DBS"
  else
    none
  fi
  [ -n "$ROLES" ] && while IFS= read -r r; do [ -n "$r" ] && hit "role: $r"; done <<< "$ROLES"
fi

hdr "8. Redis keys"
if have redis-cli; then
  SIZE=$(redis-cli dbsize 2>/dev/null | awk '{print $1}')
  CR=$(redis-cli --scan --pattern 'lb:*' 2>/dev/null | head -5; redis-cli --scan --pattern 'player:*' 2>/dev/null | head -5)
  if [ -n "$CR" ]; then mark; while IFS= read -r k; do [ -n "$k" ] && hit "$k"; done <<< "$CR"
  else printf '  no candle-rush keys (db has %s keys total)\n' "${SIZE:-0}"; fi
else
  printf '  redis not installed\n'
fi

hdr "9. TLS certificates"
if have certbot; then
  CERTS=$(certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry' | sed 's/^ *//')
  if [ -n "$CERTS" ]; then mark; while IFS= read -r c; do hit "$c"; done <<< "$CERTS"; else none; fi
else
  printf '  certbot not installed\n'
fi

hdr "10. Cron entries"
CRON=$(crontab -l 2>/dev/null | grep -i -E 'candle|rush')
if [ -n "$CRON" ]; then mark; while IFS= read -r c; do hit "$c"; done <<< "$CRON"; else none; fi

hdr "Neighbours on this box"
# This machine may host other production apps. Anything that is not Candle Rush is listed
# here so it is visible BEFORE the removal commands below, which are all scoped to
# Candle Rush by name for exactly that reason.
NEIGHBOURS=0
if have pm2; then
  OTHER=$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort -u | grep -v '^candle-rush' || true)
  [ -n "$OTHER" ] && { NEIGHBOURS=1; while IFS= read -r a; do hit "pm2: $a"; done <<< "$OTHER"; }
fi
OTHERNG=$(ls -1 /etc/nginx/sites-enabled 2>/dev/null | grep -v -i -E 'candle|rush' || true)
[ -n "$OTHERNG" ] && { NEIGHBOURS=1; while IFS= read -r n; do hit "nginx site: $n"; done <<< "$OTHERNG"; }
if have psql && id postgres >/dev/null 2>&1 && su postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
  OTHERDB=$(su postgres -c "psql -tAc \"SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','$DB_NAME')\"" 2>/dev/null)
  [ -n "$OTHERDB" ] && { NEIGHBOURS=1; while IFS= read -r d; do [ -n "$d" ] && hit "database: $d"; done <<< "$OTHERDB"; }
fi
if have redis-cli; then
  for i in $(seq 0 15); do
    n=$(redis-cli -n "$i" dbsize 2>/dev/null | awk '{print $1}')
    [ -n "$n" ] && [ "$n" != "0" ] && { NEIGHBOURS=1; hit "redis db$i: $n keys"; }
  done
fi
[ "$NEIGHBOURS" = "0" ] && printf '  nothing else appears to be hosted here\n'

hdr "Summary"
if [ "$FOUND_ANY" = "0" ]; then
  printf '  \033[32mNo Candle Rush leftovers.\033[0m\n\n'
else
  cat <<EOF
  Candle Rush leftovers above. Every command below names Candle Rush explicitly, because
  this box may host other apps and a blanket command would take them with it:

    pm2 delete candle-rush-api candle-rush-web 2>/dev/null; pm2 save --force
    rm -rf /opt/candlerush /root/candlerush /var/www/candlerush /tmp/cr-bootstrap
    rm -f /etc/nginx/sites-enabled/candlerush /etc/nginx/sites-available/candlerush
    nginx -t && systemctl reload nginx

  DO NOT use the blanket versions of those on this machine:
    pm2 delete all        kills every other app's processes too
    redis-cli FLUSHALL    wipes every other app's Redis data
    rm -f /etc/nginx/sites-enabled/default   another app may BE the default site

  Not included, and not "leftover files":

    the Postgres database — balance is the sum of an append-only ledger and nothing else
    can rebuild it. Only if you mean to:
      su postgres -c "dropdb --if-exists $DB_NAME"
      su postgres -c "dropuser --if-exists $DB_NAME"

    the TLS certificate — reissuing burns Let's Encrypt rate limits (5 per domain per
    week) and a redeploy reuses it:
      certbot delete --cert-name $DOMAIN

  Candle Rush's Redis keys are prefixed, so they can be cleared without touching a
  co-hosted app (\$REDIS_DB defaults to the db the API was configured with):
      redis-cli -n \${REDIS_DB:-0} --scan --pattern 'lb:*'     | xargs -r redis-cli -n \${REDIS_DB:-0} del
      redis-cli -n \${REDIS_DB:-0} --scan --pattern 'player:*' | xargs -r redis-cli -n \${REDIS_DB:-0} del
      redis-cli -n \${REDIS_DB:-0} --scan --pattern 'siwe:*'   | xargs -r redis-cli -n \${REDIS_DB:-0} del
      redis-cli -n \${REDIS_DB:-0} --scan --pattern 'rl:*'     | xargs -r redis-cli -n \${REDIS_DB:-0} del
EOF
  printf '\n'
fi
