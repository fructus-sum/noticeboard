// Graceful shutdown: with a display connected, SIGTERM (what systemd and update.sh send) must end
// the server within a few seconds, not hang until systemd gives up after 90 s.
// The server runs inside a child process that fires its own SIGTERM handler, so the test works
// on Windows too (where signals can't be sent to another process).
const path = require('path');
const { spawn } = require('child_process');

if (process.env.NB_SHUTDOWN_CHILD) {
  // Child: load the server from the app copy (cwd), connect a display, then fire SIGTERM
  let t0 = null;
  process.on('exit', (code) => { if (t0) console.log(`RESULT ${((Date.now() - t0) / 1000).toFixed(1)}`); });
  require(path.join(process.cwd(), 'server/index.js'));
  const { io } = require(path.join(process.env.NODE_PATH, 'socket.io-client'));
  setTimeout(() => {
    const s = io(process.env.NB_BASE, { reconnection: false, transports: ['websocket'] });
    s.on('connect', () => setTimeout(() => { t0 = Date.now(); process.emit('SIGTERM'); }, 500));
  }, 2500);
  setTimeout(() => { console.log('RESULT hung'); process.exit(2); }, 20000).unref();
} else {
  const { MODULES, makeApp, check, done } = require('../helpers/app.js');
  const env = makeApp({ port: 3925 });
  const child = spawn(process.execPath, [__filename], {
    cwd: env.APP,
    env: { ...process.env, NB_SHUTDOWN_CHILD: '1', NB_BASE: env.base, NODE_PATH: MODULES, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('exit', (code) => {
    const seconds = Number((out.match(/RESULT ([\d.]+)/) || [])[1]);
    check('SIGTERM with a display connected: the server exits cleanly within 6 s', code === 0 && seconds <= 6, `code ${code}, ${out.match(/RESULT .*/)?.[0] ?? 'no result'}`);
    done(env);
  });
}
