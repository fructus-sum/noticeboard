const macService = require('../services/macService');
const logger = require('../utils/logger');

// Session 1: MAC check only.
// Session 2 adds JWT verification for API routes.
function adminAuth(req, res, next) {
  macService
    .resolveRequest(req)
    .then(({ mac, ip, approved }) => {
      if (!approved) {
        logger.warn('Admin: MAC denied', { ip, mac });
        return res.status(404).send('Not Found');
      }
      req.clientMac = mac;
      next();
    })
    .catch((err) => {
      logger.error('Admin auth error', { err: err.message });
      res.status(404).send('Not Found');
    });
}

module.exports = adminAuth;
