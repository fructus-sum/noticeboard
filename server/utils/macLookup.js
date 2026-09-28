// server/utils/macLookup.js — a device's MAC address, and the MAC filter's "the Server itself" rule
//
// Provides
//   isLocalhost(address)   127.0.0.1, ::1, ::ffff:127.0.0.1, or localhost (not an empty address)
//   lookupMac(address)     the MAC from the ARP table (node-arp), lower-case; 'localhost' for the
//                          Server itself; null if unknown or the address is empty
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

// "The Server itself" for MAC filtering: exactly these (unlike network.isLoopback, which is used
// for kiosk exits: SYSTEM_DESIGN §14 D6). An empty address isn't the Server: a request whose address
// can't be told is refused while MAC filtering is on (§18.5 item 3).
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

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
