// Only approved devices (MAC filtering) may reach the displays, media, logo, guide and admin pages.
// The check itself: middleware/access.js
const { requireApprovedDevice } = require('./access');

module.exports = requireApprovedDevice('Display');
