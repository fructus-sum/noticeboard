// The Software updates card in a real browser: check a branch, both confirmations (wrong
// password, cancelling at the last moment, Escape), a confirmed switch followed through a
// server restart to the result. Same throwaway setup as test-branch-api.js.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('../helpers/cdp.js');

const REPO = path.resolve(__dirname, '..', '..');
const SHOTS = require('os').tmpdir();
const MODULES = path.join(REPO, 'node_modules');
const bcrypt = require(path.join(MODULES, 'bcrypt'));
const PORT = 3910;
const BASE = `http://localhost:${PORT}`;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-branch-ui-'));
const APP = path.join(T, 'app');
const SYSTEMD = path.join(T, 'systemd');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (name, pass, detail = '') => { ok &&= !!pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function setup() {
  git(T, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(T, 'clone', '-q', REPO, 'work');
  const work = path.join(T, 'work');
  const changed = execFileSync('git', ['ls-files', '--modified', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of changed) { fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(work, f)); }
  fs.writeFileSync(path.join(work, 'system-requirements.json'), JSON.stringify({ software: [
    { name: 'Node.js', commands: ['node'], versionArgs: ['--version'], versions: '>=20.19.0', neededFor: 'the server', install: 'the installer' },
    { name: 'Git', commands: ['git'], versionArgs: ['--version'], versions: '>=2.38.0', neededFor: 'updates', install: 'sudo apt install git' },
  ] }));
  git(work, 'checkout', '-q', '-B', 'main');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main with branch switching');
  git(work, 'remote', 'set-url', 'origin', path.join(T, 'origin.git'));
  git(work, 'push', '-q', 'origin', 'main');
  const branch = (name, change) => {
    git(work, 'checkout', '-q', '-b', name, 'main'); change(work); git(work, 'add', '-A', '-f'); git(work, 'commit', '-qm', `Try out ${name}`);
    git(work, 'push', '-q', 'origin', name); git(work, 'checkout', '-q', 'main');
  };
  branch('feature/good', (w) => fs.writeFileSync(path.join(w, 'VERSION'), 'good\n'));
  branch('needs-more', (w) => fs.writeFileSync(path.join(w, 'system-requirements.json'), JSON.stringify({ software: [
    { name: 'Node.js', commands: ['node'], versionArgs: ['--version'], versions: '>=99.0.0', neededFor: 'a future server', install: 'a future installer' },
    { name: 'Git', commands: ['git'], versionArgs: ['--version'], versions: '>=2.38.0', neededFor: 'updates', install: 'sudo apt install git' },
    { name: 'Widget', commands: ['no-such-program-xyz'], versionArgs: ['--version'], versions: '*', neededFor: 'widgets', install: 'sudo apt install widget' },
  ] })));
  branch('no-list', (w) => fs.rmSync(path.join(w, 'system-requirements.json')));
  branch('old', (w) => { const f = path.join(w, 'installers/update.sh'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll('update-branch.env', 'branch-settings')); });
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
  const bin = path.join(T, 'bin');
  fs.mkdirSync(bin);
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
  script('systemctl', 'case "$1" in is-active) echo active ;; show) n=$(cat "$(dirname "$0")/pid" 2>/dev/null || echo 3999000); echo "$n"; echo $((n + 1)) > "$(dirname "$0")/pid" ;; esac');
  script('npm', 'exit 0');
  script('curl', 'exit 0');
  script('sleep', 'exit 0');
  script('flock', 'exit 0');
}
function runUpdater() {
  const posix = (p) => p.replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', `PATH="${posix(path.join(T, 'bin'))}:$PATH" bash "${posix(APP)}/installers/update.sh"`]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out.trim()));
  });
}
let server;
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: APP, env: { ...process.env, NODE_ENV: 'production', NODE_PATH: MODULES, NOTICEBOARD_SYSTEMD_DIR: SYSTEMD }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/auth/status')).ok) return; } catch { /* not yet */ } await sleep(250); }
  throw new Error('server did not start');
}
async function stopServer() { const s = server; server = null; s.kill(); await new Promise((r) => s.on('exit', r)); }
const setting = () => { try { return fs.readFileSync(path.join(APP, 'data/update-branch.env'), 'utf8').trim(); } catch { return null; } };
const requested = () => fs.existsSync(path.join(APP, 'tmp/update-request'));

