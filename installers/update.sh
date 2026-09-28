#!/usr/bin/env bash
# update.sh
# Keeps a Server on the latest version of the GitHub branch it follows: main, unless another
# branch was chosen in the admin panel (Settings → Software updates). On main that's the latest
# published Release (lib/release.sh; never an older one by itself); on another branch, its latest
# commit. When there's a new version it installs it, rebuilds, restarts the server and checks the
# server answers. If anything
# fails it puts the previous version back, and after a failed branch switch it also goes back
# to following the previous branch. The noticeboard's content and settings (data/) are never
# changed or deleted.
#
# Runs every 15 minutes from noticeboard-update.timer, and straight away when the admin panel
# asks for something (noticeboard-update.path watches tmp/update-request). Both are set up by
# install.sh. The update schedule chosen in the admin panel (data/update-schedule.env, read by
# lib/schedule.sh) decides whether a run may install: every run checks for a new version (in
# manual mode once a day) and records whether one is waiting; it installs only when that's due,
# or when the admin asked (Update now, a branch switch). The request file says what was asked:
# "install-now", "check" (only check, e.g. after the schedule changed), "restore-defaults", or
# anything else (a branch switch, as older servers write it).
#
# Restore Defaults (data/restore-defaults, left by the server): the followed branch's latest version
# is reinstalled even if it's the one running, into a clean folder (everything untracked deleted
# but RESTORE_KEEP), and the server is restarted even if that failed: at start-up it resets its
# data, logs and waiting files (server/services/contentReset.js). Runs as the user that owns /opt/noticeboard, which is also the user the
# server runs as. No sudo.
#
#   Check now:             bash /opt/noticeboard/installers/update.sh
#   Retry a failed commit: bash /opt/noticeboard/installers/update.sh --force
#   Try another branch:    NOTICEBOARD_BRANCH=my-branch bash /opt/noticeboard/installers/update.sh
#                          (once: the next check goes back to the branch chosen in Settings)
#
# Used by
#   noticeboard-update.service (its timer and path units), set up by install.sh
# Uses
#   installers/lib/branch.sh, json.sh, schedule.sh and release.sh (loaded before main); git, npm,
#   node, systemctl, curl; GitHub's Releases API (main's latest Release); the files it shares
#   with the server (SYSTEM_DESIGN §4.2); GET /api/auth/status after a restart
# Change impact
#   This file runs the next update on every Server that installed it: a mistake here can stop updates
#   everywhere. Its path is in every installed update unit, and after a rollback an older
#   commit's update.sh must take over again (§9, §15). tests/upgrade proves both.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="noticeboard"
# The installer to recover with: main's until the target is known, then the target's (installer_url)
INSTALLER_URL="https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh"
BRANCH_FILE="$INSTALL_DIR/data/update-branch.env"    # NOTICEBOARD_BRANCH=<branch>, written by the admin panel
STATUS_FILE="$INSTALL_DIR/data/update-status.json"   # the last update or branch switch, shown in the admin panel
CHECK_FILE="$INSTALL_DIR/data/update-check.json"     # the last check for updates, shown in the admin panel
NOTICE_FILE="$INSTALL_DIR/data/update-notice.json"   # shown on the admin home page until someone closes it
SCHEDULE_FILE="$INSTALL_DIR/data/update-schedule.env" # the update schedule, written by the admin panel (lib/schedule.sh)
RESTORE_FILE="$INSTALL_DIR/data/restore-defaults"    # Restore Defaults asked for (the server deletes it at start-up)
INSTALLER_RECORD="$INSTALL_DIR/data/installer.json"  # the last installer run, written by install.sh
# What a Restore Defaults clean keeps (git clean patterns; a name without a slash in the middle also
# matches deeper in the folder, which only keeps more, and none starts with / because Git Bash would
# rewrite it on Windows, where the tests run): what the server
# resets itself (data, tmp, logs), what the installer made (.env, start-kiosk.sh, and its files in
# data/ and tmp/), and what keeps the running server working until it restarts (both rebuilt
# anyway). A file the installer adds to the folder must be added here (SYSTEM_DESIGN §15).
RESTORE_KEEP=(data/ tmp/ logs/ .env start-kiosk.sh node_modules/ 'client/*/dist/')
BACKUP_DIR="$INSTALL_DIR/data/backups"               # settings are copied here before a branch switch
REQUEST_FILE="$INSTALL_DIR/tmp/update-request"       # written by the admin panel to update right now
LOCK_FILE="$INSTALL_DIR/tmp/update.lock"             # install.sh holds this lock too
FAILED_FILE="$INSTALL_DIR/tmp/update-failed-commit"  # skipped until the branch moves past it
UPLOAD_DIR="$INSTALL_DIR/tmp/noticeboard-uploads"    # pathHelpers.tmpDir()
# Another branch is only installed if its update.sh also follows the branch chosen in the admin
# panel, i.e. mentions this file. An older branch would ignore that setting, so the Server couldn't
# be switched back from the admin panel. (server/services/updates/index.js checks the same.)
BRANCH_SUPPORT_MARKER="update-branch.env"

