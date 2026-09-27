// server/routes/api/device.js — /api/device: the location pin's addresses and the kiosk exit button
//
// Responsibilities
//   GET  /                    this server's IP addresses and port (never the viewing device's), the
//                             one the display used first. MAC addresses are admin-only (settings).
//   POST /kiosk-exit          the viewer's exit button: this device asks to leave kiosk mode (60 s)
//   POST /kiosk-exit/claim    the kiosk script on the same device collects it: {"exit":true} once
//   Requests are kept per device (IP address; every loopback address is the server itself), so a
//   screen can only ever affect itself.
//
// Used by
//   routes/api/index.js (behind the MAC filter); the viewer (DeviceInfo, ExitKiosk); the kiosk scripts
//
// Uses
//   utils/network (lanInterfaces, plainAddress, isLoopback)
//
// Change impact
//   The claim must answer exactly {"exit":true}, without spaces: installed kiosk scripts compare the
//   text (CURRENT_SYSTEM_DESIGN §15).
const express = require('express');
const { lanInterfaces, plainAddress, isLoopback } = require('../../utils/network');

const router = express.Router();

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
  return isLoopback(address) ? 'this-server' : plainAddress(address);
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
