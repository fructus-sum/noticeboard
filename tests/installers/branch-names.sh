#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# The branch-name rule exists twice: in bash (installers/lib/branch.sh, for update.sh and
# install.sh) and in JavaScript for the server's
# branch switch (see CURRENT_SYSTEM_DESIGN §14 D26). Both must accept and refuse exactly the same names:
# tests/fixtures/branch-names.txt.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$REPO/tests/fixtures/branch-names.txt"
pass=0; fail=0
# shellcheck source=/dev/null
source "$REPO/installers/lib/branch.sh"
js=$(cd "$REPO" && node -e "
  const { validBranchName } = require('./server/services/updates/branchName');
  const lines = require('fs').readFileSync(process.argv[1], 'utf8').split('\n').filter((l) => /^(valid|invalid) /.test(l));
  for (const l of lines) console.log(validBranchName(l.replace(/^\S+ /, '')) ? 'valid' : 'invalid');
" "$FIXTURE")
mapfile -t js_answers <<<"$js"
i=0
while IFS= read -r line; do
  case "$line" in valid\ *|invalid\ *) ;; *) continue ;; esac
  want=${line%% *}; name=${line#* }
  if valid_branch "$name"; then sh=valid; else sh=invalid; fi
  if [ "$sh" = "$want" ] && [ "${js_answers[$i]}" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL  '$name': want $want, branch.sh says $sh, the server says ${js_answers[$i]}"
  fi
  i=$((i+1))
done < "$FIXTURE"
echo "PASS  $pass names give the same answer in installers/lib/branch.sh and the server"
echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
