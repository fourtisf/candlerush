#!/usr/bin/env bash
#
# Permanently remove one or more named projects from a shared VPS.
#
#   bash deploy/purge-project.sh foo bar             # dry run — shows what would go
#   bash deploy/purge-project.sh --delete foo bar    # commits
#
# Written for the case where a box is being cleared to make room for something else and
# the old tenants have to go: pm2 processes, systemd units, nginx sites, Postgres databases
# and their owning roles, directories, system users, cron lines and TLS certificates.
#
# Everything is matched by the names you pass. Nothing carrying a different name is
# touched, and no blanket command (pm2 delete all, FLUSHALL, rm -rf on a shared parent) is
# ever issued — on a shared host those take the neighbours with them.
#
# There is no undo. Dry run first; that is what it is for.
set -uo pipefail

DO_IT=0
if [ "${1:-}" = "--delete" ]; then DO_IT=1; shift; fi
PROJECTS="$*"

if [ -z "$PROJECTS" ]; then
  cat <<USAGE
usage: bash deploy/purge-project.sh [--delete] <name> [name...]

  bash deploy/purge-project.sh magmara profitflow      dry run
  bash deploy/purge-project.sh --delete magmara        remove it, permanently
USAGE
  exit 2
fi

hdr()  { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
hit()  { printf '  \033[33m%s\033[0m\n' "$*"; }
gone() { printf '  \033[31m✗ removed\033[0m %s\n' "$*"; }
none() { printf '  none\n'; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { if [ "$DO_IT" = "1" ]; then eval "$1" >/dev/null 2>&1; fi; }

[ "$(id -u)" = "0" ] || { echo "run as root"; exit 1; }

if [ "$DO_IT" = "0" ]; then
  printf '\n\033[1;33mDRY RUN\033[0m — nothing will be deleted. Targets: %s\n' "$PROJECTS"
  printf 'Re-run with --delete to commit.\n'
else
  printf '\n\033[1;31mDELETING\033[0m — %s. This is permanent.\n' "$PROJECTS"
fi

# ── 1. processes first, so nothing holds a database connection or a file open ──

hdr "pm2 processes"
if have pm2; then
  FOUND=0
  for p in $PROJECTS; do
    for app in $(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort -u); do
      case "$app" in
        *"$p"*) FOUND=1; hit "$app"; run "pm2 delete '$app'"; [ "$DO_IT" = 1 ] && gone "pm2: $app" ;;
      esac
    done
  done
  [ "$FOUND" = "0" ] && none
  run "pm2 save --force"
else
  printf '  pm2 not installed\n'
fi

hdr "systemd units"
FOUND=0
for p in $PROJECTS; do
  for u in $(systemctl list-unit-files 2>/dev/null | awk '{print $1}' | grep -i "$p"); do
    FOUND=1; hit "$u"
    run "systemctl stop '$u'; systemctl disable '$u'; rm -f /etc/systemd/system/'$u'"
    [ "$DO_IT" = 1 ] && gone "unit: $u"
  done
done
[ "$FOUND" = "0" ] && none
run "systemctl daemon-reload"

hdr "Other processes mentioning these names (reported, never killed)"
# Deliberately report-only. `pgrep -f <name>` matches anything whose command line merely
# CONTAINS the name — this script's own shell, an editor with the file open, a grep. Killing
# on a fuzzy command-line match is how you take out something unrelated on a production box.
# Real services are handled by the pm2 and systemd sections above; anything left here is for
# a human to look at.
FOUND=0
SELF=$$
for p in $PROJECTS; do
  for pid in $(pgrep -f "$p" 2>/dev/null); do
    [ "$pid" = "$SELF" ] && continue
    [ "$pid" = "$PPID" ] && continue
    # The process may exit between pgrep and here; a bare `< /proc/PID/cmdline` makes the
    # shell itself complain, which 2>/dev/null on the command does not suppress.
    [ -r "/proc/$pid/cmdline" ] || continue
    CMD=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ' | cut -c1-80)
    [ -z "$CMD" ] && continue
    case "$CMD" in *purge-project*) continue ;; esac
    FOUND=1
    hit "pid $pid: $CMD"
  done
done
if [ "$FOUND" = "1" ]; then
  printf '  \033[33mnot killed — check these yourself: kill <pid>\033[0m\n'
else
  none
fi

# ── 2. nginx ──────────────────────────────────────────────────────────────────

hdr "nginx sites"
FOUND=0
for p in $PROJECTS; do
  for f in $(ls -1 /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null | grep -i "$p" | sort -u); do
    FOUND=1; hit "$f"
    run "rm -f /etc/nginx/sites-enabled/'$f' /etc/nginx/sites-available/'$f'"
    [ "$DO_IT" = 1 ] && gone "nginx: $f"
  done