# Give up on a stalled download instead of hanging until systemd's timeout
export GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=60

# Shared with install.sh: the branch setting (valid_branch, read_branch_setting,
# read_main_at_switch, write_branch_setting), the JSON files (write_json) and main's latest
# Release (latest_release, release_tag_ref); and the update schedule (read_schedule,
# install_due, next_install, set_install_at). Loaded now, from this commit, before a checkout
# can replace them. If they can't be, nothing is touched.
for lib in branch json schedule release; do
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
# The latest Release's commit when this Server switched to its branch (main's commit if it
# switched before Releases): see branch_merged
MAIN_AT_SWITCH=$(read_main_at_switch)
RETURNED_FROM=""     # the branch this run went back to main from, because a Release has its work
PREVIOUS_BRANCH=""   # the branch and commit running before this update
CURRENT=""
TARGET=""            # the commit being installed
RELEASE=""           # on main: the latest Release's tag, whose commit TARGET is
TARGET_NAME=""       # TARGET as the admin reads it: "Release v0.8.0 (abc1234)" or "abc1234 from <branch>"
INSTALLER_FOR=""     # a Release with the followed branch's work, waiting for the installer (branch_merged)
NOW=""               # this run's time, in seconds (lib/schedule.sh now_epoch)
INSTALL_CHECKED_AT="" # the last run that could install (update-check.json), for the schedule
FETCHED_AT=""        # the last time GitHub was checked (update-check.json)
AVAILABLE=""         # a newer commit waiting for its install time

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
  NOW=$(now_epoch)
  read_schedule
  INSTALL_CHECKED_AT=$(check_value installCheckedAt)
  FETCHED_AT=$(check_value fetchedAt)
  INSTALLER_FOR=$(check_value installerFor)

  # The admin panel asked for this run. The request is taken straight away: systemd starts this
  # whenever the file exists, so leaving it would start it again and again. Anything but "check"
  # asks for an install (a branch switch, or Update now).
  local requested="" force="" request=""
  if [ -f "$REQUEST_FILE" ]; then
    request=$(head -c 200 "$REQUEST_FILE" 2>/dev/null | tr -d '\r\n' || true)
    rm -f "$REQUEST_FILE"
    if [ "$request" != check ]; then
      requested=1
      force=1   # asked for by the admin, so a commit that failed before is tried again
    fi
  fi
  if [ "${1:-}" = "--force" ]; then force=1; fi
  # Restore Defaults: asked for now, or left waiting by a run that found the lock busy
  local restore=""
  if [ -f "$RESTORE_FILE" ]; then
    restore=1
    requested=1
    force=1
  fi

  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    if [ -n "$restore" ]; then
      write_status requested "The installer or another update is running. Restore Defaults starts at the next check, within 15 minutes."
    elif [ "$request" = install-now ]; then
      set_install_at "$NOW"   # a set time that has come: the next check installs
      write_status requested "The installer or another update is running. The update starts at the next check, within 15 minutes."
    elif [ -n "$requested" ]; then
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
  # Only a branch that keeps being followed can be waiting for a Release's installer
  if [ -n "$switching" ] || [ "$BRANCH" = main ]; then INSTALLER_FOR=""; fi

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

  # May this run install? Always when the admin asked or a switch is pending; otherwise when
  # the schedule says so (lib/schedule.sh). Otherwise it only checks.
  local due="" fetched
  fetched=$(to_epoch "$FETCHED_AT")
  if [ -n "$requested" ] || [ -n "$switching" ] || install_due "$NOW" "$(to_epoch "$INSTALL_CHECKED_AT")"; then
    due=1
  elif [ "$SCHEDULE_EVERY" = manual ] && [ -z "$request" ] && [ -n "$fetched" ] && [ $((NOW - fetched)) -lt 85500 ]; then
    echo "Manual updates: checked for a new version less than a day ago."
    exit 0
  fi

  # A branch whose work is all in main's latest Release now isn't needed any more: go back to
  # main (an install, so only when one is due)
  if [ -n "$due" ] && [ -z "$switching" ] && [ -z "$restore" ] && [ "$BRANCH" != main ] && [ "$(read_branch_setting)" = "$BRANCH" ] && branch_merged; then
    echo "$BRANCH's work is in Release $RELEASE; going back to main."
    RETURNED_FROM=$BRANCH
    write_branch_setting main
    BRANCH=main
    switching=1
  fi

  if [ "$BRANCH" = main ]; then
    fetch_release "$switching" "$restore"
  else
    fetch_branch_tip "$switching"
  fi
  if [ -n "$RELEASE" ]; then
    TARGET_NAME="Release $RELEASE (${TARGET:0:7})"
  else
    TARGET_NAME="${TARGET:0:7} from $BRANCH"
  fi
  INSTALLER_URL=$(installer_url)
  FETCHED_AT=$(iso_time "$NOW")
  if [ -n "$due" ]; then
    INSTALL_CHECKED_AT=$(iso_time "$NOW")
    if [ -n "$SCHEDULE_AT" ] && [ "$NOW" -ge "$SCHEDULE_AT" ]; then
      set_install_at ""   # the set time has come: this run is the install it was for
      SCHEDULE_AT=""
    fi
  fi

  if [ "$CURRENT" = "$TARGET" ] && [ -z "$restore" ]; then
    if [ -n "$switching" ]; then
      # The same version on another branch: nothing to install, just follow the new branch
      git checkout --quiet --force -B "$BRANCH" "$TARGET"
      if [ -n "$RETURNED_FROM" ]; then
        returned_to_main
      else
        write_status updated "Switched from $PREVIOUS_BRANCH to $BRANCH. Both have the same version ($TARGET_NAME), so nothing needed installing."
        remember_main
      fi
      echo "Switched to $BRANCH (${TARGET:0:7})."
    else
      echo "Up to date (${CURRENT:0:7})."
    fi
    write_check up-to-date "$(up_to_date_message)"
    exit 0
  fi

  # main never goes back by itself: a Release already in what's running (a Server with newer
  # commits of main, e.g. installed before the first Release) leaves it as it is. Only a switch
  # to main or Restore Defaults installs an older Release.
  if [ -n "$RELEASE" ] && [ -z "$switching" ] && [ -z "$restore" ] && git merge-base --is-ancestor "$TARGET" "$CURRENT" 2>/dev/null; then
    echo "Up to date (${CURRENT:0:7} already has $RELEASE)."
    write_check up-to-date "Up to date: running ${CURRENT:0:7} from main, which already has the latest Release, $RELEASE."
    exit 0
  fi

  if [ -z "$force" ] && [ "$TARGET" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
    if [ -n "$switching" ]; then
      restore_branch_setting
      write_status cancelled "The switch to $BRANCH was cancelled: its latest commit (${TARGET:0:7}) couldn't be installed before. Still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
    fi
    write_check skipped "$TARGET_NAME couldn't be installed before, so it's skipped until a newer version arrives. Still running ${CURRENT:0:7}."
    echo "Skipping ${TARGET:0:7}: it failed before. Push a fix, or retry with: bash $INSTALL_DIR/installers/update.sh --force"
    exit 0
  fi

  # Not due: the new version waits for its install time, or for the admin in manual mode
  if [ -z "$due" ]; then
    AVAILABLE=$TARGET
    write_check available "A new version is waiting: $TARGET_NAME. $(waiting_note)"
    echo "Update available: $TARGET_NAME (not due yet)."
    exit 0
  fi

  local problem
  if problem=$(refuse_reason "$switching"); then
    echo "$TARGET" > "$FAILED_FILE"
    if [ -n "$switching" ]; then
      restore_branch_setting
      write_status cancelled "Didn't switch to $BRANCH: $problem. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
    else
      write_status failed "Didn't install $TARGET_NAME: $problem. Still running ${CURRENT:0:7}."
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
  elif [ -n "$restore" ]; then
    write_status updating "Restoring defaults: reinstalling $TARGET_NAME into a clean folder. This takes a few minutes; the noticeboard keeps running until it restarts."
    clean_folder
  else
    write_status updating "Installing $TARGET_NAME. The noticeboard keeps running until it restarts."
  fi
  echo "Updating ${CURRENT:0:7} -> ${TARGET:0:7} ($BRANCH)"
  PORT=$(server_port)

  if ! install_commit "$BRANCH" "$TARGET"; then
    echo "Couldn't install ${TARGET:0:7}; the running server wasn't touched. Restoring ${CURRENT:0:7}'s files."
    echo "$TARGET" > "$FAILED_FILE"
    restore_branch_setting
    if install_commit "$PREVIOUS_BRANCH" "$CURRENT"; then
      write_status rolled-back "$TARGET_NAME failed to install or build, so ${CURRENT:0:7} from $PREVIOUS_BRANCH was put back. The noticeboard kept running the whole time."
    else
      write_status failed "$TARGET_NAME failed to install or build, and putting ${CURRENT:0:7} from $PREVIOUS_BRANCH back failed too. The noticeboard is still running, but might not start after a restart. To recover, run the installer on this Server: curl -fsSL $INSTALLER_URL | sudo bash"
      echo "ERROR: couldn't restore ${CURRENT:0:7}'s files. Fix this before the server next restarts." >&2
    fi
    if [ -n "$restore" ]; then
      # The reset still happens: the server applies it at start-up (and so clears the status above)
      restart_server || true
      write_status failed "Restore Defaults: the settings and content were reset, but reinstalling $TARGET_NAME failed, so ${CURRENT:0:7} was put back. To reinstall, run the installer on this Server: curl -fsSL $INSTALLER_URL | sudo bash"
    fi
    exit 1
  fi

  wait_for_uploads
  if ! restart_server; then
    echo "${TARGET:0:7} didn't answer after the restart; rolling back to ${CURRENT:0:7}."
    echo "$TARGET" > "$FAILED_FILE"
    restore_branch_setting
    if install_commit "$PREVIOUS_BRANCH" "$CURRENT" && restart_server; then
      write_status rolled-back "$TARGET_NAME didn't start, so ${CURRENT:0:7} from $PREVIOUS_BRANCH was put back and restarted."
      echo "Rolled back to ${CURRENT:0:7}."
    else
      write_status failed "$TARGET_NAME didn't start, and going back to ${CURRENT:0:7} from $PREVIOUS_BRANCH failed too. To recover, run the installer on this Server: curl -fsSL $INSTALLER_URL | sudo bash (server logs: journalctl -u $SERVICE_NAME)"
      echo "ERROR: rollback to ${CURRENT:0:7} failed. Check: journalctl -u $SERVICE_NAME" >&2
    fi
    exit 1
  fi

  rm -f "$FAILED_FILE"
  if [ -n "$RETURNED_FROM" ]; then
    returned_to_main
  elif [ -n "$restore" ]; then
    write_status updated "Restored to defaults: running $TARGET_NAME, as if newly installed."
  elif [ -n "$switching" ]; then
    write_status updated "Switched from $PREVIOUS_BRANCH to $BRANCH: now running ${TARGET:0:7}. The settings from before the switch are saved in ${backup#"$INSTALL_DIR"/}."
    remember_main
  else
    write_status updated "Updated to $TARGET_NAME."
  fi
  write_check up-to-date "$(up_to_date_message)"
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

# main: the target is the latest Release (TARGET, RELEASE), its tag fetched on its own (branch_merged
# may have found it already). None published yet, or GitHub can't be asked: says so and exits,
# except that Restore Defaults with none published reinstalls what's running.
fetch_release() {   # fetch_release <switching> <restore>
  local code=0 reason
  if [ -z "$RELEASE" ]; then
    RELEASE=$(latest_release) || code=$?
  fi
  if [ "$code" -eq 0 ] && git fetch --quiet --no-tags origin "$(release_tag_ref "$RELEASE")" \
     && TARGET=$(git rev-parse -q --verify "refs/tags/$RELEASE^{commit}"); then
    return 0
  fi
  RELEASE=""
  if [ "$code" -eq 3 ] && [ -n "$2" ]; then
    TARGET=$CURRENT
    return 0
  fi
  if [ "$code" -eq 3 ]; then
    reason="No Release of Noticeboard has been published on GitHub yet"
    FETCHED_AT=$(iso_time "$NOW")
  else
    reason="Couldn't ask GitHub for main's latest Release (is the Server online?)"
  fi
  if [ -n "$1" ]; then
    restore_branch_setting
    write_status cancelled "$reason, so the switch to main was cancelled. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
  elif [ "$code" -eq 3 ]; then
    write_check up-to-date "$reason. This noticeboard keeps running ${CURRENT:0:7} from main, and installs the first Release once it's published."
  else
    write_check offline "Couldn't reach GitHub; trying again at the next check."
  fi
  echo "$reason." >&2
  if [ "$code" -eq 3 ] && [ -z "$1" ]; then exit 0; fi
  exit 1
}

# Another branch: the target is its latest commit. It can't be downloaded: says why and exits.
fetch_branch_tip() {   # fetch_branch_tip <switching>
  if git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"; then
    TARGET=$(git rev-parse "origin/$BRANCH")
    return 0
  fi
  local code=0 reason
  git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || code=$?
  if [ "$code" -eq 2 ]; then
    reason="The branch $BRANCH doesn't exist on GitHub"
  else
    reason="Couldn't download $BRANCH from GitHub (is the Server online?)"
  fi
  if [ -n "$1" ]; then
    restore_branch_setting
    write_status cancelled "$reason, so the switch was cancelled. Nothing was changed: still running $PREVIOUS_BRANCH (${CURRENT:0:7})."
  elif [ "$code" -eq 2 ]; then
    write_check error "$reason any more, so no updates can be installed. This noticeboard keeps running ${CURRENT:0:7}; choose another branch in Settings → Software updates."
  else
    write_check offline "Couldn't reach GitHub; trying again at the next check."
  fi
  echo "$reason." >&2
  exit 1
}

# The installer that matches the target: the Release's on main, else the branch's
installer_url() {
  echo "https://raw.githubusercontent.com/fructus-sum/noticeboard/${RELEASE:-$BRANCH}/installers/install.sh"
}

# The check's message when nothing needs installing
up_to_date_message() {
  local message="Up to date: running $TARGET_NAME."
  if [ -n "$INSTALLER_FOR" ]; then
    message+=" Release $INSTALLER_FOR has $BRANCH's work: this noticeboard goes back to main once the installer has been run (see the notice)."
  fi
  echo "$message"
}

# After switching to a branch other than main, remember the latest Release's commit: a new
# branch can start out with nothing that isn't in it, so it only counts as in a Release once the
# latest Release has changed. Nothing is recorded when there's none or GitHub can't be asked.
remember_main() {
  local tag commit=""
  if [ "$BRANCH" = main ] || [ "$(read_branch_setting)" != "$BRANCH" ]; then
    return 0
  fi
  if tag=$(latest_release) && git fetch --quiet --no-tags origin "$(release_tag_ref "$tag")" 2>/dev/null; then
    commit=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null) || commit=""
  fi
  write_branch_setting "$BRANCH" "$commit"
}

