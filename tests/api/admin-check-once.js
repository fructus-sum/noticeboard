// Every admin API request checks the device (a MAC lookup) and the login once. Before stage 2 the
// slide routes checked twice (OLD_SYSTEM_DESIGN §16 #5). Counted from the server's debug log,
// which records each lookup for a device that isn't this machine; so the requests are made to this
// PC's network address.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeApp, server, check, done, sleep } = require('../helpers/app.js');

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
  }
  return null;
}

(async () => {
  const lan = lanAddress();
  if (!lan) {
    console.log('SKIPPED: no network address to make a non-local request from');
    process.exit(0);
  }
  const env = makeApp({ port: 3927 });
  const s = server(env);
  await s.start({ NOTICEBOARD_LOG_LEVEL: 'debug' });   // one "MAC resolved" line per lookup
  await s.login();
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Checked once' })).data.folder;
  const log = path.join(env.APP, 'logs', 'app.log');
  const lookups = () => fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('MAC resolved')).length;

  const remote = `http://${lan}:${env.port}`;
  for (const [name, p] of [['a slideshow', `/api/slideshows/${folder}`], ['its slides', `/api/slideshows/${folder}/slides`], ['settings', '/api/settings']]) {
    const before = lookups();
    const res = await fetch(remote + p, { headers: { Cookie: s.cookie() } });
    await sleep(300);   // let the log line reach the file
    const n = lookups() - before;
    check(`${name}: answered, with one device check`, res.status === 200 && n === 1, `HTTP ${res.status}, ${n} lookup(s)`);
  }
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
