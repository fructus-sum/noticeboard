const jwt = require('jsonwebtoken');
const macService = require('../services/macService');
const configService = require('../services/configService');
const logger = require('../utils/logger');

async function adminAuth(req, res, next) {
  let mac, ip, approved;
  try {
    ({ mac, ip, approved } = await macService.resolveRequest(req));
  } catch (err) {
    logger.error('Admin auth error', { err: err.message });
    return res.status(404).send('Not Found');
  }

  if (!approved) {
    logger.warn('Admin: MAC denied', { ip, mac });
    return res.status(404).send('Not Found');
  }

  const token = req.cookies.nb_admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, configService.get('jwtSecret'));
    req.clientMac = mac;
    req.admin = payload;
    next();
  } catch (err) {
    logger.warn('Admin: JWT invalid', { ip, err: err.message });
    res.clearCookie('nb_admin_token', { httpOnly: true, sameSite: 'strict' });
    return res.status(401).json({ error: 'Session expired' });
  }
}

module.exports = adminAuth;
