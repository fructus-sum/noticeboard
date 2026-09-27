// server/services/macService.js — which device a request comes from, and whether it's approved
//
// Provides
//   resolveRequest(req) → { mac, ip, approved }; this Pi itself counts as 'localhost', approved
//   isMacApproved(mac)  → approved when MAC filtering is off, for localhost, or when on the list
//
// Used by
//   middleware/access.js
//
// Uses
//   utils/macLookup (isLocalhost, lookupMac), utils/network (plainAddress), services/configService
//   (macFiltering), utils/logger (a debug line per lookup)
const { lookupMac, isLocalhost } = require('../utils/macLookup');
const { plainAddress } = require('../utils/network');
const configService = require('./configService');
const logger = require('../utils/logger');

function getClientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || '';
}

async function resolveRequest(req) {
  const ip = getClientIp(req);
  const normalized = plainAddress(ip);

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

module.exports = { resolveRequest, isMacApproved };
