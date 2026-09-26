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

module.exports = router;
