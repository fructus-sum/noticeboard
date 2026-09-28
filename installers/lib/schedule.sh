# shellcheck shell=bash
# installers/lib/schedule.sh — when installers/update.sh may install (data/update-schedule.env)
#
# Responsibilities
#   The update schedule the admin chose, and the one set of rules for when an install is due
#   (SYSTEM_DESIGN §9.1, §14 D41). The systemd timer still starts update.sh every 15 minutes; these
#   rules decide whether a run may install or only checks. Only functions: loading it runs nothing.
#
# Provides
#   read_schedule                    sets SCHEDULE_EVERY (15min | 2h | daily | weekly | manual; a
#                                    missing file or any other value: 15min, as before schedules
#                                    existed), SCHEDULE_TIME (HH:MM, default 00:00), SCHEDULE_DAY
#                                    (0-6, 0 = Sunday, default 0), SCHEDULE_SINCE and SCHEDULE_AT
#                                    (seconds since 1970, or empty)
#   now_epoch                        the time now in seconds (NOTICEBOARD_NOW instead, for tests)
#   iso_time <seconds>               → 2026-09-27T12:00:00Z
#   to_epoch <ISO time>              → seconds, or nothing when it isn't a time
#   install_due <now> <last>         succeeds when the schedule lets this run install. <last> is
#                                    the last run that could install (empty if none). A set time
#                                    (SCHEDULE_AT) takes the place of the automatic install
#   next_install <now> <last>        → the seconds of the next automatic install (or the set time);
#                                    nothing for 15min and manual
#   set_install_at <seconds|"">      rewrites the file with that set time, or without one
#
# Used by
#   installers/update.sh (loaded before its main(), so a checkout can't swap it mid-run)
#
# Uses
#   SCHEDULE_FILE, set by the script that loads it; GNU date (in the Pi's local time zone)
#
# Change impact
#   The file format is a contract with the server (services/updates/updateFiles.js):
#   NOTICEBOARD_UPDATE_EVERY, _TIME, _DAY, _SINCE and _AT lines; older update.sh copies ignore the
#   file, so after a rollback updates come every 15 minutes until this version is back.

read_schedule_value() {   # read_schedule_value <KEY>
  sed -n "s/^NOTICEBOARD_UPDATE_$1=//p" "$SCHEDULE_FILE" 2>/dev/null | head -n 1 | tr -d '\r' || true
}

read_schedule() {
  SCHEDULE_EVERY=$(read_schedule_value EVERY)
  case "$SCHEDULE_EVERY" in 15min|2h|daily|weekly|manual) ;; *) SCHEDULE_EVERY=15min ;; esac
  SCHEDULE_TIME=$(read_schedule_value TIME)
  [[ "$SCHEDULE_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || SCHEDULE_TIME=00:00
  SCHEDULE_DAY=$(read_schedule_value DAY)
  [[ "$SCHEDULE_DAY" =~ ^[0-6]$ ]] || SCHEDULE_DAY=0
  SCHEDULE_SINCE=$(to_epoch "$(read_schedule_value SINCE)")
  SCHEDULE_AT=$(to_epoch "$(read_schedule_value AT)")
}

now_epoch() {
  if [ -n "${NOTICEBOARD_NOW:-}" ]; then date -d "$NOTICEBOARD_NOW" +%s; else date +%s; fi
}

iso_time() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
}

to_epoch() {
  [ -n "${1:-}" ] || return 0
  date -d "$1" +%s 2>/dev/null || true
}

# The local date <days> days from <seconds> (counted from midday, so a daylight-saving change
# can't move it to the wrong day), then that date at SCHEDULE_TIME in seconds
day_at_time() {   # day_at_time <seconds> <days>
  local noon
  noon=$(date -d "$(date -d "@$1" +%Y-%m-%d) 12:00" +%s)
  date -d "$(date -d "@$((noon + $2 * 86400))" +%Y-%m-%d) $SCHEDULE_TIME" +%s
}

# The most recent scheduled time at or before <now> (daily and weekly)
last_scheduled() {   # last_scheduled <now>
  local now=$1 t back=0
  if [ "$SCHEDULE_EVERY" = weekly ]; then
    back=$(( ($(date -d "@$now" +%w) - SCHEDULE_DAY + 7) % 7 ))
  fi
  t=$(day_at_time "$now" "-$back")
  if [ "$t" -gt "$now" ]; then
    if [ "$SCHEDULE_EVERY" = weekly ]; then t=$(day_at_time "$now" "-$((back + 7))"); else t=$(day_at_time "$now" -1); fi
  fi
  echo "$t"
}

# The first scheduled time after <now> (daily and weekly)
next_scheduled() {   # next_scheduled <now>
  local now=$1 t ahead=0
  if [ "$SCHEDULE_EVERY" = weekly ]; then
    ahead=$(( (SCHEDULE_DAY - $(date -d "@$now" +%w) + 7) % 7 ))
  fi
  t=$(day_at_time "$now" "$ahead")
  if [ "$t" -le "$now" ]; then
    if [ "$SCHEDULE_EVERY" = weekly ]; then t=$(day_at_time "$now" "$((ahead + 7))"); else t=$(day_at_time "$now" 1); fi
  fi
  echo "$t"
}

# Since when the schedule has been waiting: the last run that could install, or when the
# schedule was chosen, whichever is later (0 if neither is known)
schedule_ref() {   # schedule_ref <last>
  local ref=${1:-0}
  if [ -n "$SCHEDULE_SINCE" ] && [ "$SCHEDULE_SINCE" -gt "$ref" ]; then ref=$SCHEDULE_SINCE; fi
  echo "$ref"
}

install_due() {   # install_due <now> <last>
  local now=$1 ref
  if [ -n "$SCHEDULE_AT" ]; then [ "$now" -ge "$SCHEDULE_AT" ]; return; fi
  ref=$(schedule_ref "${2:-}")
  case "$SCHEDULE_EVERY" in
    15min) return 0 ;;
    2h) [ "$ref" -eq 0 ] || [ $((now - ref)) -ge 7080 ] ;;   # 2 hours, less the timer's random delay
    daily|weekly) [ "$(last_scheduled "$now")" -gt "$ref" ] ;;
    *) return 1 ;;
  esac
}

next_install() {   # next_install <now> <last>
  local now=$1 ref
  if [ -n "$SCHEDULE_AT" ]; then echo "$SCHEDULE_AT"; return; fi
  ref=$(schedule_ref "${2:-}")
  case "$SCHEDULE_EVERY" in
    2h) if [ "$ref" -eq 0 ]; then echo "$now"; else echo $((ref + 7200)); fi ;;
    daily|weekly)
      if [ "$(last_scheduled "$now")" -gt "$ref" ]; then echo "$now"; else next_scheduled "$now"; fi ;;
  esac
}

set_install_at() {   # set_install_at <seconds or "">
  local line
  {
    for key in EVERY TIME DAY SINCE; do
      line=$(read_schedule_value "$key")
      if [ -n "$line" ]; then printf 'NOTICEBOARD_UPDATE_%s=%s\n' "$key" "$line"; fi
    done
    if [ -n "${1:-}" ]; then printf 'NOTICEBOARD_UPDATE_AT=%s\n' "$(iso_time "$1")"; fi
  } > "$SCHEDULE_FILE.tmp"
  mv "$SCHEDULE_FILE.tmp" "$SCHEDULE_FILE"
}
