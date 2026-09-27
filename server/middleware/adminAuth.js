// An approved device (MAC filtering) with a valid admin login, for the admin API.
// The check itself: middleware/access.js
const { requireAdmin } = require('./access');

module.exports = requireAdmin;
