// server/utils/network.js — network addresses: this server's own, and a request's
//
// Responsibilities
//   The one place that knows how addresses look: IPv4 addresses reported inside IPv6 (::ffff:),
//   loopback addresses, and this machine's LAN interfaces. Deciding who is *allowed* is not here
//   (see services/macService.js, which keeps its own rule for "this Pi itself").
//
// Provides
//   plainAddress(address) → string   the address without the ::ffff: prefix ('' for none)
//   isLoopback(address)   → boolean  127.0.0.0/8, ::1 or ::ffff:127.x (i.e. this machine)
//   lanInterfaces()       → [{ name, ip, mac }]  non-internal IPv4 interfaces, e.g.
//                                    [{ name: 'eth0', ip: '192.168.1.20', mac: 'dc:a6:32:01:02:03' }]
//
// Used by
//   routes/api/device.js (the location pin, kiosk-exit requests per device),
//   routes/api/settings.js (the admin's device banner), utils/macLookup.js, services/macService.js
//
// Change impact
//   isLoopback decides which kiosk-exit requests count as "the server's own screen". plainAddress
//   is used when looking up MAC addresses; changing it changes who MAC filtering recognises.
const os = require('os');

function plainAddress(address) {
  if (!address) return '';
  return String(address).replace(/^::ffff:/, '');
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
function isLoopback(address) {
  return LOOPBACK.test(address || '');
}

function lanInterfaces() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node 18.0–18.3 reported family as a number
      if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal) {
        result.push({ name, ip: addr.address, mac: addr.mac });
      }
    }
  }
  return result;
}

module.exports = { plainAddress, isLoopback, lanInterfaces };
