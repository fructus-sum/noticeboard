// server/services/updates/switchTokens.js — one-time proof that the admin password was checked
//
// Provides
//   issue(branch)        → token: valid for 5 minutes, for that branch only
//   take(token, branch)  → boolean: whether it's valid for that branch. Used up either way;
//                          expired tokens are cleared on the way
//
// Used by
//   routes/api/settings/updates.js (through services/updates/index.js): the password step issues
//   one, the final confirmation takes it
const crypto = require('crypto');

const TOKEN_MS = 5 * 60 * 1000;   // between the password check and the final confirmation
const tokens = new Map();         // token -> { branch, expires }

function issue(branch) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { branch, expires: Date.now() + TOKEN_MS });
  return token;
}

function take(token, branch) {
  const entry = typeof token === 'string' ? tokens.get(token) : undefined;
  tokens.delete(token);
  for (const [t, e] of tokens) {
    if (e.expires < Date.now()) tokens.delete(t);
  }
  return !!entry && entry.branch === branch && entry.expires >= Date.now();
}

module.exports = { issue, take };
