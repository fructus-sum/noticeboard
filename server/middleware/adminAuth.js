// server/middleware/adminAuth.js — the admin API's guard: an approved device with a valid admin login
//
// The check itself is middleware/access.js (requireAdmin); this name keeps the mounting in
// routes/api/index.js readable.
//
// Used by
//   routes/api/index.js (the settings and slideshows APIs)
const { requireAdmin } = require('./access');

module.exports = requireAdmin;
