// server/utils/macLookup.js — a device's MAC address, and the MAC filter's "this Pi itself" rule
//
// Provides
//   isLocalhost(address)   127.0.0.1, ::1, ::ffff:127.0.0.1, localhost or an empty address
//   lookupMac(address)     the MAC from the ARP table (node-arp), lower-case; 'localhost' for this Pi;
//                          null if unknown
//
// Used by
//   services/macService, server/test/foundations.test.js
//
// Uses
//   node-arp, utils/network (plainAddress)
const { promisify } = require('util');
const arp = require('node-arp');
const { plainAddress } = require('./network');

const getMAC = promisify(arp.getMAC);

// "This Pi itself" for MAC filtering: exactly these, including an empty address (unlike
// network.isLoopback, which is used for kiosk exits). Kept as it is on purpose (SYSTEM_DESIGN §14 D6).
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
