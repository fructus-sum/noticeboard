const path = require('path');
const { ROOT } = require('./pathHelpers');

// In development (npm run dev) Vite serves both web apps from this server, with hot reload, so
// development matches production: the viewer at / and the admin at /admin, both on the one
// application port. There's no separate admin (or viewer) port. Production serves the built
// apps from client/*/dist instead and never loads Vite.
async function createDevFrontends(httpServer) {
  const { createServer } = await import('vite');
  const start = (name) => createServer({
    configFile: path.join(ROOT, 'client', name, 'vite.config.js'),
    root: path.join(ROOT, 'client', name),
    appType: 'spa',
    // Hot reload runs over this server's own port (the admin's at /admin/, the viewer's at /)
    server: { middlewareMode: true, hmr: { server: httpServer } },
  });
  const [admin, display] = await Promise.all([start('admin'), start('display')]);
  return {
    admin: admin.middlewares,
    display: display.middlewares,
    close: () => Promise.all([admin.close(), display.close()]),
  };
}

module.exports = { createDevFrontends };
