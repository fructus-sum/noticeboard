#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# The installer runs the latest installer of the branch the Pi follows (else main's), hands over
# to main's with the answers when "go back to main" is chosen, and records its version.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
T=$(mktemp -d); export T MOCK="$T/mock"; mkdir -p "$MOCK"
source "$REPO/tests/helpers/github.sh"   # the Releases API: $MOCK/release is the latest Release's tag
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' "$2"; }
MAIN_SHA=1111111111111111111111111111111111111111
QA_SHA=2222222222222222222222222222222222222222
REL_SHA=4444444444444444444444444444444444444444   # the commit of the Release v0.8.0

# Stand-in GitHub: $QA is ok | old (no INSTALLER_VERSION) | fail | gone
fake_curl() {
  curl() {
    echo "curl $*" >> "$T/curl.log"
    case "$*" in
      */releases/latest*) fake_latest_release "$@"; return $? ;;
      *api.github.com*/commits/main*) printf '%s' "$MAIN_SHA" ;;
      *api.github.com*/commits/v0.8.0*) printf '%s' "$REL_SHA" ;;
      *api.github.com*/commits/QALife-updates*) [ "$QA" = fail ] || [ "$QA" = gone ] && return 22; printf '%s' "$QA_SHA" ;;
      *raw.githubusercontent.com*)
        local out="" url=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; url="$1"; shift; done
        case "$url" in
          *"$MAIN_SHA"*) printf '#!/usr/bin/env bash\necho "MAIN INSTALLER sha=$NOTICEBOARD_INSTALLER_SHA from=$NOTICEBOARD_INSTALLER_BRANCH mode=${NOTICEBOARD_MODE:-} branch=${NOTICEBOARD_INSTALL_BRANCH:-} args=$*"\n' > "$out" ;;
          *"$REL_SHA"*) printf '#!/usr/bin/env bash\nINSTALLER_VERSION=4\necho "RELEASE INSTALLER sha=$NOTICEBOARD_INSTALLER_SHA from=$NOTICEBOARD_INSTALLER_BRANCH release=${NOTICEBOARD_INSTALLER_RELEASE:-} mode=${NOTICEBOARD_MODE:-} branch=${NOTICEBOARD_INSTALL_BRANCH:-} args=$*"\n' > "$out" ;;
          *"$QA_SHA"*)
            if [ "$QA" = old ]; then printf '#!/usr/bin/env bash\necho "OLD QA INSTALLER"\n' > "$out"
            else printf '#!/usr/bin/env bash\nINSTALLER_VERSION=2\necho "QA INSTALLER sha=$NOTICEBOARD_INSTALLER_SHA from=$NOTICEBOARD_INSTALLER_BRANCH args=$*"\n' > "$out"; fi ;;
        esac ;;
    esac
  }
}

latest() {   # latest <branch setting or "">: runs use_latest_installer
  rm -f "$T/curl.log"; mkdir -p "$T/data"; rm -f "$T/data/update-branch.env"
  [ -n "$1" ] && echo "NOTICEBOARD_BRANCH=$1" > "$T/data/update-branch.env"
  (
    load_installer; fake_curl
    unset NOTICEBOARD_INSTALLER_SHA NOTICEBOARD_INSTALLER_BRANCH
    BRANCH_FILE="$T/data/update-branch.env"
    use_latest_installer --arg
    echo "CONTINUED WITH THIS COPY"
  ) > "$T/out" 2>&1
}

latest ""
grep -q "MAIN INSTALLER sha=$MAIN_SHA from=main mode= branch= args=--arg" "$T/out" && ! grep -q "commits/QALife" "$T/curl.log" \
  && ok "following main: main's latest installer, as before" || bad "main" "$T/out"
QA=ok latest QALife-updates
grep -q "Running the latest installer from QALife-updates (2222222)" "$T/out" && grep -q "QA INSTALLER sha=$QA_SHA from=QALife-updates args=--arg" "$T/out" \
  && ok "following a branch: that branch's latest installer, pinned to its commit" || bad "qa" "$T/out"
