const bcrypt = require('bcrypt');

// The password every new installation starts with (configService sets it)
const DEFAULT_PASSWORD = 'Admin@12345';

// Whether the admin password is still the default. bcrypt is slow on purpose, so the answer
// is remembered until the stored hash changes.
let cached = { hash: null, result: false };

async function usesDefaultPassword(hash) {
  if (!hash) return false;
  if (cached.hash !== hash) {
    cached = { hash, result: await bcrypt.compare(DEFAULT_PASSWORD, hash) };
  }
  return cached.result;
}

module.exports = { DEFAULT_PASSWORD, usesDefaultPassword };
