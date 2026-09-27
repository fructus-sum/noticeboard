// server/services/updates/git.js — running git in this installation's folder
//
// Provides
//   git(args, timeout = 30 s) → Promise<string>  git's output, trimmed; rejects on failure.
//     Never prompts (GIT_TERMINAL_PROMPT=0), so a missing credential fails instead of hanging.
//
// Used by
//   services/updates/index.js
const { execFile } = require('child_process');
const { ROOT } = require('../../utils/pathHelpers');

function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: ROOT,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

module.exports = { git };
