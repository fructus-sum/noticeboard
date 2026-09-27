# shellcheck shell=bash
# installers/lib/json.sh — small JSON files the admin panel reads (update status, checks, notices)
#
# Provides
#   write_json <file> <key> <value> ...   a flat object of strings, replaced in one step
#   json_string <text>                    <text> as a JSON string (control characters dropped)
#
# Used by
#   installers/update.sh (update-status.json, update-check.json, update-notice.json);
#   install.sh's server.sh (update-status.json)
#
# Change impact
#   The server reads these files (services/updates/updateFiles.js): keys and values are strings.
#   data/installer.json has a number in it, so install.sh writes that one itself.

write_json() {
  local file=$1 json="" sep=""
  shift
  while [ $# -ge 2 ]; do
    json+="$sep$(json_string "$1"):$(json_string "$2")"
    sep=","
    shift 2
  done
  printf '{%s}\n' "$json" > "$file.tmp"
  mv "$file.tmp" "$file"
}

json_string() {
  local s
  s=$(printf '%s' "$1" | tr -d '\000-\037')
  s=${s//\\/\\\\}
  printf '"%s"' "${s//\"/\\\"}"
}
