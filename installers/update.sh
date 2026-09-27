#!/usr/bin/env bash
# update.sh
# Keeps a server Pi on the latest commit of the GitHub branch it follows: main, unless another
# branch was chosen in the admin panel (Settings → Software updates). When there's a new commit
# it installs it, rebuilds, restarts the server and checks the server answers. If anything
# fails it puts the previous version back, and after a failed branch switch it also goes back
# to following the previous branch. The noticeboard's content and settings (data/) are never
# changed or deleted.
#
# Runs every 15 minutes from noticeboard-update.timer, and straight away when the admin panel
# asks for a branch switch (noticeboard-update.path watches tmp/update-request). Both are set
# up by install.sh. Runs as the user that owns /opt/noticeboard, which is also the user the
# server runs as. No sudo.
#
#   Check now:             bash /opt/noticeboard/installers/update.sh
#   Retry a failed commit: bash /opt/noticeboard/installers/update.sh --force
#   Try another branch:    NOTICEBOARD_BRANCH=my-branch bash /opt/noticeboard/installers/update.sh
#                          (once: the next check goes back to the branch chosen in Settings)
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="noticeboard"
INSTALLER_URL="https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh"
BRANCH_FILE="$INSTALL_DIR/data/update-branch.env"    # NOTICEBOARD_BRANCH=<branch>, written by the admin panel
STATUS_FILE="$INSTALL_DIR/data/update-status.json"   # the last update or branch switch, shown in the admin panel
CHECK_FILE="$INSTALL_DIR/data/update-check.json"     # the last check for updates, shown in the admin panel
NOTICE_FILE="$INSTALL_DIR/data/update-notice.json"   # shown on the admin home page until someone closes it
BACKUP_DIR="$INSTALL_DIR/data/backups"               # settings are copied here before a branch switch
REQUEST_FILE="$INSTALL_DIR/tmp/update-request"       # written by the admin panel to update right now
LOCK_FILE="$INSTALL_DIR/tmp/update.lock"             # install.sh holds this lock too
FAILED_FILE="$INSTALL_DIR/tmp/update-failed-commit"  # skipped until the branch moves past it
UPLOAD_DIR="$INSTALL_DIR/tmp/noticeboard-uploads"    # pathHelpers.tmpDir()
# Another branch is only installed if its update.sh also follows the branch chosen in the admin
# panel, i.e. mentions this file. An older branch would ignore that setting, so the Pi couldn't
# be switched back from the admin panel. (server/services/updates/index.js checks the same.)
BRANCH_SUPPORT_MARKER="update-branch.env"

# Give up on a stalled download instead of hanging until systemd's timeout
export GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=60

# Shared with install.sh: the branch setting (valid_branch, read_branch_setting,
# read_main_at_switch, write_branch_setting) and the JSON files (write_json). Loaded now, from
# this commit, before a checkout can replace them. If they can't be, nothing is touched.
for lib in branch json; do
  # shellcheck source=lib/branch.sh
  if ! source "$INSTALL_DIR/installers/lib/$lib.sh"; then
    echo "Can't load installers/lib/$lib.sh, so nothing was updated. To repair this noticeboard, run the installer: curl -fsSL $INSTALLER_URL | sudo bash" >&2
    exit 1
  fi
done

