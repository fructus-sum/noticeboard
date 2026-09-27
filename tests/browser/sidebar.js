// The admin sidebar: "By Fructus Sum" under the title, and "Last updated" (the installed
// version's commit date) above Log out, both opening GitHub in a new tab. Then the same
// without git: the Last updated line is simply absent.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const { copyChanges } = require('../helpers/app.js');
const os = require('os');
const path = require('path');
const { connect } = require('../helpers/cdp.js');

const REPO = path.resolve(__dirname, '..', '..');
const MODULES = path.join(REPO, 'node_modules');
const bcrypt = require(path.join(MODULES, 'bcrypt'));
const PORT = 3910;
const BASE = `http://localhost:${PORT}`;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-nav-'));
const APP = path.join(T, 'app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (name, pass, detail = '') => { ok &&= !!pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

git(T, 'clone', '-q', REPO, 'app');
copyChanges(APP);
git(APP, 'add', '-A'); process.env.GIT_COMMITTER_DATE = '2026-03-04T05:06:07Z'; git(APP, 'checkout', '-q', '-B', 'main'); git(APP, 'commit', '-qm', 'sidebar', '--allow-empty'); delete process.env.GIT_COMMITTER_DATE;
for (const d of ['client/admin/dist', 'client/display/dist']) fs.cpSync(path.join(REPO, d), path.join(APP, d), { recursive: true });
fs.mkdirSync(path.join(APP, 'data/slideshows'), { recursive: true });
fs.writeFileSync(path.join(APP, 'data/config.json'), JSON.stringify({
  port: PORT, passwordHash: bcrypt.hashSync('Admin@12345', 4), jwtSecret: 'x'.repeat(64),
  macFiltering: { enabled: false, approved: [] }, display: { defaultSlideDurationSeconds: 10 }, slideshows: [],
  sampleSlideshow: { folder: null, signature: 'skip' },
}));

let server;
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: APP, env: { ...process.env, NODE_PATH: MODULES }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/auth/status')).ok) return; } catch { /* not yet */ } await sleep(250); }
  throw new Error('server did not start');
}
async function stopServer() { const s = server; s.kill(); await new Promise((r) => s.on('exit', r)); }

(async () => {
  await startServer();
  check('the version needs the admin login', (await fetch(BASE + '/api/settings/version')).status === 401);
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); } return false; };
  await c.send('Page.navigate', { url: BASE + '/admin/login' });
  await until(`!!document.querySelector('input[type=password]')`);
  await c.evaluate(`(() => { const i = document.querySelector('input[type=password]'); i.value = 'Admin@12345'; i.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
  await until(`!!document.querySelector('.nav__updated')`);

  const nav = await c.evaluate(`(() => {
    const by = document.querySelector('.nav__by a'), up = document.querySelector('.nav__updated');
    const kids = [...document.querySelector('.nav').children];
    return { brand: document.querySelector('.nav__brand').innerText, byHref: by.href, byTarget: by.target, byRel: by.rel,
      upText: up.innerText, upHref: up.href, upTarget: up.target, upTitle: up.title,
      aboveLogout: kids.indexOf(up) === kids.indexOf(document.querySelector('.nav__logout')) - 1 };
  })()`);
  const expected = await c.evaluate(`new Date('2026-03-04T05:06:07Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`);
  const commit = git(APP, 'rev-parse', 'HEAD').slice(0, 7);
  check('"By Fructus Sum" under the title', /^NOTICEBOARD\s*\n\s*By Fructus Sum$/.test(nav.brand.trim()), JSON.stringify(nav.brand));
  check('Fructus Sum links to GitHub in a new tab', nav.byHref === 'https://github.com/fructus-sum/noticeboard' && nav.byTarget === '_blank' && nav.byRel === 'noopener');
  check('Last updated shows the installed version\'s date, not now', nav.upText.replace(/\s+/g, ' ').trim() === `Last updated ${expected}`, nav.upText.replace(/\n/g, ' | '));
  check('Last updated opens GitHub in a new tab', nav.upHref === 'https://github.com/fructus-sum/noticeboard' && nav.upTarget === '_blank');
  check('its tooltip names the version', nav.upTitle.includes(`Version ${commit} from main`), nav.upTitle);
  check('it sits right above Log out', nav.aboveLogout);
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-nav.png'));
  await c.send('Page.reload');
  await until(`!!document.querySelector('.nav__updated')`);
  check('same date after a reload', (await c.evaluate(`document.querySelector('.nav__updated').innerText`)).includes(expected));

  // Not a git clone: no Last updated line, everything else as before
  await stopServer();
  fs.renameSync(path.join(APP, '.git'), path.join(APP, 'no-git'));
  await startServer();
  await c.send('Page.reload');
  await until(`!!document.querySelector('.nav__logout')`);
  await sleep(1000);
  check('without git: no Last updated line, attribution still there', !(await c.evaluate(`!!document.querySelector('.nav__updated')`)) && (await c.evaluate(`!!document.querySelector('.nav__by a')`)));

  c.close();
  await stopServer();
  fs.rmSync(T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); if (server) server.kill(); process.exit(1); });
