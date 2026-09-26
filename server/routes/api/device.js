const express = require('express');
const { lanInterfaces } = require('../../utils/networkInfo');

const router = express.Router();

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

// The address a request came from or arrived at, without IPv4-in-IPv6 wrapping
function plainAddress(address = '') {
  return address.replace(/^::ffff:/, '');
}

// This server's IP addresses and port, for the display's location pin: how to reach the
// Noticeboard server from another device. They're the server's own addresses (never the
// viewing device's), and the one this display used to reach the server comes first.
// MAC addresses are admin-only (see settings).
router.get('/', (req, res) => {
  const used = plainAddress(req.socket.localAddress);
  const addresses = lanInterfaces()
    .map(({ name, ip }) => ({ name, ip }))
    .sort((a, b) => (b.ip === used) - (a.ip === used));
  res.json({ port: req.socket.localPort, addresses });
});

// ── Leaving kiosk mode on one screen ──────────────────────────────────────────
// The viewer's exit button asks here; the kiosk script on the same device collects the
// request (it checks every few seconds) and closes its full-screen browser. Requests are kept
// per device (by IP address, with every loopback address counting as the server itself), so a
// screen can only ever affect itself, never the server or other displays.
const EXIT_REQUEST_MS = 60 * 1000;
const exitRequests = new Map();   // device -> expiry time

function deviceOf(req) {
  const address = req.socket.remoteAddress || '';
  return LOOPBACK.test(address) ? 'this-server' : plainAddress(address);
}

router.post('/kiosk-exit', (req, res) => {
  exitRequests.set(deviceOf(req), Date.now() + EXIT_REQUEST_MS);
  res.json({ ok: true });
});

// Called by the kiosk script: {"exit":true} once per request
router.post('/kiosk-exit/claim', (req, res) => {
  const device = deviceOf(req);
  const expiry = exitRequests.get(device);
  exitRequests.delete(device);
  for (const [d, e] of exitRequests) {
    if (e < Date.now()) exitRequests.delete(d);
  }
  res.json({ exit: !!expiry && expiry >= Date.now() });
});

module.exports = router;
