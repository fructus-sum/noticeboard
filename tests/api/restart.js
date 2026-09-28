// The port and restarting the Server (SYSTEM_DESIGN §18.5 item 4): PUT /api/settings checks the port
// (a whole number from 1024 to 65535); a new one only takes effect after a restart, which
// GET /settings/maintenance/restart and the screens' display:settings (restartNeeded) say; the
// restart needs the admin password's token, answers, then ends the process (systemd starts it again
// on a Pi; here the test does), and the Server comes back on the new port with nothing to restart.
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

const displaySettings = (base) => new Promise((resolve) => {
  const sock = io(base, { transports: ['websocket'] });
  sock.on('display:settings', (d) => { sock.close(); resolve(d); });
});

(async () => {
  const env = makeApp({ port: 3960 });
  const s = server(env);
  await s.start();
  await s.login();

  for (const [port, what] of [[80, 'below 1024'], [70000, 'above 65535'], ['abc', 'not a number'], [3000.5, 'not whole']]) {
    const r = await s.api('PUT', '/api/settings', { port });
    check(`a port ${what} is refused (400)`, r.status === 400 && r.data.error === 'The port must be a whole number from 1024 to 65535', JSON.stringify(r.data));
  }
  const before = (await s.api('GET', '/api/settings/maintenance/restart')).data;
  check('nothing to restart at first', before.restartNeeded === false && before.port.running === 3960 && before.port.saved === 3960, JSON.stringify(before));
  check('  … nor on the screens', (await displaySettings(env.base)).restartNeeded === false);

  const saved = await s.api('PUT', '/api/settings', { port: 3961 });
  check('a new port is saved', saved.status === 200 && saved.data.port === 3961);
  const needed = (await s.api('GET', '/api/settings/maintenance/restart')).data;
  check('  … and needs a restart (still running on the old one)', needed.restartNeeded === true && needed.port.running === 3960 && needed.port.saved === 3961, JSON.stringify(needed));
  check('  … which the screens are told (their warning mark)', (await displaySettings(env.base)).restartNeeded === true);

  const noToken = await s.api('POST', '/api/settings/maintenance/restart', {});
  check('restarting without the password\'s token is refused (403)', noToken.status === 403);
  const token = (await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'restart' })).data.token;
  const restart = await s.api('POST', '/api/settings/maintenance/restart', { token });
  check('with it, the Server answers that it restarts', restart.status === 200 && restart.data.restarting === true && restart.data.saved === 3961, JSON.stringify(restart.data));
  let down = false;
  for (let i = 0; i < 40 && !down; i++) {
    await sleep(250);
    down = await fetch(`${env.base}/api/auth/status`).then(() => false, () => true);
  }
  check('  … then stops (systemd starts it again on a Pi)', down);

  // As systemd would: start it again; it listens on the saved port
  await s.stop();
  env.port = 3961;
  env.base = 'http://localhost:3961';
  await s.start();
  await s.login();
  const after = (await s.api('GET', '/api/settings/maintenance/restart')).data;
  check('started again: on the new port, nothing left to restart', after.restartNeeded === false && after.port.running === 3961, JSON.stringify(after));

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
