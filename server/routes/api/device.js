const express = require('express');
const { lanInterfaces } = require('../../utils/networkInfo');

const router = express.Router();

// IP addresses and port for the display's info pop-up. MAC addresses are admin-only (see settings).
router.get('/', (req, res) => {
  res.json({
    port: req.socket.localPort,
    addresses: lanInterfaces().map(({ name, ip }) => ({ name, ip })),
  });
});

// ── Leaving kiosk mode on one screen ──────────────────────────────────────────
// The viewer's exit button asks here; the kiosk script on the same device collects the
// request (it checks every few seconds) and closes its full-screen browser. Requests are kept
// per device (by IP address, with every loopback address counting as the server itself), so a
// screen can only ever affect itself, never the server or other displays.
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const EXIT_REQUEST_MS = 60 * 1000;
const exitRequests = new Map();   // device -> expiry time

function deviceOf(req) {
  const address = req.socket.remoteAddress || '';
  return LOOPBACK.test(address) ? 'this-server' : address.replace(/^::ffff:/, '');
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
