// server/middleware/macFilter.js — only approved devices (MAC filtering) reach the displays, media, logo, guide and admin pages
//
// The check itself is middleware/access.js (requireApprovedDevice('Display'), which logs a denial
// as "Display: MAC denied").
//
// Used by
//   routes/index.js, routes/api/index.js (/auth, /device)
const { requireApprovedDevice } = require('./access');

module.exports = requireApprovedDevice('Display');
