const os = require('os');

// This device's LAN addresses (IPv4, not loopback),
// e.g. [{ name: 'eth0', ip: '192.168.1.20', mac: 'dc:a6:32:01:02:03' }]
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

module.exports = { lanInterfaces };
