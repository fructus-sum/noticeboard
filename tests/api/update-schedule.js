// The update schedule on the server side (SYSTEM_DESIGN §14 D41): the schedule and a set time are
// checked, saved in data/update-schedule.env as update.sh reads it, and followed by a "check"
// request; Update now writes the status and an "install-now" request; the waiting version comes
// from update-check.json; the screens' warning mark (display:settings updateAvailable) shows
// while a version waits, on any schedule; nothing works without the updater set up.
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep, git } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

// What a screen ends up showing: it gets the settings on connecting, then again if the fresh check of
// the installer and update state (made when a screen connects) changed them
const settingsOnConnect = (base) => new Promise((resolve) => {
  let last = null;
  const sock = io(base, { transports: ['websocket'] });
  sock.on('display:settings', (s) => { last = s; });
  setTimeout(() => { sock.close(); resolve(last); }, 2500);
});

(async () => {
  const env = makeApp({ port: 3946 });
  const units = path.join(env.T, 'systemd');
  for (const [dir, unit] of [['timers.target.wants', 'noticeboard-update.timer'], ['paths.target.wants', 'noticeboard-update.path']]) {
    fs.mkdirSync(path.join(units, dir), { recursive: true });
    fs.writeFileSync(path.join(units, dir, unit), '');
  }
  const scheduleFile = path.join(env.APP, 'data', 'update-schedule.env');
  const requestFile = path.join(env.APP, 'tmp', 'update-request');
  const checkFile = path.join(env.APP, 'data', 'update-check.json');
  const request = () => (fs.existsSync(requestFile) ? fs.readFileSync(requestFile, 'utf8') : null);
  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();

  let info = (await s.api('GET', '/api/settings/updates')).data;
  check('no schedule yet: every 15 minutes, nothing waiting', JSON.stringify(info.schedule) === '{"every":"15min","time":"00:00","day":0,"at":null}' && info.waiting === null, JSON.stringify(info.schedule));

  for (const [body, what] of [[{ every: 'sometimes' }, 'an unknown schedule'], [{ every: 'daily', time: '24:00' }, 'a bad time'], [{ every: 'weekly', day: 7 }, 'a bad day']]) {
    const r = await s.api('PUT', '/api/settings/updates/schedule', body);
    check(`${what} is refused (400), nothing saved`, r.status === 400 && !fs.existsSync(scheduleFile), JSON.stringify(r.data));
  }

  let r = await s.api('PUT', '/api/settings/updates/schedule', { every: 'weekly', time: '06:30', day: 3 });
  const text = fs.readFileSync(scheduleFile, 'utf8');
  check('a weekly schedule is saved as update.sh reads it', r.status === 200 && /^NOTICEBOARD_UPDATE_EVERY=weekly\nNOTICEBOARD_UPDATE_TIME=06:30\nNOTICEBOARD_UPDATE_DAY=3\nNOTICEBOARD_UPDATE_SINCE=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/.test(text), JSON.stringify(text));
  check('the answer shows it', JSON.stringify(r.data.schedule) === '{"every":"weekly","time":"06:30","day":3,"at":null}');
  check('then update.sh is asked to check (not to install)', request() === 'check\n', JSON.stringify(request()));
  fs.rmSync(requestFile);

  r = await s.api('PUT', '/api/settings/updates/install-at', { at: 'tomorrow' });
  check('a set time that isn\'t a time is refused (400)', r.status === 400);
  r = await s.api('PUT', '/api/settings/updates/install-at', { at: '2030-01-01T00:00:00.000Z' });
  check('a set time too far ahead is refused (400)', r.status === 400);
  const at = new Date(Date.now() + 3600e3);
  at.setUTCSeconds(0, 0);
  r = await s.api('PUT', '/api/settings/updates/install-at', { at: at.toISOString() });
  check('a set time is saved, the schedule kept', r.status === 200 && r.data.schedule.at === at.toISOString().replace('.000Z', 'Z') && r.data.schedule.every === 'weekly'
    && fs.readFileSync(scheduleFile, 'utf8').includes(`NOTICEBOARD_UPDATE_AT=${at.toISOString().replace('.000Z', 'Z')}\n`), JSON.stringify(r.data.schedule));
  check('  … and update.sh is asked to check', request() === 'check\n');
  r = await s.api('PUT', '/api/settings/updates/schedule', { every: 'manual' });
  check('changing the schedule keeps the set time', r.data.schedule.every === 'manual' && r.data.schedule.at === at.toISOString().replace('.000Z', 'Z'));

  // A version update.sh found but hasn't installed
  const head = git(env.APP, 'rev-parse', 'HEAD');
  const waiting = { result: 'available', branch: 'main', message: 'A new version is waiting.', time: new Date().toISOString(), available: 'a'.repeat(40), availableSubject: 'Better slides', availableDate: '2026-09-27T10:00:00Z', nextInstall: '' };
  fs.writeFileSync(checkFile, JSON.stringify(waiting));
  info = (await s.api('GET', '/api/settings/updates')).data;
  check('the waiting version is shown', info.waiting?.commit === 'a'.repeat(40) && info.waiting.subject === 'Better slides', JSON.stringify(info.waiting));
  let shown = await settingsOnConnect(env.base);
  check('manual updates and a version waiting: the screens show the warning mark', shown?.updateAvailable === true, JSON.stringify(shown));
  fs.writeFileSync(checkFile, JSON.stringify({ ...waiting, available: head }));
  info = (await s.api('GET', '/api/settings/updates')).data;
  check('the running version is never "waiting"', info.waiting === null);
  shown = await settingsOnConnect(env.base);
  check('  … and the mark goes', shown?.updateAvailable === false);
  fs.writeFileSync(checkFile, JSON.stringify(waiting));
  await s.api('PUT', '/api/settings/updates/schedule', { every: 'daily', time: '00:00' });
  shown = await settingsOnConnect(env.base);
  check('with automatic updates too, the mark while a version waits (any schedule, SYSTEM_DESIGN §18.7 phase 2)', shown?.updateAvailable === true, JSON.stringify(shown));

  // Update now
  fs.rmSync(requestFile, { force: true });
  r = await s.api('POST', '/api/settings/updates/install-now');
  const status = JSON.parse(fs.readFileSync(path.join(env.APP, 'data', 'update-status.json'), 'utf8'));
  check('Update now: status "requested", then the install-now request', r.status === 200 && status.state === 'requested' && request() === 'install-now\n' && r.data.busy === true, JSON.stringify(status));
  r = await s.api('POST', '/api/settings/updates/install-now');
  check('  … not again while it runs (409)', r.status === 409);

  const out = await s.api('PUT', '/api/settings/updates/schedule', { every: 'manual' }, { auth: false });
  check('the schedule needs a login (401)', out.status === 401);

  // Without the updater's systemd units nothing can be installed, so nothing is saved
  await s.stop();
  fs.rmSync(scheduleFile);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: path.join(env.T, 'no-units') });
  await s.login();
  r = await s.api('PUT', '/api/settings/updates/schedule', { every: 'manual' });
  check('without the updater set up: 409, nothing saved', r.status === 409 && !fs.existsSync(scheduleFile), JSON.stringify(r.data));
  await sleep(100);

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