# The branch to follow: NOTICEBOARD_BRANCH (a one-off test), else the admin panel's setting,
# else main
BRANCH="${NOTICEBOARD_BRANCH:-$(read_branch_setting)}"
BRANCH="${BRANCH:-main}"
# main's commit when this Pi switched to its branch (see branch_merged)
MAIN_AT_SWITCH=$(read_main_at_switch)
RETURNED_FROM=""     # the branch this run went back to main from, because it was merged
PREVIOUS_BRANCH=""   # the branch and commit running before this update
CURRENT=""
TARGET=""            # the commit being installed

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
  mkdir -p "$INSTALL_DIR/tmp" "$INSTALL_DIR/data"

  # The admin panel asked for this run (a branch switch). The request is taken straight away:
  # systemd starts this whenever the file exists, so leaving it would start it again and again.
  local requested="" force=""
  if [ -f "$REQUEST_FILE" ]; then
    requested=1
    force=1   # asked for by the admin, so a commit that failed before is tried again
    rm -f "$REQUEST_FILE"
  fi
  if [ "${1:-}" = "--force" ]; then force=1; fi

  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    if [ -n "$requested" ]; then
      write_status requested "The installer or another update is running. The switch to $BRANCH starts at the next check, within 15 minutes."
    fi
    echo "The installer or another update is running; trying again at the next check."
    exit 0
  fi

  PREVIOUS_BRANCH=$(git symbolic-ref --short -q HEAD || echo main)
  CURRENT=$(git rev-parse HEAD)

  if ! valid_branch "$BRANCH"; then
    restore_branch_setting
    write_status cancelled "\"$BRANCH\" isn't a valid branch name, so it was ignored. Updates carry on from $PREVIOUS_BRANCH."
    echo "Invalid branch name: $BRANCH" >&2
    exit 1
  fi
  local switching=""
  if [ "$BRANCH" != "$PREVIOUS_BRANCH" ]; then switching=1; fi

  local state
  state=$(systemctl is-active "$SERVICE_NAME" || true)
  if [ "$state" != active ] && [ "$state" != activating ]; then
    write_check waiting "The $SERVICE_NAME service is $state, so nothing was updated. Updates resume once it runs again."
    if [ -n "$switching" ]; then
      write_status requested "The $SERVICE_NAME service is $state. The switch to $BRANCH starts once it runs again."
    fi
    echo "The $SERVICE_NAME service is $state, so it isn't updated. Start it to resume updates."
    exit 0
  fi

  if uploads_in_progress; then
    write_check waiting "An upload was being processed, so updating waits for the next check."
    if [ -n "$switching" ]; then
      write_status requested "An upload is being processed. The switch to $BRANCH starts at the next check, within 15 minutes."
    fi
    echo "An upload is being processed; trying again at the next check."
    exit 0
  fi

  # A branch whose work is all in main now isn't needed any more: go back to main
  if [ -z "$switching" ] && [ "$BRANCH" != main ] && [ "$(read_branch_setting)" = "$BRANCH" ] && branch_merged; then
    echo "$BRANCH has been merged into main; going back to main."
    RETURNED_FROM=$BRANCH
    write_branch_setting main
    BRANCH=main
    switching=1
  fi

  if ! git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"; then
    local code=0 reason
    git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || code=$?
    if [ "$code" -eq 2 ]; then
      reason="The branch $BRANCH doesn't exist on GitHub"
    else
      reason="Couldn't download $BRANCH from GitHub (is the Pi online?)"
    fi
    if [ -n "$switching" ]; then
      restore_branch_setting
      write_status cancelled "$reason, so the switch was cancelled. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
    elif [ "$code" -eq 2 ]; then
      write_check error "$reason any more, so no updates can be installed. This noticeboard keeps running ${CURRENT:0:7}; choose another branch in Settings → Software updates."
    else
      write_check offline "Couldn't reach GitHub; trying again at the next check."
    fi
    echo "$reason." >&2
    exit 1
  fi
  TARGET=$(git rev-parse "origin/$BRANCH")

  if [ "$CURRENT" = "$TARGET" ]; then
    if [ -n "$switching" ]; then
      # The same version on another branch: nothing to install, just follow the new branch
      git checkout --quiet --force -B "$BRANCH" "$TARGET"
      if [ -n "$RETURNED_FROM" ]; then
        returned_to_main
      else
        write_status updated "Switched from $PREVIOUS_BRANCH to $BRANCH. Both have the same version (${TARGET:0:7}), so nothing needed installing."
        remember_main
      fi
      echo "Switched to $BRANCH (${TARGET:0:7})."
    else
      echo "Up to date (${CURRENT:0:7})."
    fi
    write_check up-to-date "Up to date: running ${TARGET:0:7} from $BRANCH."
    exit 0
  fi

  if [ -z "$force" ] && [ "$TARGET" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
    if [ -n "$switching" ]; then
      restore_branch_setting
      write_status cancelled "The switch to $BRANCH was cancelled: its latest commit (${TARGET:0:7}) couldn't be installed before. Still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
    fi
    write_check skipped "${TARGET:0:7} from $BRANCH couldn't be installed before, so it's skipped until a newer commit arrives. Still running ${CURRENT:0:7}."
    echo "Skipping ${TARGET:0:7}: it failed before. Push a fix, or retry with: bash $INSTALL_DIR/installers/update.sh --force"
    exit 0
  fi

  local problem
  if problem=$(refuse_reason "$switching"); then
    echo "$TARGET" > "$FAILED_FILE"
    if [ -n "$switching" ]; then
      restore_branch_setting
      write_status cancelled "Didn't switch to $BRANCH: $problem. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
    else
      write_status failed "Didn't install ${TARGET:0:7} from $BRANCH: $problem. Still running ${CURRENT:0:7}."
    fi
    echo "Not installing ${TARGET:0:7}: $problem." >&2
    exit 1
  fi

  local backup=""
  if [ -n "$switching" ]; then
    if ! backup=$(backup_settings); then
      restore_branch_setting
      write_status cancelled "Couldn't back up the settings before switching (is the storage full?), so the switch to $BRANCH was cancelled. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
      echo "Couldn't back up the settings; not switching." >&2
      exit 1
    fi
    write_status updating "Switching from $PREVIOUS_BRANCH (${CURRENT:0:7}) to $BRANCH (${TARGET:0:7}): installing and building. This takes a few minutes; the noticeboard keeps running until it restarts."
  else
    write_status updating "Installing ${TARGET:0:7} from $BRANCH. The noticeboard keeps running until it restarts."
  fi
  echo "Updating ${CURRENT:0:7} -> ${TARGET:0:7} ($BRANCH)"
  PORT=$(server_port)

  if ! install_commit "$BRANCH" "$TARGET"; then
    echo "Couldn't install ${TARGET:0:7}; the running server wasn't touched. Restoring ${CURRENT:0:7}'s files."
    echo "$TARGET" > "$FAILED_FILE"
    restore_branch_setting
    if install_commit "$PREVIOUS_BRANCH" "$CURRENT"; then
      write_status rolled-back "${TARGET:0:7} from $BRANCH failed to install or build, so ${CURRENT:0:7} from $PREVIOUS_BRANCH was put back. The noticeboard kept running the whole time."
    else
      write_status failed "${TARGET:0:7} from $BRANCH failed to install or build, and putting ${CURRENT:0:7} from $PREVIOUS_BRANCH back failed too. The noticeboard is still running, but might not start after a restart. To recover, run the installer on this Pi: curl -fsSL $INSTALLER_URL | sudo bash"
      echo "ERROR: couldn't restore ${CURRENT:0:7}'s files. Fix this before the server next restarts." >&2
    fi
    exit 1
  fi

  wait_for_uploads
  if ! restart_server; then
    echo "${TARGET:0:7} didn't answer after the restart; rolling back to ${CURRENT:0:7}."
    echo "$TARGET" > "$FAILED_FILE"
    restore_branch_setting
    if install_commit "$PREVIOUS_BRANCH" "$CURRENT" && restart_server; then
      write_status rolled-back "${TARGET:0:7} from $BRANCH didn't start, so ${CURRENT:0:7} from $PREVIOUS_BRANCH was put back and restarted."
      echo "Rolled back to ${CURRENT:0:7}."
    else
      write_status failed "${TARGET:0:7} from $BRANCH didn't start, and going back to ${CURRENT:0:7} from $PREVIOUS_BRANCH failed too. To recover, run the installer on this Pi: curl -fsSL $INSTALLER_URL | sudo bash (server logs: journalctl -u $SERVICE_NAME)"
      echo "ERROR: rollback to ${CURRENT:0:7} failed. Check: journalctl -u $SERVICE_NAME" >&2
    fi
    exit 1
  fi

  rm -f "$FAILED_FILE"
  if [ -n "$RETURNED_FROM" ]; then
    returned_to_main
  elif [ -n "$switching" ]; then
    write_status updated "Switched from $PREVIOUS_BRANCH to $BRANCH: now running ${TARGET:0:7}. The settings from before the switch are saved in ${backup#"$INSTALL_DIR"/}."
    remember_main
  else
    write_status updated "Updated to ${TARGET:0:7} from $BRANCH."
  fi
  write_check up-to-date "Up to date: running ${TARGET:0:7} from $BRANCH."
  echo "Updated to ${TARGET:0:7}."
}

