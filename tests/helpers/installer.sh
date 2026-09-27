# shellcheck shell=bash
# tests/helpers/installer.sh — install.sh's functions for the installer tests, without running it
#
# Provides
#   load_installer   install.sh (all but its last line, which would run main()) and its parts from
#                    this checkout (installers/lib, installers/kiosk), loaded the way a real run
#                    loads them (load_modules_from). install.sh's own set -euo pipefail applies.
#                    Stand-ins a test defines afterwards replace the real functions.
#
# Used by
#   tests/installers/*.sh
#
# Uses
#   REPO, set by each test

load_installer() {
  # shellcheck source=/dev/null
  source <(sed '$d' "$REPO/installers/install.sh")
  load_modules_from "$REPO/installers" || { echo "FAIL  couldn't load the installer's parts"; exit 1; }
}