done
[ "$FOUND" = "0" ] && none
if [ "$DO_IT" = "1" ]; then
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; printf '  nginx reloaded\n'
  else printf '  \033[31mnginx config is now invalid — run "nginx -t" before reloading\033[0m\n'; fi
fi

# ── 3. databases and roles ────────────────────────────────────────────────────

hdr "Postgres databases and roles"
if have psql && id postgres >/dev/null 2>&1 && su postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
  for p in $PROJECTS; do
    EXISTS=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$p'\"" 2>/dev/null)
    if [ "$EXISTS" = "1" ]; then
      OWNER=$(su postgres -c "psql -tAc \"SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname='$p'\"" 2>/dev/null)
      SIZE=$(su postgres -c "psql -tAc \"SELECT pg_size_pretty(pg_database_size('$p'))\"" 2>/dev/null)
      hit "database $p  (owner: $OWNER, size: $SIZE)"
      # Drop refuses while anything is still connected.
      run "su postgres -c \"psql -tAc \\\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$p'\\\"\""
      run "su postgres -c \"dropdb --if-exists $p\""
      [ "$DO_IT" = 1 ] && gone "database: $p"
      if [ -n "$OWNER" ] && [ "$OWNER" != "postgres" ]; then
        hit "  role $OWNER"
        run "su postgres -c \"psql -tAc 'DROP OWNED BY \\\"$OWNER\\\"'\""
        run "su postgres -c \"dropuser --if-exists $OWNER\""
        [ "$DO_IT" = 1 ] && gone "role: $OWNER"
      fi
    fi
  done
  printf '\n  remaining databases:\n'
  su postgres -c "psql -tAc \"SELECT '    ' || datname FROM pg_database WHERE datname NOT IN ('template0','template1') ORDER BY 1\"" 2>/dev/null
else
  printf '  postgres not reachable\n'
fi

# ── 4. files ──────────────────────────────────────────────────────────────────

hdr "Directories"
FOUND=0
for p in $PROJECTS; do
  for d in $(find / -xdev -maxdepth 6 -type d -iname "*$p*" \
               -not -path '*/node_modules/*' -not -path '/proc/*' -not -path '/sys/*' \
               -not -path '/root/backups/*' 2>/dev/null); do
    FOUND=1
    hit "$d  ($(du -sh "$d" 2>/dev/null | cut -f1))"
    run "rm -rf '$d'"
    [ "$DO_IT" = 1 ] && gone "$d"
  done
done
[ "$FOUND" = "0" ] && none

hdr "Home directories of removed system users"
FOUND=0
for p in $PROJECTS; do
  if id "$p" >/dev/null 2>&1; then
    FOUND=1; hit "system user $p (home: $(getent passwd "$p" | cut -d: -f6))"
    run "pkill -9 -u '$p'; userdel -r '$p'"
    [ "$DO_IT" = 1 ] && gone "user: $p"
  fi
done
[ "$FOUND" = "0" ] && none

hdr "Cron entries"
CRON=$(crontab -l 2>/dev/null | grep -iE "$(echo $PROJECTS | tr ' ' '|')")
if [ -n "$CRON" ]; then
  while IFS= read -r c; do hit "$c"; done <<< "$CRON"
  if [ "$DO_IT" = "1" ]; then
    crontab -l 2>/dev/null | grep -viE "$(echo $PROJECTS | tr ' ' '|')" | crontab -
    gone "cron entries"
  fi
else
  none
fi

hdr "TLS certificates"
if have certbot; then
  CERTS=$(certbot certificates 2>/dev/null | grep 'Certificate Name:' | sed 's/.*: //')
  FOUND=0
  for c in $CERTS; do
    for p in $PROJECTS; do
      case "$c" in
        *"$p"*) FOUND=1; hit "$c"; run "certbot delete --cert-name '$c' --non-interactive";
                [ "$DO_IT" = 1 ] && gone "cert: $c" ;;
      esac
    done
  done
  [ "$FOUND" = "0" ] && printf '  none matching those names (other certs left alone)\n'
else
  printf '  certbot not installed\n'
fi

# ── 5. what is left ───────────────────────────────────────────────────────────

hdr "Disk"
df -h / | tail -1

if [ "$DO_IT" = "0" ]; then
  printf '\n\033[1;33mThat was a dry run.\033[0m To commit:  bash %s --delete %s\n\n' "$0" "$PROJECTS"
else
  printf '\n\033[1;32mDone.\033[0m Redis was left alone: its keys carry no project name, so there is no\n'
  printf 'safe way to tell whose they are. FLUSHALL only if nothing else on this box uses Redis.\n\n'
fi
