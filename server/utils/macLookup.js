const { promisify } = require('util');
const arp = require('node-arp');

const getMAC = promisify(arp.getMAC);

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '']);

function normalizeIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function isLocalhost(ip) {
  const n = normalizeIp(ip);
  return LOCALHOST_IPS.has(n);
}

async function lookupMac(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  if (isLocalhost(normalized)) return 'localhost';

  try {
    const mac = await getMAC(normalized);
    return mac ? mac.toLowerCase() : null;
  } catch {
    return null;
  }
}

module.exports = { lookupMac, isLocalhost, normalizeIp };
