// server/routes/api/client.js — what a Client only asks its Server for, to update itself
//
//   GET /api/client/version     { version, commit, clientHash }
//   GET /api/client/bundle      the installer at the running commit (tar.gz)
//   GET /api/client/bundle.sig  its ed25519 signature (64 bytes)
//   GET /api/client/key         the public key a Client pins at install (PEM)
//
// Behind the MAC filter, like the viewer the Client shows (SYSTEM_DESIGN §18.7 phase 3).
//
// Used by
//   routes/api/index.js; installers/client/noticeboard-client (check, trust-server) and the
//   installer's Client step (the key)
//
// Uses
//   services/clientBundle, middleware/asyncRoute
//
// Change impact
//   Every Client only calls these: the paths and answers must stay as they are (§15).
const express = require('express');
const clientBundle = require('../../services/clientBundle');
const { route, jsonRoute } = require('../../middleware/asyncRoute');

const router = express.Router();

router.get('/version', jsonRoute(() => clientBundle.version()));

router.get('/bundle', route(async (req, res) => {
  const { file } = await clientBundle.bundle();
  res.type('application/gzip').sendFile(file);
}));

router.get('/bundle.sig', route(async (req, res) => {
  const { signature } = await clientBundle.bundle();
  res.type('application/octet-stream').send(signature);
}));

router.get('/key', route(async (req, res) => {
  res.type('application/x-pem-file').send(await clientBundle.publicKey());
}));

module.exports = router;