# Why TARGET mustn't be installed, printed; fails if it's fine. Its files replace the app's,
# so it mustn't bring files where the noticeboard keeps its content and settings. And when
# switching, it must be able to switch back (see BRANCH_SUPPORT_MARKER).
refuse_reason() {   # refuse_reason <switching>
  if [ -n "$(git ls-tree -r --name-only "$TARGET" -- data tmp logs .env)" ]; then
    echo "it contains files in data/, tmp/, logs/ or .env, which would overwrite this noticeboard's content or settings"
    return 0
  fi
  local updater
  updater=$(git show "$TARGET:installers/update.sh" 2>/dev/null || true)
  if [ -n "$1" ] && [[ "$updater" != *"$BRANCH_SUPPORT_MARKER"* ]]; then
    echo "it's older than branch switching, so this noticeboard couldn't be switched back from the admin panel"
    return 0
  fi
  return 1
}

# After a switch fails or is cancelled, updates go back to following the branch that was
# running. Only if the setting still names the branch that was tried: a one-off
# NOTICEBOARD_BRANCH test leaves the admin panel's setting alone.
restore_branch_setting() {
  if [ "$BRANCH" != "$PREVIOUS_BRANCH" ] && [ "$(read_branch_setting)" = "$BRANCH" ]; then
    if [ -n "$RETURNED_FROM" ]; then
      write_branch_setting "$RETURNED_FROM" "$MAIN_AT_SWITCH"
    else
      write_branch_setting "$PREVIOUS_BRANCH"
    fi
  fi
}

