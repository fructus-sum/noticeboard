// Installations that update themselves, as the server sees them (SYSTEM_DESIGN §18.7 phase 2): a
// Full update (the admin password, a one-time token, then the request "full" for update.sh; main
// only, with the system step set up), the installer notice after a failed system step, and the
// screens' warning mark for a version waiting on any update schedule.
//   node tests/run.js api full-update
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done, git, sleep } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

// What a screen has as display:settings a few seconds after it connects: the server sends them at
// once, and again when its start-up reading of the update state is done
function displaySettings(base) {
  return new Promise((resolve) => {
    let last = null;
    const sock = io(base, { transports: ['websocket'], reconnection: false });
    sock.on('connect', () => sock.emit('display:ready'));
    sock.on('display:settings', (s) => { last = s; });
    setTimeout(() => { sock.close(); resolve(last); }, 4000);
  });
}

(async () => {
  const env = makeApp({ port: 3969 });
  git(env.APP, 'checkout', '-q', '-B', 'main');
  const head = git(env.APP, 'rev-parse', 'HEAD');
  const units = path.join(env.T, 'systemd');
  const unit = (dir, name) => { fs.mkdirSync(path.join(units, dir), { recursive: true }); fs.writeFileSync(path.join(units, dir, name), ''); };
  unit('timers.target.wants', 'noticeboard-update.timer');
  unit('paths.target.wants', 'noticeboard-update.path');
  unit('paths.target.wants', 'noticeboard-system.path');
  const file = (p) => path.join(env.APP, p);
  const request = () => (fs.existsSync(file('tmp/update-request')) ? fs.readFileSync(file('tmp/update-request'), 'utf8').trim() : null);
  const clear = () => { fs.rmSync(file('tmp/update-request'), { force: true }); fs.rmSync(file('data/update-status.json'), { force: true }); };
  // A version waiting on a daily schedule, before the server starts (the screens' state is read then)
  fs.mkdirSync(file('data'), { recursive: true });
  fs.writeFileSync(file('data/update-schedule.env'), 'NOTICEBOARD_UPDATE_EVERY=daily\nNOTICEBOARD_UPDATE_TIME=03:00\n');
  fs.writeFileSync(file('data/update-check.json'), JSON.stringify({ result: 'available', available: 'f'.repeat(40), availableSubject: 'Newer', nextInstall: '2026-09-30T03:00:00Z', time: new Date().toISOString() }));

  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();

  const shown = await displaySettings(env.base);
  check('a version waiting on a daily schedule: the screens show their warning mark (any schedule now)', shown?.updateAvailable === true, JSON.stringify(shown));

  let info = (await s.api('GET', '/api/settings/updates')).data;
  check('updates info: the system step is set up, no answer from it yet', info.systemStep === true && info.lastSystemStep === null, JSON.stringify({ systemStep: info.systemStep, last: info.lastSystemStep }));

  const token = async () => (await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'full-update' })).data?.token;
  let r = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'wrong', action: 'full-update' });
  check('wrong password: refused, nothing asked for', r.status === 403 && request() === null, r.data?.error);
  r = await s.api('POST', '/api/settings/maintenance/full-update', { token: 'f'.repeat(48) });
  check('a made-up token: refused, nothing asked for', r.status === 403 && request() === null, r.data?.error);
  r = await s.api('POST', '/api/settings/maintenance/full-update', { token: await token() });
  check('Full update: the request "full" for update.sh, the status says it was asked for', r.status === 200 && request() === 'full'
    && r.data.status?.state === 'requested' && /Full update requested/.test(r.data.status?.message) && r.data.busy === true, JSON.stringify(r.data?.status ?? r.data));
  r = await s.api('POST', '/api/settings/maintenance/full-update', { token: await token() });
  check('another while one is waiting: refused', r.status === 409 && /already in progress/.test(r.data.error), r.data?.error);
  clear();

  fs.rmSync(path.join(units, 'paths.target.wants', 'noticeboard-system.path'));
  r = await s.api('POST', '/api/settings/maintenance/full-update', { token: await token() });
  check("the system step not set up: refused, says to run the installer once", r.status === 409 && /isn't set up/.test(r.data.error) && request() === null, r.data?.error);
  unit('paths.target.wants', 'noticeboard-system.path');

  git(env.APP, 'checkout', '-q', '-B', 'feature/x');
  fs.writeFileSync(file('data/update-branch.env'), 'NOTICEBOARD_BRANCH=feature/x\n');
  r = await s.api('POST', '/api/settings/maintenance/full-update', { token: await token() });
  check('on a branch: refused, its installer is run by hand', r.status === 409 && /follows feature\/x/.test(r.data.error) && request() === null, r.data?.error);

  // The installer notice and the system step's answers
  const installer = async () => (await s.api('GET', '/api/settings/updates/installer')).data;
  fs.writeFileSync(file('tmp/system-result'), JSON.stringify({ commit: 'b'.repeat(40), release: 'v9.0.0', result: 'failed', message: 'No cage package.', time: '2026-09-29T08:00:00Z' }));
  let st = await installer();
  check('on a branch: a failed system step is no business of its (the installer is run by hand)', !st.systemFailed && st.automatic === false, JSON.stringify(st));
  git(env.APP, 'checkout', '-q', 'main');
  fs.writeFileSync(file('data/update-branch.env'), 'NOTICEBOARD_BRANCH=main\n');
  st = await installer();
  check('on main, the system step failed for a Release not running yet: the notice, with its message', st.needed === true && st.automatic === true
    && st.systemFailed?.release === 'v9.0.0' && st.systemFailed?.message === 'No cage package.', JSON.stringify(st));
  fs.writeFileSync(file('tmp/system-result'), JSON.stringify({ commit: 'b'.repeat(40), release: 'v9.0.0', result: 'done', message: 'All set.', time: '2026-09-29T08:00:00Z' }));
  st = await installer();
  check('its last run done: no notice', st.needed === false && !st.systemFailed, JSON.stringify(st));
  fs.writeFileSync(file('tmp/system-result'), JSON.stringify({ commit: head, release: 'v8.0.0', result: 'failed', message: 'Old news.', time: '2026-09-29T08:00:00Z' }));
  st = await installer();
  check('a failed run for the version already running (it got there another way): no notice', st.needed === false, JSON.stringify(st));
  info = (await s.api('GET', '/api/settings/updates')).data;
  check("updates info: the system step's last answer", info.lastSystemStep?.message === 'Old news.');

  await sleep(100);
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