(async () => {
  setup();
  await startServer();
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const card = `[...document.querySelectorAll('.card')].find((e) => e.querySelector('h2')?.textContent === 'Software updates')`;
  const cardText = () => c.evaluate(`(${card})?.innerText ?? ''`);
  const dialogText = () => c.evaluate(`document.querySelector('.dialog')?.innerText ?? ''`);
  const type = (selector, value) => c.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = (text) => c.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); })()`);

  // Log in, open Settings
  await c.send('Page.navigate', { url: BASE + '/admin/login' });
  await until(`!!document.querySelector('input[type=password]')`);
  await type('input[type=password]', 'Admin@12345');
  await c.evaluate(`document.querySelector('form').requestSubmit()`);
  await sleep(1000);
  await c.send('Page.navigate', { url: BASE + '/admin/settings' });
  await until(`(${card})?.innerText.includes('Running')`);
  const mainCommit = git(APP, 'rev-parse', 'HEAD').slice(0, 7);
  let text = await cardText();
  check('card: running branch and version, update schedule, branch form', text.includes(`main ${mainCommit}`) && text.includes('Checked every 15 minutes') && text.includes('Updates come from the main branch'), text.replace(/\n/g, ' | ').slice(0, 200));
  await until(`document.querySelectorAll('#update-branches option').length >= 3`);
  check('branch list offered from GitHub', (await c.evaluate(`[...document.querySelectorAll('#update-branches option')].map((o) => o.value).join()`)) === 'main,feature/good,needs-more,no-list,old');

  // Checking branches
  await type('.row input', 'nope'); await click('Check branch');
  await until(`(${card}).innerText.includes('no branch called')`);
  check("a branch that doesn't exist: explained, no switch button", (await cardText()).includes(`There's no branch called "nope" on GitHub.`) && !(await cardText()).includes('Switch to'));
  await type('.row input', 'old'); await click('Check branch');
  await until(`(${card}).innerText.includes('older than branch switching')`);
  check('an old branch: blocked with the reason', (await cardText()).includes('older than branch switching'));
  await type('.row input', 'main'); await click('Check branch');
  await until(`(${card}).innerText.includes('already uses')`);
  check('the current branch: "already uses", no switch button', (await cardText()).includes('This noticeboard already uses main.') && !(await cardText()).includes('Switch to'));
  await type('.row input', 'feature/good'); await click('Check branch');
  await until(`(${card}).innerText.includes('can be used')`);
  const goodCommit = git(path.join(T, 'origin.git'), 'rev-parse', 'feature/good').slice(0, 7);
  text = await cardText();
  check('a good branch: verified, current → proposed shown', text.includes('feature/good exists on GitHub and can be used') && text.includes(`main ${mainCommit} → feature/good ${goodCommit}`) && text.includes('Try out feature/good'), text.split('\n').filter((l) => l.includes('→')).join());
  check('checking changed nothing', setting() === null && !requested());
  await c.evaluate(`(${card}).scrollIntoView()`); await c.screenshot(path.join(SHOTS, 'updates-checked.png'));

  // First confirmation: Escape cancels
  await click('Switch to feature/good');
  await until(`!!document.querySelector('.dialog')`);
  text = await dialogText();
  check('first dialog: all four warnings and the password field', ['Experimental.', 'May not work here.', 'May be unstable.', 'Your data.', 'Future updates'].every((w) => text.includes(w)) && text.includes('Admin password'), text.slice(0, 80));
  check('the password field has focus', await c.evaluate(`document.activeElement?.id === 'switch-password'`));
  await c.screenshot(path.join(SHOTS, 'updates-dialog1.png'));
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  check('Escape cancels, nothing changed', !(await c.evaluate(`!!document.querySelector('.dialog')`)) && (await cardText()).includes('Cancelled. Nothing was changed.') && setting() === null);

  // Wrong password: cancelled
  await click('Switch to feature/good');
  await until(`!!document.querySelector('#switch-password')`);
  await type('#switch-password', 'wrong-password');
  await click('Continue');
  await until(`(${card}).innerText.includes('Incorrect password')`);
  check('wrong password: dialog closed, switch cancelled, nothing changed', !(await c.evaluate(`!!document.querySelector('.dialog')`)) && (await cardText()).includes('Incorrect password. The switch was cancelled and nothing was changed.') && setting() === null && !requested());

  // Right password, then cancel at the last moment
  await click('Switch to feature/good');
  await until(`!!document.querySelector('#switch-password')`);
  await type('#switch-password', 'Admin@12345');
  await click('Continue');
  await until(`document.querySelector('.dialog h2')?.textContent.includes('Last chance')`);
  text = await dialogText();
  check('final dialog: title, password already checked, last chance, what each button does', text.includes('Last chance to avoid doing something stupid!') && text.includes('Your password checked out') && text.includes('last chance to back out') && text.includes('Cancel leaves everything exactly as it is') && text.includes('Confirm starts the switch straight away'), text.replace(/\n/g, ' ').slice(0, 160));
  check('Cancel has focus (the safe default)', (await c.evaluate(`document.activeElement?.textContent.trim()`)) === 'Cancel, keep main');
  await c.screenshot(path.join(SHOTS, 'updates-dialog2.png'));
  await click('Cancel, keep main');
  await sleep(200);
  check('cancel at the last moment: nothing changed', (await cardText()).includes('Cancelled at the last moment. Nothing was changed.') && setting() === null && !requested());

  // A branch that needs software this noticeboard lacks: warned, and an extra confirmation
  await type('.row input', 'needs-more'); await click('Check branch');
  await until(`!!(${card}).querySelector('.software--missing')`);
  text = await cardText();
  check('missing software: named, with what is needed and how to install it', /missing software needs-more needs/.test(text) && text.includes("Node.js: needs 99.0.0 or newer") && /Widget: needs any version; this noticeboard has none/.test(text) && /To install: sudo apt install widget/.test(text), text.split(String.fromCharCode(10)).filter((l) => /needs|install/i.test(l)).join(' | ').slice(0, 200));
  await c.evaluate(`(${card}).scrollIntoView()`); await c.screenshot(path.join(SHOTS, 'updates-missing.png'));
  await click('Switch to needs-more');
  await until(`document.querySelector('.dialog h2')?.textContent === 'Missing software'`);
  check('extra confirmation first; Continue is off until ticked', await c.evaluate(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Continue').disabled`));
  await c.screenshot(path.join(SHOTS, 'updates-missing-dialog.png'));
  await click('Cancel');
  check('cancelling it changes nothing', !(await c.evaluate(`!!document.querySelector('.dialog')`)) && setting() === null && !requested());
  await click('Switch to needs-more');
  await until(`document.querySelector('.dialog h2')?.textContent === 'Missing software'`);
  await c.evaluate(`document.querySelector('.accept input').click()`);
  await click('Continue');
  check('ticked: on to the password', await until(`!!document.querySelector('#switch-password')`));
  await type('#switch-password', 'Admin@12345');
  await click('Continue');
  await until(`document.querySelector('.dialog h2')?.textContent.includes('Last chance')`);
  check('the final warning repeats what is missing', (await dialogText()).includes("still missing Node.js, Widget"));
  await click('Cancel, keep main');
  check('and cancelling there changes nothing', setting() === null && !requested());
  await type('.row input', 'no-list'); await click('Check branch');
  await until(`!!(${card}).querySelector('.software--unknown')`);
  check('a branch without a list: said to be uncheckable, no extra confirmation', /doesn.t list the software it needs/.test(await cardText()));
  await type('.row input', 'feature/good'); await click('Check branch');
  await until(`!!(${card}).querySelector('.software--ok')`);
  check('a branch whose software is all here: says so', (await cardText()).includes("has the software feature/good needs"));

  // Confirm
  await click('Switch to feature/good');
  await until(`!!document.querySelector('#switch-password')`);
  await type('#switch-password', 'Admin@12345');
  await click('Continue');
  await until(`document.querySelector('.dialog h2')?.textContent.includes('Last chance')`);
  await c.evaluate('window.__before = true');
  await click('Confirm, switch to feature/good');
  await until(`(${card}).innerText.includes('Waiting for the update to start')`);
  text = await cardText();
  check('confirmed: setting saved, update requested, progress shown', setting() === 'NOTICEBOARD_BRANCH=feature/good' && requested() && text.includes('Waiting to start') && text.includes('Switch from main to feature/good requested. It starts within a few seconds.'), text.split('\n').find((l) => l.includes('requested')));
  await c.evaluate(`(${card}).scrollIntoView()`); await c.screenshot(path.join(SHOTS, 'updates-progress.png'));

  // The server goes away while the update runs (as it restarts)
  await stopServer();
  await until(`(${card}).innerText.includes('restarting')`, 8000);
  check('while the server is down: "restarting", reconnects by itself', (await cardText()).includes('The noticeboard is restarting'));
  const out = await runUpdater();
  await startServer();
  const reloaded = await until('window.__before === undefined', 15000);
  await until(`(${card})?.innerText.includes('Running')`);
  text = await cardText();
  check('after the switch: page reloads onto the new version, result shown', reloaded && text.includes(`feature/good ${goodCommit}`) && text.includes('Done') && text.includes('Switched from main to feature/good'), `${out.split('\n').pop()} | ${text.split('\n').find((l) => l.includes('Switched')) ?? ''}`);
  check('updates now come from feature/good', text.includes('Updates come from the feature/good branch'));
  await c.evaluate(`(${card}).scrollIntoView()`); await c.screenshot(path.join(SHOTS, 'updates-done.png'));

  c.close();
  await stopServer();
  fs.rmSync(T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); if (server) server.kill(); process.exit(1); });
