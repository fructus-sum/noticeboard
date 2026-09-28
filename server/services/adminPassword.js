// server/services/adminPassword.js — the admin password: checking it, changing it, and whether
// it's still the default
//
// Responsibilities
//   Everything that compares against or replaces config.passwordHash. The callers decide their
//   own responses: logging in answers 401 for a wrong password, while a wrong password inside
//   the admin panel answers 403 (a 401 would send the panel to the login page).
//
// Provides
//   verify(password)          → Promise<boolean>  bcrypt compare with the stored hash. Like before,
//                                                 a password that isn't a string throws (→ 500)
//   change(current, next)     → Promise<{ ok: true } | { status, error }>  checks, then stores the
//                                                 new hash (configService.set emits 'change')
//   usesDefault()             → Promise<boolean>  still the default password? Cached per hash,
//                                                 because bcrypt is slow on purpose
//   MIN_LENGTH                the shortest new password accepted (shared/contract.json)
//
// Used by
//   routes/api/auth.js (login), routes/api/settings/security.js (password change, default-password
//   warning), routes/api/settings/updates.js (the branch-switch password check),
//   routes/api/settings/maintenance.js (the Delete All and Restore Defaults password check)
//
// Uses
//   configService (passwordHash), config/passwordDefaults, bcrypt
//
// Change impact
//   The messages and status codes of change() are shown in the admin panel as they are.
const bcrypt = require('bcrypt');
const configService = require('./configService');
const { DEFAULT_PASSWORD, HASH_ROUNDS } = require('../config/passwordDefaults');
const { limits } = require('../../shared/contract.json');

const MIN_LENGTH = limits.passwordMinLength;

function verify(password) {
  return bcrypt.compare(password, configService.get('passwordHash'));
}

async function change(current, next) {
  if (!current || !next) {
    return { status: 400, error: 'current and newPassword are required' };
  }
  if (next.length < MIN_LENGTH) {
    return { status: 400, error: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (!(await verify(current))) {
    return { status: 403, error: 'Current password is incorrect' };
  }
  await configService.set('passwordHash', await bcrypt.hash(next, HASH_ROUNDS));
  return { ok: true };
}

let cached = { hash: null, result: false };
async function usesDefault() {
  const hash = configService.get('passwordHash');
  if (!hash) return false;
  if (cached.hash !== hash) {
    cached = { hash, result: await bcrypt.compare(DEFAULT_PASSWORD, hash) };
  }
  return cached.result;
}

module.exports = { verify, change, usesDefault, MIN_LENGTH };
