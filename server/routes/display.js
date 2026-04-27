const express = require('express');
const path = require('path');
const { ROOT } = require('../utils/pathHelpers');

const router = express.Router();
const DISPLAY_DIST = path.join(ROOT, 'client', 'display', 'dist');

const FALLBACK = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Noticeboard Display</title>
<style>body{margin:0;background:#000;color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;}</style>
</head><body><p>Display app not yet built — run <code>npm run build</code></p></body></html>`;

// SPA catch-all: serve index.html for all display routes (Vue Router handles the rest)
router.get('*', (req, res) => {
  res.sendFile(path.join(DISPLAY_DIST, 'index.html'), (err) => {
    if (err) res.send(FALLBACK);
  });
});

module.exports = router;