# Is all of the followed branch's work in main's latest Release now (merged, squashed or rebased
# in)? For a branch still on GitHub, only once the latest Release has changed since the switch;
# for one deleted from GitHub, if what's installed is in the Release (a branch deleted unmerged is
# left alone). A Release that needs a newer installer than this Server's last run waits for it
# (INSTALLER_FOR, the notice). Fails when unsure, e.g. GitHub can't be reached; INSTALLER_FOR is
# only changed when it could tell. Sets RELEASE when it succeeds.
branch_merged() {
  local tag release tip code=0
  tag=$(latest_release) || return 1
  git fetch --quiet --no-tags origin "$(release_tag_ref "$tag")" 2>/dev/null || return 1
  release=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null) || return 1
  git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || code=$?
  if [ "$code" -eq 2 ]; then
    tip=$CURRENT
  elif [ "$code" -eq 0 ] && git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then
    tip=$(git rev-parse "origin/$BRANCH" 2>/dev/null) || return 1
    if [ "$release" = "${MAIN_AT_SWITCH:-$tip}" ]; then
      INSTALLER_FOR=""
      return 1
    fi
  else
    return 1
  fi
  if ! git merge-base --is-ancestor "$tip" "$release" 2>/dev/null && ! contained_in "$tip" "$release"; then
    INSTALLER_FOR=""
    return 1
  fi
  if installer_behind "$release"; then
    INSTALLER_FOR=$tag
    echo "Release $tag has $BRANCH's work, but needs the installer run first; staying on $BRANCH."
    return 1
  fi
  INSTALLER_FOR=""
  RELEASE=$tag
}

