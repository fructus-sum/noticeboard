// Restore Defaults on the server side (SYSTEM_DESIGN §14 D42): the password gives a token for that
// action; the request leaves the marker, the status and a "restore-defaults" request for update.sh;
// at the next start-up (update.sh restarts the server) everything in data/ but the branch setting
// and the installer's record is gone, the logs are emptied, the waiting files deleted, and the
// server starts as a new install: default settings and password, a new session secret (the old
// login no longer works), the sample slideshow as new.
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));

(async () => {
  const env = makeApp({ port: 3948, keepSample: true });
  const units = path.join(env.T, 'systemd');
  for (const [dir, unit] of [['timers.target.wants', 'noticeboard-update.timer'], ['paths.target.wants', 'noticeboard-update.path']]) {
    fs.mkdirSync(path.join(units, dir), { recursive: true });
    fs.writeFileSync(path.join(units, dir, unit), '');
  }
  const at = (...p) => path.join(env.APP, ...p);
  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();

  // Content, settings and history a restore must remove
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Front desk' })).data.folder;
  const form = new FormData();
  form.append('files', new Blob([await sharp({ create: { width: 64, height: 36, channels: 3, background: '#39c' } }).png().toBuffer()], { type: 'image/png' }), 'a.png');
  await s.api('POST', `/api/slideshows/${folder}/slides`, form);
  await s.api('PUT', '/api/settings', { display: { backgroundColor: '#123456', defaultSlideDurationSeconds: 20 } });
  const logo = new FormData();
  logo.append('logo', new Blob([await sharp({ create: { width: 64, height: 64, channels: 3, background: '#f0f' } }).png().toBuffer()], { type: 'image/png' }), 'logo.png');
  await s.api('POST', '/api/settings/logo', logo);
  const sample = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });
  await s.api('PUT', '/api/settings/updates/schedule', { every: 'manual' });
  fs.writeFileSync(at('data', 'update-check.json'), '{"result":"up-to-date"}');
  fs.writeFileSync(at('data', 'update-notice.json'), '{"type":"branch-merged"}');
  fs.mkdirSync(at('data', 'backups', '20260901-from-x'), { recursive: true });
  fs.writeFileSync(at('data', 'backups', '20260901-from-x', 'config.json'), '{}');
  fs.writeFileSync(at('data', 'installer.json'), '{"version":2,"branch":"main","commit":"x","time":"2026-09-01T10:00:00Z"}');
  fs.writeFileSync(at('data', 'update-branch.env'), 'NOTICEBOARD_BRANCH=main\n');
  fs.mkdirSync(at('tmp', 'noticeboard-uploads'), { recursive: true });
  fs.writeFileSync(at('tmp', 'noticeboard-uploads', 'upload-1-a.png'), 'x');
  fs.writeFileSync(at('tmp', 'update-failed-commit'), 'abc');
  fs.writeFileSync(at('tmp', 'update.lock'), '');
  fs.writeFileSync(at('logs', 'app1.log'), 'old log');
  const oldCookie = s.cookie();

  // The request
  const noToken = await s.api('POST', '/api/settings/maintenance/restore-defaults', {});
  check('no token: 403, nothing asked for', noToken.status === 403 && !fs.existsSync(at('data', 'restore-defaults')));
  const deleteToken = (await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'delete-all' })).data.token;
  const crossed = await s.api('POST', '/api/settings/maintenance/restore-defaults', { token: deleteToken });
  check('a Delete All token doesn\'t restore', crossed.status === 403);
  const token = (await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'restore-defaults' })).data.token;
  const r = await s.api('POST', '/api/settings/maintenance/restore-defaults', { token });
  check('Restore Defaults is asked for', r.status === 200 && r.data.busy === true, JSON.stringify(r.data?.error ?? r.data?.status?.message));
  check('  … the marker for update.sh and the server', fs.existsSync(at('data', 'restore-defaults')));
  check('  … the "restore-defaults" request', fs.readFileSync(at('tmp', 'update-request'), 'utf8') === 'restore-defaults\n');
  check('  … and the status "requested"', JSON.parse(fs.readFileSync(at('data', 'update-status.json'), 'utf8')).state === 'requested');
  check('nothing is deleted before the restart', fs.existsSync(at('data', 'slideshows', folder)) && fs.existsSync(at('data', 'branding', 'logo.png')));

  // update.sh reinstalls and restarts the server, which resets its data at start-up
  fs.rmSync(at('tmp', 'update-request'));
  await s.stop();
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  const dataLeft = fs.readdirSync(at('data')).sort().join(' ');
  check('data/ holds only the kept files and a new install\'s', dataLeft === 'config.json installer.json slideshows update-branch.env', dataLeft);
  check('  … the kept files unchanged', fs.readFileSync(at('data', 'update-branch.env'), 'utf8') === 'NOTICEBOARD_BRANCH=main\n'
    && JSON.parse(fs.readFileSync(at('data', 'installer.json'), 'utf8')).version === 2);
  check('tmp/ keeps only the updater\'s lock', fs.readdirSync(at('tmp')).join(' ') === 'update.lock', fs.readdirSync(at('tmp')).join(' '));
  check('the old logs are gone, the current one emptied and carrying on', !fs.existsSync(at('logs', 'app1.log'))
    && fs.readFileSync(at('logs', 'app.log'), 'utf8').includes('Restore Defaults'));
  s.setCookie(oldCookie);
  const old = await s.api('GET', '/api/settings');
  check('the old login no longer works (a new session secret)', old.status === 401);
  check('the default password works', (await s.login()) === 200);
  const settings = (await s.api('GET', '/api/settings')).data;
  check('the settings are the defaults', settings.port === 3000 && settings.display.defaultSlideDurationSeconds === 10 && !settings.display.backgroundColor
    && settings.macFiltering.enabled === false, JSON.stringify(settings.display));
  check('the default password warning is back', (await s.api('GET', '/api/settings/security')).data.defaultPassword === true);
  const shows = (await s.api('GET', '/api/slideshows')).data;
  check('only the sample slideshow, as new (not published, not hidden)', shows.length === 1 && shows[0].sample && !shows[0].enabled && !shows[0].hidden, JSON.stringify(shows));
  check('the logo is the default one', (await s.api('GET', '/api/settings/logo')).data.custom === false);
  const info = (await s.api('GET', '/api/settings/updates')).data;
  check('the update schedule and history are gone', info.schedule.every === '15min' && info.status === null && info.lastCheck === null);
  await s.stop();
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();
  check('the next restart doesn\'t reset again', (await s.api('GET', '/api/settings/updates')).data.schedule.every === '15min'
    && fs.readFileSync(at('logs', 'app.log'), 'utf8').split('Restore Defaults: the data').length === 2);

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
