// server/middleware/passwordLimiter.js — the limit on wrong admin passwords inside the admin panel
//
// Responsibilities
//   One limiter for every place the admin panel asks for the password again before something
//   that can't easily be undone (a branch switch, Delete All, Restore Defaults), so wrong tries
//   count together: 5 per 15 minutes, like logging in. Only wrong passwords (403s) count.
//
// Provides
//   wrongPasswordLimiter   express-rate-limit middleware
//
// Used by
//   routes/api/settings/updates.js (/updates/verify-password),
//   routes/api/settings/maintenance.js (/maintenance/verify-password)
//
// Uses
//   express-rate-limit
const rateLimit = require('express-rate-limit');

const wrongPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 403,
  message: { error: 'Too many wrong passwords. Nothing was changed. Try again in 15 minutes.' },
});

module.exports = { wrongPasswordLimiter };
