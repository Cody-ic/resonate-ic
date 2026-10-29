#!/usr/bin/env bash
set -eu
umask 077
base="$HOME/resonate-ic"
exec 9>"$base/shared/backup.lock"
flock -n 9 || exit 0
trap 'systemctl --user start resonate-campus.service' EXIT
systemctl --user stop resonate-campus.service
python3 "$base/current/scripts/campus-backup.py" backup --shared "$base/shared" --archive "$base/backups/campus-$(date -u +%Y%m%dT%H%M%S).resbackup"