# After switching to a branch other than main, remember where main was: a new branch can
# start out identical to main, so it only counts as merged once main has moved on
remember_main() {
  local main=""
  if [ "$BRANCH" = main ] || [ "$(read_branch_setting)" != "$BRANCH" ]; then
    return 0
  fi
  if git fetch --quiet --no-tags origin "+refs/heads/main:refs/remotes/origin/main" 2>/dev/null; then
    main=$(git rev-parse origin/main 2>/dev/null) || main=""
  fi
  write_branch_setting "$BRANCH" "$main"
}

# Is all of the followed branch's work in main now (merged, squashed or rebased in)? For a
# branch still on GitHub, only once main has moved on since the switch; for one deleted from
# GitHub, if what's installed is in main (a branch deleted unmerged is left alone). Fails
# when unsure, e.g. GitHub can't be reached.
branch_merged() {
  local main tip code=0
  git fetch --quiet --no-tags origin "+refs/heads/main:refs/remotes/origin/main" 2>/dev/null || return 1
  main=$(git rev-parse origin/main 2>/dev/null) || return 1
  git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || code=$?
  if [ "$code" -eq 2 ]; then
    tip=$CURRENT
  elif [ "$code" -eq 0 ] && git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then
    tip=$(git rev-parse "origin/$BRANCH" 2>/dev/null) || return 1
    if [ "$main" = "${MAIN_AT_SWITCH:-$tip}" ]; then
      return 1
    fi
  else
    return 1
  fi
  git merge-base --is-ancestor "$tip" "$main" 2>/dev/null || contained_in "$tip" "$main"
}

# Would merging <commit> into <main> change nothing, i.e. was it squashed or rebased in?
contained_in() {   # contained_in <commit> <main>
  local merged=""
  merged=$(git merge-tree --write-tree "$2" "$1" 2>/dev/null | head -n 1) || return 1
  [ -n "$merged" ] && [ "$merged" = "$(git rev-parse "$2^{tree}")" ]
}

# Tell the admin panel: in the Software updates card, and with a notice on the home page
# that stays until someone closes it
returned_to_main() {
  local message="The branch $RETURNED_FROM has been merged into main, so its features are now part of main. This noticeboard has gone back to following main and is running ${TARGET:0:7}. Future updates come from main."
  write_status updated "$message"
  write_json "$NOTICE_FILE" type branch-merged branch "$RETURNED_FROM" commit "$TARGET" \
    message "$message" time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# Before a branch switch, copy the settings (the .json and .env files in data/: config.json,
# each slideshow's slideshow.json, ...) to data/backups/<time>-from-<branch>/, in case the other
# branch changes them. Slides and media aren't copied: switching doesn't touch them.
# Prints the backup folder.
backup_settings() {
  local dest
  dest="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-from-${PREVIOUS_BRANCH//\//-}"
  mkdir -p "$dest" || return 1
  (cd "$INSTALL_DIR/data" \
    && find . -path ./backups -prune -o -type f \( -name '*.json' -o -name '*.env' \) -size -1024k -print0 \
      | xargs -0 -r cp --parents -t "$dest") || return 1
  echo "$dest"
}

# The last update or branch switch (state: requested, updating, updated, rolled-back,
# cancelled or failed), shown in the admin panel. The server writes "requested".
write_status() {   # write_status <state> <message>
  write_json "$STATUS_FILE" state "$1" branch "$BRANCH" previousBranch "$PREVIOUS_BRANCH" \
    commit "$(git rev-parse HEAD 2>/dev/null || true)" previousCommit "$CURRENT" target "$TARGET" \
    message "$2" time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# The last check for updates (result: up-to-date, waiting, skipped, offline or error)
write_check() {   # write_check <result> <message>
  write_json "$CHECK_FILE" result "$1" branch "$BRANCH" message "$2" time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
