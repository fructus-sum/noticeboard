const macService = require('../services/macService');
const logger = require('../utils/logger');

function macFilter(req, res, next) {
  macService
    .resolveRequest(req)
    .then(({ mac, ip, approved }) => {
      if (!approved) {
        logger.warn('Display: MAC denied', { ip, mac });
        return res.status(404).send('Not Found');
      }
      req.clientMac = mac;
      next();
    })
    .catch((err) => {
      logger.error('MAC filter error', { err: err.message });
      res.status(404).send('Not Found');
    });
}

module.exports = macFilter;
