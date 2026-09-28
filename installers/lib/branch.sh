# shellcheck shell=bash
# installers/lib/branch.sh — the branch a Server follows (data/update-branch.env)
#
# Responsibilities
#   The one bash rule for a valid branch name, and reading and writing the branch setting that
#   the admin panel, install.sh and update.sh share. Only functions: loading it runs nothing.
#
# Provides
#   valid_branch <name>            succeeds for a name git accepts that is safe wherever it's used
#   read_branch_setting            NOTICEBOARD_BRANCH from $BRANCH_FILE, or nothing
#   read_main_at_switch            NOTICEBOARD_MAIN_AT_SWITCH from $BRANCH_FILE, or nothing
#   write_branch_setting <branch> [<main's commit when switching to it>]
#                                  replaces $BRANCH_FILE in one step
#
# Used by
#   installers/update.sh (loaded before its main(), so a checkout can't swap it mid-run);
#   install.sh's ui.sh (choose_branch) and server.sh (save_branch_setting)
#
# Uses
#   BRANCH_FILE, set by the script that loads it
#
# Change impact
#   valid_branch has a JavaScript twin, server/services/updates/branchName.js:
#   tests/installers/branch-names.sh checks both give the same answers. The file format is a
#   contract with the server (services/updates/updateFiles.js) and with the update.sh of older
#   commits a Server may switch back to: NOTICEBOARD_BRANCH=<branch>, then optionally
#   NOTICEBOARD_MAIN_AT_SWITCH=<commit>.

valid_branch() {
  [[ "$1" =~ ^[A-Za-z0-9._/-]{1,100}$ ]] \
    && [[ "$1" != -* && "$1" != /* && "$1" != */ && "$1" != .* && "$1" != *. && "$1" != HEAD \
          && "$1" != *..* && "$1" != *//* && "$1" != */.* && "$1" != *.lock ]]
}

read_branch_setting() {
  sed -n 's/^NOTICEBOARD_BRANCH=//p' "$BRANCH_FILE" 2>/dev/null | head -n 1 || true
}

read_main_at_switch() {
  sed -n 's/^NOTICEBOARD_MAIN_AT_SWITCH=//p' "$BRANCH_FILE" 2>/dev/null | head -n 1 || true
}

write_branch_setting() {   # write_branch_setting <branch> [main's commit when switching to it]
  {
    printf 'NOTICEBOARD_BRANCH=%s\n' "$1"
    if [ -n "${2:-}" ]; then printf 'NOTICEBOARD_MAIN_AT_SWITCH=%s\n' "$2"; fi
  } > "$BRANCH_FILE.tmp"
  mv "$BRANCH_FILE.tmp" "$BRANCH_FILE"
}
