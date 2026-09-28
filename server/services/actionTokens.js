// server/services/actionTokens.js — one-time proof that the admin password was checked
//
// Responsibilities
//   The step between "the admin typed the password" and "the admin confirmed a final time" for
//   every action that asks for the password again: a branch switch, Delete All and Restore
//   Defaults. A token is good for one action on one subject, once, for 5 minutes (SYSTEM_DESIGN
//   §14 D40).
//
// Provides
//   issue(action, subject)        → token: valid for 5 minutes, for that action and subject only
//   take(token, action, subject)  → boolean: whether it's valid for them. Used up either way;
//                                   expired tokens are cleared on the way
//
// Used by
//   services/updates (the branch switch: action 'switch', the branch as subject),
//   routes/api/settings/maintenance.js ('delete-all', 'restore-defaults')
//
// Change impact
//   Tokens live in memory only: a restart forgets them, and the admin simply starts again.
const crypto = require('crypto');

const TOKEN_MS = 5 * 60 * 1000;   // between the password check and the final confirmation
const tokens = new Map();         // token -> { action, subject, expires }

function issue(action, subject) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { action, subject, expires: Date.now() + TOKEN_MS });
  return token;
}

function take(token, action, subject) {
  const entry = typeof token === 'string' ? tokens.get(token) : undefined;
  tokens.delete(token);
  for (const [t, e] of tokens) {
    if (e.expires < Date.now()) tokens.delete(t);
  }
  return !!entry && entry.action === action && entry.subject === subject && entry.expires >= Date.now();
}

module.exports = { issue, take };
