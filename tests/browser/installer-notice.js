// "Run the installer again on this Pi": the home page box, from the installer's record (or the
// kiosk script an older installer left), and the warning when checking a branch that needs it.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const { copyChanges } = require('../helpers/app.js');
const os = require('os');
const path = require('path');
const { connect } = require('../helpers/cdp.js');

const REPO = path.resolve(__dirname, '..', '..');
const MODULES = path.join(REPO, 'node_modules');
const bcrypt = require(path.join(MODULES, 'bcrypt'));
const PORT = 3911;
const BASE = `http://localhost:${PORT}`;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-installer-'));
const APP = path.join(T, 'app');
const SYSTEMD = path.join(T, 'systemd');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (name, pass, detail = '') => { ok &&= !!pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const software = JSON.parse(fs.readFileSync(path.join(REPO, 'system-requirements.json'), 'utf8')).software
  .filter((s) => ['Node.js', 'Git'].includes(s.name)).map((s) => ({ ...s, versions: '*' }));
const requirements = (version, changes) => JSON.stringify({ installer: { version, changes }, software });

function setup() {
  git(T, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(T, 'clone', '-q', REPO, 'work');
  const work = path.join(T, 'work');
  copyChanges(work);
  fs.writeFileSync(path.join(work, 'system-requirements.json'), requirements(1, [{ version: 1, change: 'The kiosk exit button', displays: true }]));
  git(work, 'checkout', '-q', '-B', 'main');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main');
  git(work, 'remote', 'set-url', 'origin', path.join(T, 'origin.git'));
  git(work, 'push', '-q', 'origin', 'main');
  const branch = (name, text) => {
    git(work, 'checkout', '-q', '-b', name, 'main'); fs.writeFileSync(path.join(work, 'system-requirements.json'), text);
    git(work, 'add', '-A'); git(work, 'commit', '--allow-empty', '-qm', `Try out ${name}`); git(work, 'push', '-q', 'origin', name); git(work, 'checkout', '-q', 'main');
  };
  branch('needs-installer', requirements(3, [
    { version: 1, change: 'The kiosk exit button', displays: true },
    { version: 2, change: 'A new system service' },
    { version: 3, change: 'A desktop shortcut' },
  ]));
  branch('same-installer', requirements(1, [{ version: 1, change: 'The kiosk exit button', displays: true }]));
  git(T, 'clone', '-q', path.join(T, 'origin.git'), 'app');
  for (const d of ['client/admin/dist', 'client/display/dist']) fs.cpSync(path.join(REPO, d), path.join(APP, d), { recursive: true });
  fs.mkdirSync(path.join(APP, 'data/slideshows'), { recursive: true });
  fs.writeFileSync(path.join(APP, 'data/config.json'), JSON.stringify({
    port: PORT, passwordHash: bcrypt.hashSync('Admin@12345', 4), jwtSecret: 'x'.repeat(64),
    macFiltering: { enabled: false, approved: [] }, display: { defaultSlideDurationSeconds: 10 }, slideshows: [],
    sampleSlideshow: { folder: null, signature: 'skip' },
  }, null, 2));
  fs.mkdirSync(path.join(SYSTEMD, 'timers.target.wants'), { recursive: true });
  fs.mkdirSync(path.join(SYSTEMD, 'paths.target.wants'), { recursive: true });
  fs.writeFileSync(path.join(SYSTEMD, 'timers.target.wants/noticeboard-update.timer'), '');
  fs.writeFileSync(path.join(SYSTEMD, 'paths.target.wants/noticeboard-update.path'), '');
}

const record = (v) => (v === null ? fs.rmSync(path.join(APP, 'data/installer.json'), { force: true })
  : fs.writeFileSync(path.join(APP, 'data/installer.json'), JSON.stringify({ version: v, branch: 'main', commit: 'x', time: new Date().toISOString() })));
const kiosk = (text) => (text === null ? fs.rmSync(path.join(APP, 'start-kiosk.sh'), { force: true }) : fs.writeFileSync(path.join(APP, 'start-kiosk.sh'), text));
const follow = (b) => (b ? fs.writeFileSync(path.join(APP, 'data/update-branch.env'), `NOTICEBOARD_BRANCH=${b}\n`) : fs.rmSync(path.join(APP, 'data/update-branch.env'), { force: true }));

(async () => {
  setup();
  const server = spawn(process.execPath, ['server/index.js'], { cwd: APP, env: { ...process.env, NODE_PATH: MODULES, NOTICEBOARD_SYSTEMD_DIR: SYSTEMD }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/auth/status')).ok) break; } catch { /* not yet */ } await sleep(250); }
  check('logged out: the installer status needs a login', (await fetch(BASE + '/api/settings/updates/installer')).status === 401);

  const c = await connect();
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const click = (text) => c.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); })()`);
  const type = (selector, value) => c.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  await c.send('Page.navigate', { url: BASE + '/admin/login' });
  await until(`!!document.querySelector('input[type=password]')`);
  await type('input[type=password]', 'Admin@12345');
  await c.evaluate(`document.querySelector('form').requestSubmit()`);
  await until(`location.pathname.startsWith('/admin/slideshows')`);

  const home = async () => {
    await c.send('Page.navigate', { url: BASE + '/admin/slideshows' });
    await until(`!!document.querySelector('.page-header, h1')`);
    await sleep(900);
    return c.evaluate(`document.querySelector('.installer')?.innerText ?? ''`);
  };

  record(null); kiosk(null); follow(null);
  check('not set up by the installer (no record, no kiosk script): no box', (await home()) === '');
  kiosk('#!/bin/bash\n# an old kiosk script\nchromium --kiosk http://localhost:3000\n');
  let text = await home();
  check('kiosk script from before the exit button, no record: the box, with what it brings', /Run the installer again on this Pi/.test(text) && text.includes('The kiosk exit button'), text.slice(0, 80).replace(/\n/g, ' '));
  check('the box gives main\'s installer command', text.includes('curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash'));
  check('the kiosk change also needs the remote displays: says so', /each remote display Pi/.test(text));
  check('nothing to close on it', !(await c.evaluate(`!!document.querySelector('.installer button[aria-label*="Close"], .installer .notice__close')`)));
  check('its help link goes to the guide section', (await c.evaluate(`document.querySelector('.installer a').getAttribute('href')`)) === '/admin/help#installer-needed');
  const guide = await (await fetch(BASE + '/admin/help')).text();
  check('the guide has that section', guide.includes('id="installer-needed"'));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-installer-notice.png'));

  kiosk('#!/bin/bash\nexit_requested() { curl -fsS "$URL/api/device/kiosk-exit/claim"; }\n');
  check('kiosk script with the exit button, no record: counted as version 1, no box', (await home()) === '');
  record(0);
  check('the record beats the kiosk script: version 0 recorded, the box', /Run the installer again/.test(await home()));
  record(1); kiosk(null);
  check('recorded version 1 (current): no box', (await home()) === '');

  // Checking a branch
  await c.send('Page.navigate', { url: BASE + '/admin/settings' });
  const card = `[...document.querySelectorAll('.card')].find((e) => e.querySelector('h2')?.textContent === 'Software updates')`;
  await until(`(${card})?.innerText.includes('Running')`);
  await type('.row input', 'needs-installer'); await click('Check branch');
  await until(`(${card}).innerText.includes('exists on GitHub')`, 20000);
  text = await c.evaluate(`(${card}).innerText`);
  check('checking a branch that needs a newer installer run: warns before switching', /After switching, run the installer again on this Pi/.test(text));
  check('lists only what this Pi missed (versions 2 and 3)', text.includes('A new system service') && text.includes('A desktop shortcut') && !/After switching[\s\S]*The kiosk exit button/.test(text));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-installer-check.png'));
  await click('Switch to needs-installer');
  await until(`!!document.querySelector('#switch-password')`);
  await type('#switch-password', 'Admin@12345');
  await c.evaluate(`document.querySelector('.dialog form, form.dialog').requestSubmit()`);
  await until(`document.querySelector('#final-title') !== null`, 5000);
  check('the final warning reminds you too', /Afterwards, run the installer again on this Pi/.test(await c.evaluate(`document.querySelector('.dialog').innerText`)));
  await click('Cancel, keep');
  await sleep(300);
  check('cancel: nothing changed', !fs.existsSync(path.join(APP, 'data/update-branch.env')) && !fs.existsSync(path.join(APP, 'tmp/update-request')));

  await type('.row input', 'same-installer'); await click('Check branch');
  await until(`(${card}).innerText.includes('same-installer') && (${card}).innerText.includes('exists on GitHub')`, 20000);
  check('a branch needing no newer installer run: no warning', !/run the installer again/.test(await c.evaluate(`(${card}).innerText`)));
  const api = await c.evaluate(`fetch('/api/settings/updates/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: 'needs-installer' }) }).then((r) => r.json())`);
  check('the check answers with the installer needs', api.installer?.needed === true && api.installer.required === 3 && api.installer.installed === 1 && api.installer.displays === false && api.requirements?.listed === true, JSON.stringify(api.installer));

  // After the switch: the Pi runs the branch's version, following it
  git(APP, 'fetch', '-q', 'origin', 'needs-installer'); git(APP, 'checkout', '-q', '-B', 'needs-installer', 'origin/needs-installer');
  follow('needs-installer');
  text = await home();
  check('after switching: the box on the home page, with that branch\'s installer command', /Run the installer again/.test(text) && text.includes('/noticeboard/needs-installer/installers/install.sh') && text.includes('A desktop shortcut'), text.slice(0, 60));
  check('only the server Pi this time (no display change missed)', !/each remote display Pi/.test(text));
  record(3);
  check('once the installer has run (record 3): the box is gone', (await home()) === '');

  // Phone: the box fits
  record(1);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await home();
  const fits = await c.evaluate(`(() => { const r = document.querySelector('.installer').getBoundingClientRect(); const code = document.querySelector('.installer code').getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && code.right <= r.right + 1; })()`);
  check('phone: the box and its command fit the screen', fits);
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-installer-notice-phone.png'));

  c.close();
  server.kill();
  await new Promise((r) => server.on('exit', r));
  fs.rmSync(T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
