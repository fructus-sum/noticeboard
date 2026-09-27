// server/routes/spa.js — the web apps' "any other page" route
//
// Provides
//   spaFallback(distDir, { title, background, name }) → a router that answers every GET with the
//     app's built index.html (its own router then shows the right page), or, if the app hasn't
//     been built, a small page saying so ("<name> app not yet built — run npm run build")
//
// Used by
//   routes/index.js, for the viewer (/) and the admin panel (/admin)
const express = require('express');
const path = require('path');

function spaFallback(distDir, { title, background, name }) {
  const notBuilt = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${title}</title>
<style>body{margin:0;background:${background};color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;}</style>
</head><body><p>${name} app not yet built — run <code>npm run build</code></p></body></html>`;

  const router = express.Router();
  router.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) res.send(notBuilt);
    });
  });
  return router;
}

module.exports = { spaFallback };
