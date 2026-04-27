const { lookupMac, isLocalhost, normalizeIp } = require('../utils/macLookup');
const configService = require('./configService');
const logger = require('../utils/logger');

function getClientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || '';
}

async function resolveRequest(req) {
  const ip = getClientIp(req);
  const normalized = normalizeIp(ip);

  if (isLocalhost(normalized)) {
    return { mac: 'localhost', ip: normalized, approved: true };
  }

  const mac = await lookupMac(ip);
  const approved = isMacApproved(mac);

  logger.debug('MAC resolved', { ip: normalized, mac, approved });
  return { mac, ip: normalized, approved };
}

function isMacApproved(mac) {
  const macFiltering = configService.get('macFiltering');
  if (!macFiltering.enabled) return true;
  if (mac === 'localhost') return true;
  if (!mac) return false;

  return macFiltering.approved.some(
    (entry) => entry.mac.toLowerCase() === mac.toLowerCase()
  );
}

module.exports = { resolveRequest, isMacApproved, getClientIp };