grep -q "raw.githubusercontent.com/fructus-sum/noticeboard/$QA_SHA/installers/install.sh" "$T/curl.log" && ok "download pinned to the branch's commit" || bad "pin" "$T/curl.log"
QA=old latest QALife-updates
grep -q "The installer from QALife-updates can't be used (it's too old), so this uses main's." "$T/out" && grep -q "MAIN INSTALLER" "$T/out" && ! grep -q "OLD QA" "$T/out" \
  && ok "a branch whose installer is older than this: main's, and says why" || bad "old" "$T/out"
QA=gone latest QALife-updates
grep -q "can't be used (couldn't check GitHub for a newer installer), so this uses main's" "$T/out" && grep -q "MAIN INSTALLER" "$T/out" \
  && ok "branch gone from GitHub: main's" || bad "gone" "$T/out"
latest "bad branch;rm"
grep -q "MAIN INSTALLER" "$T/out" && ! grep -q "commits/bad" "$T/curl.log" && ok "an invalid branch setting: main's, never used in a URL" || bad "invalid" "$T/out"
( load_installer; curl() { return 22; }; unset NOTICEBOARD_INSTALLER_SHA; BRANCH_FILE="$T/none"
  use_latest_installer; echo CONTINUED ) > "$T/out" 2>&1
grep -q "^Couldn't check GitHub for a newer installer; carrying on with this one." "$T/out" && grep -q CONTINUED "$T/out" \
  && ok "GitHub unreachable: carries on with this copy (same message as before)" || bad "offline" "$T/out"

# Handing over after the branch question
handover() {   # handover <installer came from> <chosen branch> [NOTICEBOARD_INSTALLER_SHA]
  rm -f "$T/curl.log"
  (
    load_installer; fake_curl; QA=ok
    export NOTICEBOARD_INSTALLER_BRANCH="$1" NOTICEBOARD_INSTALLER_SHA="${3:-$QA_SHA}"
    MODE=server; INSTALL_BRANCH=$2
    use_branch_installer --arg
    echo "CONTINUED WITH THIS COPY mode=${NOTICEBOARD_MODE:-unset}"
  ) > "$T/out" 2>&1
}
handover QALife-updates main
grep -q "MAIN INSTALLER sha=$MAIN_SHA from=main mode=server branch=main args=--arg" "$T/out" \
  && ok "branch installer, 'go back to main' chosen: hands over to main's, with the answers" || bad "handover" "$T/out"
handover QALife-updates QALife-updates
grep -q "CONTINUED WITH THIS COPY mode=unset" "$T/out" && [ ! -f "$T/curl.log" ] && ok "kept the branch: carries on, no downloads" || bad "keep" "$T/out"
rm -f "$MOCK/release"
handover main main
grep -q CONTINUED "$T/out" && grep -q "releases/latest" "$T/curl.log" && ! grep -q "raw.githubusercontent" "$T/curl.log" \
  && ok "main's installer installing main, no Release published yet: carries on" || bad "main-main" "$T/out"
echo v0.8.0 > "$MOCK/release"
handover main main
grep -q "Running the installer of Release v0.8.0 (4444444)" "$T/out" \
  && grep -q "RELEASE INSTALLER sha=$REL_SHA from=v0.8.0 release=v0.8.0 mode=server branch=main args=--arg" "$T/out" \
  && ok "main's installer installing main: hands over to the latest Release's installer, with the answers" || bad "main-release" "$T/out"
handover QALife-updates main
grep -q "RELEASE INSTALLER sha=$REL_SHA from=v0.8.0 release=v0.8.0 mode=server branch=main" "$T/out" \
  && ok "branch installer, 'go back to main' chosen: the Release's installer" || bad "qa-release" "$T/out"
( load_installer; fake_curl
  export NOTICEBOARD_INSTALLER_BRANCH=v0.8.0 NOTICEBOARD_INSTALLER_SHA=$REL_SHA NOTICEBOARD_INSTALLER_RELEASE=v0.8.0; MODE=server; INSTALL_BRANCH=main
  rm -f "$T/curl.log"; use_branch_installer; echo CONTINUED ) > "$T/out" 2>&1
