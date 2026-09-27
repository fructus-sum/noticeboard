// server/config/passwordDefaults.js — the admin password every installation starts with
//
// A leaf module (no imports), so both configService (which hashes it into a new config.json) and
// services/adminPassword.js (which warns while it's still in use) can use it without importing
// each other. Not in defaults.js, because that object is copied into config.json as it is.
//
// Provides
//   DEFAULT_PASSWORD   'Admin@12345' (also in the README, the user guide and the installer's summary)
//   HASH_ROUNDS        bcrypt cost for new password hashes
module.exports = {
  DEFAULT_PASSWORD: 'Admin@12345',
  HASH_ROUNDS: 10,
};
