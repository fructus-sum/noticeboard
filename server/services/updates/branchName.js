// server/services/updates/branchName.js — which branch names are acceptable
//
// Provides
//   validBranchName(name) → boolean  a name git accepts and that is safe wherever it's used
//
// Used by
//   services/updates/index.js, routes/api/settings/updates.js
//
// Change impact
//   The same rule exists in bash (installers/lib/branch.sh valid_branch, used by update.sh and
//   install.sh): both must accept and refuse exactly the same names (tests/installers/
//   branch-names.sh checks them against tests/fixtures/branch-names.txt).
function validBranchName(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._/-]{1,100}$/.test(name)
    && !/^[-/.]|[/.]$|\.\.|\/\/|\/\.|\.lock$/.test(name)
    && name !== 'HEAD';
}

module.exports = { validBranchName };