grep -q CONTINUED "$T/out" && [ ! -f "$T/curl.log" ] && ok "the Release's installer: carries on, never hands over again" || bad "release-release" "$T/out"
( load_installer; fake_curl
  export NOTICEBOARD_INSTALLER_BRANCH=main NOTICEBOARD_INSTALLER_SHA=$MAIN_SHA; MODE=display; INSTALL_BRANCH=main
  use_branch_installer --x; echo CONTINUED ) > "$T/out" 2>&1
grep -q "RELEASE INSTALLER .*mode=display branch=main" "$T/out" && ok "a Client: the Release's installer too" || bad "client-release" "$T/out"
touch "$MOCK/github-down"
handover main main
grep -q CONTINUED "$T/out" && ! grep -q "RELEASE INSTALLER" "$T/out" && ok "the Releases API unreachable: main's installer carries on" || bad "api-down" "$T/out"
echo prerelease > "$MOCK/release-kind"; rm -f "$MOCK/github-down"
handover main main
grep -q CONTINUED "$T/out" && ! grep -q "RELEASE INSTALLER" "$T/out" && ok "an answer marked prerelease counts as none" || bad "prerelease" "$T/out"
rm -f "$MOCK/release" "$MOCK/release-kind"
handover QALife-updates main local
grep -q CONTINUED "$T/out" && [ ! -f "$T/curl.log" ] && ok "a local copy (NOTICEBOARD_INSTALLER_SHA=local) never hands over" || bad "local" "$T/out"
( load_installer; curl() { return 22; }
  export NOTICEBOARD_INSTALLER_BRANCH=QALife-updates NOTICEBOARD_INSTALLER_SHA=$QA_SHA; MODE=server; INSTALL_BRANCH=main
  use_branch_installer; echo "CONTINUED mode=${NOTICEBOARD_MODE:-unset}" ) > "$T/out" 2>&1
grep -q "The installer from main can't be used (couldn't check GitHub for a newer installer), so this one carries on." "$T/out" && grep -q "CONTINUED mode=unset" "$T/out" \
  && ok "hand-over not possible: says so and carries on" || bad "handover offline" "$T/out"
( load_installer; fake_curl; QA=ok
  unset NOTICEBOARD_INSTALLER_SHA NOTICEBOARD_INSTALLER_BRANCH; BRANCH_FILE="$T/none"
  export NOTICEBOARD_INSTALLER_BRANCH=main NOTICEBOARD_INSTALLER_SHA=$MAIN_SHA; MODE=server; INSTALL_BRANCH=QALife-updates
  use_branch_installer --x; echo CONTINUED ) > "$T/out" 2>&1
grep -q "QA INSTALLER" "$T/out" && ok "main's installer (branch installer was too old or offline), 'keep the branch' chosen: tries the branch's" || bad "main->qa" "$T/out"

# The answers carried over are used, not asked again
( load_installer; ask() { echo ASKED; REPLY=1; }
  NOTICEBOARD_MODE=server NOTICEBOARD_INSTALL_BRANCH=main; BRANCH_FILE="$T/b.env"; echo NOTICEBOARD_BRANCH=QALife-updates > "$T/b.env"
  choose_mode; choose_branch; echo "MODE=$MODE BRANCH=$INSTALL_BRANCH" ) > "$T/out" 2>&1
grep -q "MODE=server BRANCH=main" "$T/out" && ! grep -q ASKED "$T/out" && ! grep -q "Is this device the Server or a Client" "$T/out" \
  && ok "handed-over answers: mode and branch not asked again" || bad "answers" "$T/out"
( load_installer; ask() { echo ASKED; REPLY=2; }
  unset NOTICEBOARD_MODE NOTICEBOARD_INSTALL_BRANCH; INSTALL_DIR="$T/nothing"; KIOSK_SCRIPT="$T/nothing"; BRANCH_FILE="$T/b.env"
  choose_mode; choose_branch; echo "MODE=$MODE BRANCH=$INSTALL_BRANCH" ) > "$T/out" 2>&1
grep -q "ASKED" "$T/out" && grep -q "MODE=display" "$T/out" && ok "without them: asked as before" || bad "asked" "$T/out"

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
