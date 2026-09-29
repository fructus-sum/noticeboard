// server/utils/macLookup.js — a device's MAC address, and the MAC filter's "the Server itself" rule
//
// Provides
//   isLocalhost(address)   127.0.0.1, ::1, ::ffff:127.0.0.1, or localhost (not an empty address)
//   lookupMac(address)     the MAC from the ARP table, lower-case; 'localhost' for the Server
//                          itself; null if unknown or the address is empty. On Linux the kernel's
//                          table (/proc/net/arp) is read directly: no program is run, so nothing is
//                          missing (arp is in net-tools, which Debian doesn't install) and nothing
//                          can crash the server, and the device that just sent the request is
//                          already in it (SYSTEM_DESIGN §18.7). Elsewhere (a PC running the tests),
//                          node-arp.
//
// Used by
//   services/macService, server/test/foundations.test.js
//
// Uses
//   node-arp (off Linux), utils/network (plainAddress), utils/pathHelpers (arpTablePath)
const fs = require('fs/promises');
const { promisify } = require('util');
const arp = require('node-arp');
const { plainAddress } = require('./network');
const { arpTablePath } = require('./pathHelpers');

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
    const mac = process.platform === 'linux' || process.env.NOTICEBOARD_ARP_TABLE
      ? await macFromArpTable(normalized) : await getMAC(normalized);
    return mac ? mac.toLowerCase() : null;
  } catch {
    return null;
  }
}

// /proc/net/arp: "IP address  HW type  Flags  HW address  Mask  Device" per line; flags 0x0 is an
// entry still waiting for an answer (its address all zeros)
async function macFromArpTable(ip) {
  const table = await fs.readFile(arpTablePath(), 'utf8');
  for (const line of table.split('\n').slice(1)) {
    const [address, , flags, mac] = line.trim().split(/\s+/);
    if (address === ip && flags !== '0x0' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac || '') && mac !== '00:00:00:00:00:00') return mac;
  }
  return null;
}

module.exports = { lookupMac, isLocalhost };
