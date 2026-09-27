const { promisify } = require('util');
const arp = require('node-arp');
const { plainAddress } = require('./network');

const getMAC = promisify(arp.getMAC);

// "This Pi itself" for MAC filtering: exactly these, including an empty address (unlike
// network.isLoopback, which is used for kiosk exits). Kept as it is (refactor decision B2).
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '']);

function isLocalhost(ip) {
  return LOCALHOST_IPS.has(plainAddress(ip));
}

async function lookupMac(ip) {
  const normalized = plainAddress(ip);
  if (!normalized) return null;
  if (isLocalhost(normalized)) return 'localhost';

  try {
    const mac = await getMAC(normalized);
    return mac ? mac.toLowerCase() : null;
  } catch {
    return null;
  }
}

module.exports = { lookupMac, isLocalhost };
