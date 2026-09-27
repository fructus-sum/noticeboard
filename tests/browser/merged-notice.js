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
  check('the notice needs the admin login', (await fetch(BASE + '/api/settings/updates/notice')).status === 401);
  const noticeFile = path.join(APP, 'data/update-notice.json');
  fs.writeFileSync(noticeFile, JSON.stringify({ type: 'branch-merged', branch: 'feature/a', commit: 'x', message: 'The branch feature/a has been merged into main, so its features are now part of main. This noticeboard has gone back to following main and is running 1234567. Future updates come from main.', time: '2026-09-26T16:00:00Z' }));
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); } return false; };
  await c.send('Page.navigate', { url: BASE + '/admin/login' });
  await until(`!!document.querySelector('input[type=password]')`);
  await c.evaluate(`(() => { const i = document.querySelector('input[type=password]'); i.value = 'Admin@12345'; i.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
  const shown = await until(`!!document.querySelector('.notice')`);
  const text = shown ? await c.evaluate(`document.querySelector('.notice').innerText`) : '';
  check('notice shown at the top of the home page', shown && text.includes('This noticeboard is back on main') && text.includes('feature/a has been merged into main') && (await c.evaluate(`document.querySelector('.notice').parentElement.firstElementChild === document.querySelector('.notice')`)), text.split('\n').join(' | ').slice(0, 120));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-notice.png'));
  await c.send('Page.reload');
  check('it stays after a reload until closed', await until(`!!document.querySelector('.notice')`));
  await c.evaluate(`document.querySelector('.notice__close').click()`);
  const gone = await until(`!document.querySelector('.notice')`);
  check('closing it: gone, and removed on the server', gone && !fs.existsSync(noticeFile));
  await c.send('Page.reload');
  await until(`!!document.querySelector('h1')`); await sleep(1000);
  check('after a reload it stays closed; the page works as before', !(await c.evaluate(`!!document.querySelector('.notice')`)) && (await c.evaluate(`document.querySelector('h1').textContent`)) === 'Slideshows');
  c.close();
  await stopServer();
  fs.rmSync(T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); if (server) server.kill(); process.exit(1); });
