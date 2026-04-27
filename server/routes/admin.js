const express = require('express');
const path = require('path');
const { ROOT } = require('../utils/pathHelpers');

const router = express.Router();
const ADMIN_DIST = path.join(ROOT, 'client', 'admin', 'dist');

const FALLBACK = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Noticeboard Admin</title>
<style>body{margin:0;background:#1a1a2e;color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;}</style>
</head><body><p>Admin app not yet built — run <code>npm run build</code></p></body></html>`;

// SPA catch-all: serve index.html for all admin routes (Vue Router handles sub-routes)
router.get('*', (req, res) => {
  res.sendFile(path.join(ADMIN_DIST, 'index.html'), (err) => {
    if (err) res.send(FALLBACK);
  });
});

module.exports = router;
