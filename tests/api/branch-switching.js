// Branch switching end to end, minus systemd: the real server runs from a git clone whose origin
// (a local bare repo) has several branches, with fake systemd unit files. The real update.sh
// (with systemctl, npm, curl, sleep and flock stand-ins) acts on what the server writes.
//   node tests/run.js api branch-switching
const { spawn, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const { copyChanges } = require('../helpers/app.js');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MODULES = path.join(REPO, 'node_modules');
const bcrypt = require(path.join(MODULES, 'bcrypt'));
const PORT = 3910;
const BASE = `http://localhost:${PORT}`;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-branch-'));
const APP = path.join(T, 'app');
const SYSTEMD = path.join(T, 'systemd');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (name, pass, detail = '') => { ok &&= !!pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// ── origin: this working tree as main, plus test branches ──
function setup() {
  git(T, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(T, 'clone', '-q', REPO, 'work');
  const work = path.join(T, 'work');
  // The uncommitted changes (this feature) on top of the committed code
  copyChanges(work);
  fs.writeFileSync(path.join(work, 'system-requirements.json'), JSON.stringify({ software: [
    { name: 'Node.js', commands: ['node'], versionArgs: ['--version'], versions: '>=20.19.0', neededFor: 'the server', install: 'the installer' },
    { name: 'Git', commands: ['git'], versionArgs: ['--version'], versions: '>=2.38.0', neededFor: 'updates', install: 'sudo apt install git' },
  ] }));
  git(work, 'checkout', '-q', '-B', 'main');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main with branch switching');
  git(work, 'remote', 'set-url', 'origin', path.join(T, 'origin.git'));
  git(work, 'push', '-q', 'origin', 'main');
  const branch = (name, change) => {
    git(work, 'checkout', '-q', '-b', name, 'main'); change(work); git(work, 'add', '-A', '-f'); git(work, 'commit', '-qm', name);
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
  branch('tracks-data', (w) => { fs.mkdirSync(path.join(w, 'data'), { recursive: true }); fs.writeFileSync(path.join(w, 'data/config.json'), '{}'); });
  branch('broken', (w) => fs.writeFileSync(path.join(w, 'BUILD_FAILS'), ''));

  git(T, 'clone', '-q', path.join(T, 'origin.git'), 'app');
  for (const d of ['client/admin/dist', 'client/display/dist']) fs.cpSync(path.join(REPO, d), path.join(APP, d), { recursive: true });
  fs.mkdirSync(path.join(APP, 'data/slideshows'), { recursive: true });
  fs.writeFileSync(path.join(APP, 'data/config.json'), JSON.stringify({
    port: PORT, passwordHash: bcrypt.hashSync('Admin@12345', 4), jwtSecret: 'x'.repeat(64),
    macFiltering: { enabled: false, approved: [] }, display: { defaultSlideDurationSeconds: 10 }, slideshows: [],
    sampleSlideshow: { folder: null, signature: 'skip' },
  }, null, 2));
  installUnits(true, true);

  // Stand-ins for update.sh
  const bin = path.join(T, 'bin');
  fs.mkdirSync(bin);
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
  // A new (made-up, out of range) server PID after every look, as if systemd restarted it
  script('systemctl', `case "$1" in is-active) echo active ;; show) n=$(cat "$(dirname "$0")/pid" 2>/dev/null || echo 3999000); echo "$n"; echo $((n + 1)) > "$(dirname "$0")/pid" ;; esac`);
  script('npm', '[ "$1" = run ] && [ -f BUILD_FAILS ] && exit 1\nexit 0');
  script('curl', 'exit 0');
  script('sleep', 'exit 0');
  script('flock', 'exit 0');
}
function installUnits(timer, pathUnit) {
  fs.rmSync(SYSTEMD, { recursive: true, force: true });
  if (timer) { fs.mkdirSync(path.join(SYSTEMD, 'timers.target.wants'), { recursive: true }); fs.writeFileSync(path.join(SYSTEMD, 'timers.target.wants/noticeboard-update.timer'), ''); }
  if (pathUnit) { fs.mkdirSync(path.join(SYSTEMD, 'paths.target.wants'), { recursive: true }); fs.writeFileSync(path.join(SYSTEMD, 'paths.target.wants/noticeboard-update.path'), ''); }
  fs.mkdirSync(SYSTEMD, { recursive: true });
}
// What systemd's path unit would do: run update.sh once the request file exists
function runUpdater() {
  const posix = (p) => p.replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
  const r = spawnSync('bash', ['-c', `PATH="${posix(path.join(T, 'bin'))}:$PATH" bash "${posix(APP)}/installers/update.sh"`], { encoding: 'utf8' });
  return (r.stdout + r.stderr).trim();
}

// ── server ──
let server;
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: APP, env: { ...process.env, NODE_PATH: MODULES, NOTICEBOARD_SYSTEMD_DIR: SYSTEMD }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/auth/status')).ok) return; } catch { /* not yet */ } await sleep(250); }
  throw new Error('server did not start');
}
let cookie = '';
async function call(method, p, body, withCookie = true) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { ...(withCookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null), res };
}
const setting = () => { try { return fs.readFileSync(path.join(APP, 'data/update-branch.env'), 'utf8').trim(); } catch { return null; } };
const requested = () => fs.existsSync(path.join(APP, 'tmp/update-request'));
const head = () => git(APP, 'symbolic-ref', '--short', 'HEAD');

(async () => {
  setup();
  await startServer();
  check('updates info needs the admin login', (await call('GET', '/settings/updates', undefined, false)).status === 401);
  cookie = (await call('POST', '/auth/login', { password: 'Admin@12345' })).res.headers.get('set-cookie').split(';')[0];

  let info = (await call('GET', '/settings/updates')).data;
  check('info: current branch, commit, setting and systemd units', info.available && info.branch === 'main' && /^[0-9a-f]{40}$/.test(info.commit) && info.configuredBranch === 'main' && info.autoUpdates && info.instant && !info.busy && !info.pending, JSON.stringify({ ...info, status: undefined, lastCheck: undefined }));

  const branches = (await call('GET', '/settings/updates/branches')).data.branches;
  check('branches from GitHub, main first', branches[0] === 'main' && ['feature/good', 'old', 'tracks-data', 'broken'].every((b) => branches.includes(b)), branches.join(', '));

  let r = await call('POST', '/settings/updates/check', { branch: 'feature/good' });
  check('check: a good branch is verified', r.status === 200 && r.data.commit === git(path.join(T, 'origin.git'), 'rev-parse', 'feature/good') && r.data.subject === 'feature/good' && r.data.current === 'main', JSON.stringify(r.data));
  r = await call('POST', '/settings/updates/check', { branch: 'nope' });
  check("check: a branch that doesn't exist", r.status === 404 && /no branch called "nope"/.test(r.data.error), r.data.error);
  r = await call('POST', '/settings/updates/check', { branch: 'bad..name' });
  check('check: an invalid name', r.status === 400, r.data.error);
  r = await call('POST', '/settings/updates/check', { branch: 'old' });
  check('check: a branch without branch switching is blocked', r.status === 422 && /older than branch switching/.test(r.data.error), r.data.error);
  r = await call('POST', '/settings/updates/check', { branch: 'tracks-data' });
  check('check: a branch with files in data/ is blocked', r.status === 422 && /data\//.test(r.data.error), r.data.error);
  check('checking changed nothing', setting() === null && !requested());

  r = await call('POST', '/settings/updates/verify-password', { password: 'wrong', branch: 'feature/good' });
  check('wrong password: 403 (not 401, which logs the admin out), nothing changed', r.status === 403 && /Incorrect password/.test(r.data.error) && setting() === null && !requested(), r.data.error);
  r = await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' });
  const token = r.data.token;
  check('right password: a one-time token', r.status === 200 && /^[0-9a-f]{48}$/.test(token));
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: 'f'.repeat(48) });
  check('switch with a made-up token: refused, nothing changed', r.status === 403 && setting() === null && !requested(), r.data.error);
  r = await call('POST', '/settings/updates/switch', { branch: 'broken', token });
  check("switch with another branch's token: refused (and the token is used up)", r.status === 403 && setting() === null);
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token });
  check('a used token is refused', r.status === 403 && setting() === null && !requested());

  const token2 = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: token2 });
  check('switch: setting saved and update requested', r.status === 200 && setting() === 'NOTICEBOARD_BRANCH=feature/good' && requested() && r.data.busy && r.data.pending && r.data.status.state === 'requested' && /within a few seconds/.test(r.data.status.message), r.data.status && r.data.status.message);
  const token3 = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'old' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' })).data.token });
  check('another switch while one is pending: refused', r.status === 409 && /already in progress/.test(r.data.error), r.data.error);

  // systemd's path unit starts update.sh
  let out = await runUpdater();
  info = (await call('GET', '/settings/updates')).data;
  check('update.sh installs it: the admin panel sees feature/good', head() === 'feature/good' && info.branch === 'feature/good' && info.configuredBranch === 'feature/good' && info.status.state === 'updated' && !info.busy && !info.pending && info.lastCheck.result === 'up-to-date', `${info.status.message} | ${out.split('\n').pop()}`);
  out = await runUpdater();
  check('the next check keeps feature/good', head() === 'feature/good' && /Up to date/.test(out), out);

  // A switch that fails to build: rolled back, setting restored
  let t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'broken' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'broken', token: t });
  out = await runUpdater();
  info = (await call('GET', '/settings/updates')).data;
  check('a switch that fails: rolled back to feature/good, setting restored', r.status === 200 && head() === 'feature/good' && info.configuredBranch === 'feature/good' && info.status.state === 'rolled-back' && !info.busy, info.status.message);

  // Back to main
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'main' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'main', token: t });
  await runUpdater();
  info = (await call('GET', '/settings/updates')).data;
  check('switch back to main', r.status === 200 && head() === 'main' && info.configuredBranch === 'main' && info.status.state === 'updated', info.status.message);

  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'main' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'main', token: t });
  check('switching to the branch already in use: refused', r.status === 409 && /already uses main/.test(r.data.error), r.data.error);

  // Only the timer: the switch waits for the next check
  installUnits(true, false);
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: t });
  check('without the path unit: switch starts at the next check', r.status === 200 && !r.data.instant && /next update check, within 15 minutes/.test(r.data.status.message), r.data.status && r.data.status.message);
  await runUpdater();
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'main' })).data.token;
  await call('POST', '/settings/updates/switch', { branch: 'main', token: t });
  await runUpdater();

  // No automatic updates at all: a switch would never happen, so it's refused
  installUnits(false, false);
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: t });
  check('no automatic updates: refused, nothing changed', r.status === 409 && /aren't set up/.test(r.data.error) && setting() === 'NOTICEBOARD_BRANCH=main' && !requested(), r.data.error);
  installUnits(true, true);

  // Saving fails part-way: everything put back
  const before = { setting: setting(), status: fs.readFileSync(path.join(APP, 'data/update-status.json'), 'utf8') };
  fs.mkdirSync(path.join(APP, 'tmp/update-request'), { recursive: true });   // a folder where the request file goes
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'feature/good' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'feature/good', token: t });
  check("if the switch can't be saved: error, and the setting and status are put back", r.status === 500 && /nothing was changed/.test(r.data.error) && setting() === before.setting && fs.readFileSync(path.join(APP, 'data/update-status.json'), 'utf8') === before.status, r.data.error);
  fs.rmSync(path.join(APP, 'tmp/update-request'), { recursive: true, force: true });

  // ── The software each branch needs ──
  r = await call('POST', '/settings/updates/check', { branch: 'feature/good' });
  check('check: software the branch lists is checked, all present', r.data.requirements.listed && r.data.requirements.missing === 0 && r.data.requirements.results.map((x) => x.name).join() === 'Node.js,Git', JSON.stringify(r.data.requirements));
  r = await call('POST', '/settings/updates/check', { branch: 'needs-more' });
  const miss = r.data.requirements.results.filter((x) => !x.ok);
  check('check: missing and too-old software reported, with what\'s found', r.data.requirements.missing === 2 && miss.find((x) => x.name === 'Node.js').found === process.versions.node && !miss.find((x) => x.name === 'Widget').installed && miss.every((x) => x.install && x.required), JSON.stringify(miss.map((x) => [x.name, x.required, x.found])));
  r = await call('POST', '/settings/updates/check', { branch: 'no-list' });
  check('check: a branch without a list says so', r.status === 200 && r.data.requirements.listed === false);
  installUnits(true, true);
  const before2 = setting();
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'needs-more' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'needs-more', token: t });
  check('switch with missing software, not confirmed: refused, nothing changed', r.status === 409 && /missing software/.test(r.data.error) && /Node\.js, Widget/.test(r.data.error) && setting() === before2 && !requested(), r.data.error);
  t = (await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'needs-more' })).data.token;
  r = await call('POST', '/settings/updates/switch', { branch: 'needs-more', token: t, acceptMissing: true });
  check('confirmed anyway: the switch is requested', r.status === 200 && setting() === 'NOTICEBOARD_BRANCH=needs-more' && requested(), r.data.error);
  fs.rmSync(path.join(APP, 'tmp/update-request'), { force: true });
  fs.writeFileSync(path.join(APP, 'data/update-branch.env'), before2 ? before2 + '\n' : 'NOTICEBOARD_BRANCH=main\n');
  fs.rmSync(path.join(APP, 'data/update-status.json'), { force: true });

  // Wrong passwords are limited; right ones don't count
  for (let i = 0; i < 3; i++) await call('POST', '/settings/updates/verify-password', { password: 'Admin@12345', branch: 'main' });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call('POST', '/settings/updates/verify-password', { password: 'nope', branch: 'main' })).status);
  // One wrong password was used earlier in this test, so the 5th wrong one here is the 6th in all
  check('wrong passwords: limited after 5 (right ones not counted)', codes.join() === '403,403,403,403,429,429', codes.join());
  check('the admin is still logged in', (await call('GET', '/settings/updates')).status === 200);
  check('no token 3 leftovers matter', typeof token3 === 'string');

  server.kill();
  await sleep(500);
  fs.rmSync(T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); if (server) server.kill(); process.exit(1); });
