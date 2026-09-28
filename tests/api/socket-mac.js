// MAC filtering on the live connection (SYSTEM_DESIGN §18.5 item 1): with filtering on, a device the
// Server can't approve is refused at connect and gets nothing; the Server itself always connects;
// a device connected while filtering was off is disconnected when it is turned on. The unapproved
// device is this PC reached through its own network address (the Server can't find a MAC for it),
// like the MAC-denied checks in contract.js; without a network address the test is skipped.
const os = require('os');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

// Connects and says what happened within a few seconds: connected (and the events it got) or refused
function connect(base) {
  return new Promise((resolve) => {
    const events = [];
    const sock = io(base, { transports: ['websocket'], reconnection: false });
    sock.onAny((name) => events.push(name));
    sock.on('connect', () => sock.emit('display:ready'));
    sock.on('connect_error', (err) => { sock.close(); resolve({ connected: false, error: err.message, events }); });
    setTimeout(() => resolve({ connected: sock.connected, events, sock }), 2500);
  });
}

(async () => {
  const lan = lanAddress();
  if (!lan) {
    console.log('SKIPPED: no network address to connect from');
    process.exit(0);
  }
  const env = makeApp({ port: 3959 });
  const s = server(env);
  await s.start();
  await s.login();
  const remote = `http://${lan}:${env.port}`;

  const before = await connect(remote);
  check('filtering off: any device connects and gets the playlist', before.connected && before.events.includes('playlist:update'), JSON.stringify(before.events));
  let disconnected = '';
  before.sock.on('disconnect', (reason) => { disconnected = reason; });

  const on = await s.api('PUT', '/api/settings', { macFiltering: { enabled: true, approved: [{ mac: 'aa:bb:cc:dd:ee:ff', label: 'Somewhere else' }] } });
  check('MAC filtering turned on', on.status === 200, JSON.stringify(on.data));
  for (let i = 0; i < 40 && !disconnected; i++) await sleep(100);
  check('  … the device connected before is disconnected by the Server', disconnected === 'io server disconnect', disconnected || 'still connected');

  const refused = await connect(remote);
  check('an unapproved device is refused at connect, with nothing sent', !refused.connected && refused.error === 'Not Found' && refused.events.length === 0, JSON.stringify({ connected: refused.connected, error: refused.error, events: refused.events }));
  const local = await connect(env.base);
  check('the Server itself still connects', local.connected && local.events.includes('playlist:update'), JSON.stringify(local.events));
  local.sock?.close();

  await s.api('PUT', '/api/settings', { macFiltering: { enabled: false, approved: [{ mac: 'aa:bb:cc:dd:ee:ff', label: 'Somewhere else' }] } });
  const again = await connect(remote);
  check('filtering off again: the device connects', again.connected, JSON.stringify({ connected: again.connected, events: again.events }));
  again.sock?.close();

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