# Would merging <commit> into <main> change nothing, i.e. was it squashed or rebased in?
contained_in() {   # contained_in <commit> <main>
  local merged=""
  merged=$(git merge-tree --write-tree "$2" "$1" 2>/dev/null | head -n 1) || return 1
  [ -n "$merged" ] && [ "$merged" = "$(git rev-parse "$2^{tree}")" ]
}

# Does <commit> need a newer installer run than this Server's last one? Its
# system-requirements.json's installer.version against data/installer.json's version. Without a
# record (not set up by a recent installer), it never waits.
installer_behind() {   # installer_behind <commit>
  local have need
  have=$(sed -n 's/.*"version":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$INSTALLER_RECORD" 2>/dev/null | head -n 1 || true)
  [ -n "$have" ] || return 1
  need=$(git show "$1:system-requirements.json" 2>/dev/null | node -e "
    let s = ''; process.stdin.on('data', (d) => { s += d; }).on('end', () => {
      try { const v = JSON.parse(s).installer.version; console.log(Number.isInteger(v) ? v : 0); } catch { console.log(0); }
    });" 2>/dev/null || true)
  [ "${need:-0}" -gt "$have" ]
}

# Tell the admin panel: in the Software updates card, and with a notice on the home page
# that stays until someone closes it
returned_to_main() {
  local message="The branch $RETURNED_FROM has been merged into main and published in Release $RELEASE, so its features are now part of main. This noticeboard has gone back to following main and is running $TARGET_NAME. Future updates come from main's Releases."
  write_status updated "$message"
  write_json "$NOTICE_FILE" type branch-merged branch "$RETURNED_FROM" commit "$TARGET" release "$RELEASE" \
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

# The last check for updates (result: up-to-date, available, waiting, skipped, offline or error),
# with what the schedule needs next time (installCheckedAt, fetchedAt) and what the admin panel
# shows: the next automatic install (nextInstall), a waiting version (available, its subject and
# date, and on main its Release), and a Release with the followed branch's work that waits for
# the installer (installerFor, its tag)
write_check() {   # write_check <result> <message>
  local next="" subject="" committed="" release=""
  next=$(next_install "$NOW" "$(to_epoch "$INSTALL_CHECKED_AT")")
  if [ -n "$AVAILABLE" ]; then
    subject=$(git log -1 --format=%s "$AVAILABLE" 2>/dev/null || true)
    committed=$(git log -1 --format=%cI "$AVAILABLE" 2>/dev/null || true)
    release=$RELEASE
  fi
  write_json "$CHECK_FILE" result "$1" branch "$BRANCH" message "$2" time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    installCheckedAt "$INSTALL_CHECKED_AT" fetchedAt "$FETCHED_AT" nextInstall "${next:+$(iso_time "$next")}" \
    available "$AVAILABLE" availableSubject "$subject" availableDate "$committed" availableRelease "$release" \
    installerFor "$INSTALLER_FOR"
}

# A value from the last check (update-check.json), or nothing
check_value() {   # check_value <key>
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$CHECK_FILE" 2>/dev/null | head -n 1 || true
}

# When a waiting version will be installed, for the admin
waiting_note() {
  local next
  if [ "$SCHEDULE_EVERY" = manual ] && [ -z "$SCHEDULE_AT" ]; then
    echo "Updates are manual: it's installed when you choose, in Settings → Software updates."
    return
  fi
  next=$(next_install "$NOW" "$(to_epoch "$INSTALL_CHECKED_AT")")
  if [ -n "$next" ]; then echo "It's installed at $(date -d "@$next" '+%-d %b %Y, %H:%M'), or when you choose Update now."; fi
}

# Restore Defaults: delete everything untracked in the install folder but RESTORE_KEEP (a Server has no
# .gitignore, so -x and the keep list are what protect those)
clean_folder() {
  local args=() keep
  for keep in "${RESTORE_KEEP[@]}"; do args+=(-e "$keep"); done
  git clean -ffdxq "${args[@]}"
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
