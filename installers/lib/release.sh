# shellcheck shell=bash
# installers/lib/release.sh — main's version: the latest published GitHub Release
#
# Responsibilities
#   Asking GitHub which published Release is the latest. A Server on main installs that Release
#   rather than main's latest commit (SYSTEM_DESIGN §18.6), and the installer hands over to its
#   installer. Only functions: loading it runs nothing.
#
# Provides
#   latest_release     prints the latest published Release's tag (e.g. v0.8.0). Exit status:
#                      0 found; 3 none published yet (GitHub's 404, or an answer marked draft or
#                      prerelease, which /releases/latest never gives); 1 GitHub couldn't be asked
#                      (offline, rate limited, an answer it can't read)
#   release_tag_ref <tag>   the refspec that fetches that tag alone: +refs/tags/<tag>:refs/tags/<tag>
#
# Used by
#   installers/update.sh (loaded before its main()); install.sh's server.sh (main_ref) and
#   use_branch_installer
#
# Uses
#   branch.sh (valid_branch, for the tag name); curl; NOTICEBOARD_GITHUB_API, the API's address
#   (https://api.github.com unless a test sets a stand-in)
#
# Change impact
#   server/services/updates/releases.js asks the same question for the admin panel and must give
#   the same answers (SYSTEM_DESIGN §14 D48). The API allows 60 requests an hour per address
#   without a token: a Server asks at most once per check (every 15 minutes).

latest_release() {
  local body code tag answer
  body=$(mktemp 2>/dev/null) || return 1
  code=$(curl -sS --max-time 20 -H 'Accept: application/vnd.github+json' -o "$body" -w '%{http_code}' \
           "${NOTICEBOARD_GITHUB_API:-https://api.github.com}/repos/fructus-sum/noticeboard/releases/latest" 2>/dev/null) || code=000
  answer=$(tr -d '\r\n' < "$body" 2>/dev/null || true)
  rm -f "$body"
  case "$code" in
    404) return 3 ;;
    200) ;;
    *) return 1 ;;
  esac
  if [[ "$answer" =~ \"(draft|prerelease)\"[[:space:]]*:[[:space:]]*true ]]; then
    return 3
  fi
  tag=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$answer")
  if ! valid_branch "$tag"; then
    return 1
  fi
  echo "$tag"
}

release_tag_ref() {   # release_tag_ref <tag>
  printf '+refs/tags/%s:refs/tags/%s' "$1" "$1"
}
