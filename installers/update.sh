#!/usr/bin/env bash
# update.sh
# Keeps a server Pi on the latest commit of GitHub main. When there's a new commit it
# installs it, rebuilds, restarts the server and checks the server answers. If anything
# fails, it puts the previous version back.
#
# Runs every 15 minutes from noticeboard-update.timer (set up by install.sh), as the
# user that owns /opt/noticeboard, which is also the user the server runs as. No sudo.
#
#   Check now:             bash /opt/noticeboard/installers/update.sh
#   Retry a failed commit: bash /opt/noticeboard/installers/update.sh --force
#   Try another branch:    NOTICEBOARD_BRANCH=my-branch bash /opt/noticeboard/installers/update.sh
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="noticeboard"
BRANCH="${NOTICEBOARD_BRANCH:-main}"
LOCK_FILE="$INSTALL_DIR/tmp/update.lock"             # install.sh holds this lock too
FAILED_FILE="$INSTALL_DIR/tmp/update-failed-commit"  # skipped until main moves past it
UPLOAD_DIR="$INSTALL_DIR/tmp/noticeboard-uploads"    # pathHelpers.tmpDir()

# git checkout replaces this file while it runs, so everything runs from main(),
# called on the last line: bash has read the whole file before main() starts.
main() {
  local owner
  owner=$(stat -c %U "$INSTALL_DIR")
  if [ "$(id -u)" -eq 0 ] && [ "$owner" != root ]; then
    # Never build or run the app as root
    exec runuser -u "$owner" -- env NOTICEBOARD_BRANCH="$BRANCH" bash "${BASH_SOURCE[0]}" "$@"
  fi
  if [ "$(id -un)" != "$owner" ]; then
    echo "Run this as $owner, the owner of $INSTALL_DIR." >&2
    exit 1
  fi

  cd "$INSTALL_DIR"
  export GIT_TERMINAL_PROMPT=0

  mkdir -p "$INSTALL_DIR/tmp"
  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "The installer or another update is running; trying again at the next check."
    exit 0
  fi

  local state
  state=$(systemctl is-active "$SERVICE_NAME" || true)
  if [ "$state" != active ] && [ "$state" != activating ]; then
    echo "The $SERVICE_NAME service is $state, so it isn't updated. Start it to resume updates."
    exit 0
  fi

  if uploads_in_progress; then
    echo "An upload is being processed; trying again at the next check."
    exit 0
  fi

  git fetch --quiet origin "$BRANCH"
  local current target previous_branch
  current=$(git rev-parse HEAD)
  target=$(git rev-parse "origin/$BRANCH")
  previous_branch=$(git symbolic-ref --short -q HEAD || echo main)

  if [ "$current" = "$target" ]; then
    echo "Up to date (${current:0:7})."
    exit 0
  fi
  if [ "${1:-}" != "--force" ] && [ "$target" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
    echo "Skipping ${target:0:7}: it failed before. Push a fix, or retry with: bash $INSTALL_DIR/installers/update.sh --force"
    exit 0
  fi

  echo "Updating ${current:0:7} -> ${target:0:7} ($BRANCH)"
  PORT=$(server_port)

  if ! install_commit "$BRANCH" "$target"; then
    echo "Couldn't install ${target:0:7}; the running server wasn't touched. Restoring ${current:0:7}'s files."
    echo "$target" > "$FAILED_FILE"
    install_commit "$previous_branch" "$current" \
      || echo "ERROR: couldn't restore ${current:0:7}'s files. Fix this before the server next restarts." >&2
    exit 1
  fi

  wait_for_uploads
  if ! restart_server; then
    echo "${target:0:7} didn't answer after the restart; rolling back to ${current:0:7}."
    echo "$target" > "$FAILED_FILE"
    if install_commit "$previous_branch" "$current" && restart_server; then
      echo "Rolled back to ${current:0:7}."
    else
      echo "ERROR: rollback to ${current:0:7} failed. Check: journalctl -u $SERVICE_NAME" >&2
    fi
    exit 1
  fi

  rm -f "$FAILED_FILE"
  echo "Updated to ${target:0:7}."
}

# Put a commit's files in place: code, dependencies and the built SPAs (as install.sh does).
# Called from `if`, where bash ignores set -e, so every step checks itself.
install_commit() {
  git checkout --quiet --force -B "$1" "$2" || return 1
  npm install --include=dev --no-audit --no-fund --loglevel=error || return 1
  npm run build || return 1
  npm prune --omit=dev --no-audit --no-fund --loglevel=error || return 1
}

# Stop the running server. systemd starts it again, running the new code, because
# noticeboard.service has Restart=always (RestartSec=5). The server runs as this
# user, so no sudo is needed. Succeeds once a new server process answers.
restart_server() {
  local old_pid pid
  old_pid=$(main_pid)
  if [ "$old_pid" -gt 0 ]; then
    kill -TERM "$old_pid" 2>/dev/null || true
  fi
  for _ in $(seq 90); do
    sleep 1
    pid=$(main_pid)
    if [ "$pid" -gt 0 ] && [ "$pid" != "$old_pid" ] \
      && curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/api/auth/status"; then
      return 0
    fi
  done
  return 1
}

main_pid() {
  systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null || echo 0
}

# The port the server listens on, read the way the server reads it; 3000 if that fails
server_port() {
  node -e "require('./server/utils/configIO').readConfig('data/config.json')
    .then((c) => console.log(c.port || 3000), () => console.log(3000))" 2>/dev/null || echo 3000
}

# Uploads wait in tmp/noticeboard-uploads until processed, then are deleted.
# A file younger than an hour means an upload is in progress.
uploads_in_progress() {
  [ -n "$(find "$UPLOAD_DIR" -type f -mmin -60 -print -quit 2>/dev/null)" ]
}

wait_for_uploads() {
  local waited=0
  while uploads_in_progress && [ "$waited" -lt 1800 ]; do
    if [ "$waited" -eq 0 ]; then
      echo "Waiting for an upload to finish before restarting..."
    fi
    sleep 15
    waited=$((waited + 15))
  done
}

main "$@"; exit
