# shellcheck shell=bash
# tests/helpers/github.sh — a stand-in for GitHub's Releases API, for the tests of update.sh and
# install.sh (installers/lib/release.sh asks it)
#
# Provides
#   fake_latest_release <curl's arguments>   answers GET …/releases/latest as GitHub does, from
#       files in $MOCK: release (the latest Release's tag; missing: 404 Not Found), release-kind
#       ("draft" or "prerelease": the answer is marked so), github-down (curl can't connect: exit
#       6). Writes the answer where -o says and prints the status code, as -w '%{http_code}'
#       does; logs each request to $MOCK/github.log.
#   publish_release <tag> [<commit>]   in a clone of the stand-in GitHub (the current folder): tags
#       <commit> (default HEAD), pushes the tag and makes it the latest Release
#
# A stand-in curl script answers the API with its first line:
#   case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
#
# Used by
#   tests/installers/update*.sh, install-*.sh, installer-handover.sh; tests/upgrade/rehearsal.sh

fake_latest_release() {
  local out="" prev="" a tag kind
  for a in "$@"; do
    if [ "$prev" = -o ]; then out=$a; fi
    prev=$a
  done
  echo "releases/latest" >> "$MOCK/github.log"
  if [ -f "$MOCK/github-down" ]; then
    printf '000'
    return 6
  fi
  if [ -s "$MOCK/release" ]; then
    tag=$(cat "$MOCK/release")
    kind=$(cat "$MOCK/release-kind" 2>/dev/null || true)
    # Pretty-printed, as the API answers
    printf '{\n  "url": "https://api.github.com/repos/fructus-sum/noticeboard/releases/1",\n  "tag_name": "%s",\n  "name": "%s",\n  "draft": %s,\n  "prerelease": %s,\n  "body": "Notes with \\"tag_name\\": \\"not-this\\""\n}\n' \
      "$tag" "$tag" "$([ "$kind" = draft ] && echo true || echo false)" "$([ "$kind" = prerelease ] && echo true || echo false)" \
      > "${out:-/dev/null}"
    printf '200'
  else
    printf '{\n  "message": "Not Found"\n}\n' > "${out:-/dev/null}"
    printf '404'
  fi
}

publish_release() {   # publish_release <tag> [<commit>]
  git tag -f "$1" "${2:-HEAD}" >/dev/null && git push -q -f origin "refs/tags/$1" && echo "$1" > "$MOCK/release"
}
