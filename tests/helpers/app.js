// tests/helpers/app.js — throwaway Noticeboard apps for the api, browser and upgrade tests
//
// Responsibilities
//   Make a private copy of the working tree (a git clone, so version info works), with its own
//   data/, port and built web apps, and start, stop, crash and log in to its server. Nothing a
//   test does ever touches this repository's own data/, tmp/ or logs/.
//
// Provides
//   REPO, MODULES              this repository, and the node_modules the copies load packages from
//   makeApp({ port, config, keepSample })  → { T, APP, port, base }: a copy in a temp folder
//   server(env)                → { start(extraEnv), stop(), api(method, path, body), login(), cookie() }
//                                start() waits for GET /api/auth/status, like update.sh does
//   page(connect, size)        → a Chrome tab (cdp.js) with until/go/login/click/mouse helpers
//   ffmpegEnv()                → { FFMPEG_PATH, FFPROBE_PATH } when ffmpeg is found, else {} (see hasFfmpeg)
//   shot(name)                 → a path for a screenshot, outside the repository
//   copyChanges(dest)          copies this working tree's uncommitted changes onto a clone of it
//                                (changed and new files; deleted ones removed)
//   check(name, pass, detail), done(env), sleep, git
//   untilSlideEnds(playlist)   waits until the slide on air in that playlist ends (+400 ms): when a
//                              changed playlist reaches the screens (SYSTEM_DESIGN §18.8)
//
// Used by
//   tests/api/*, tests/browser/* (the branch tests build their own clone with copyChanges)
//
// Uses
//   git (clone), the built apps in client/*/dist (run `npm run build` first), bcrypt from
//   node_modules (a fast test password hash)
//
// Change impact
//   Every api and browser test starts its server through start(). The copy is made from the working
//   tree including uncommitted changes, so the tests check the code as it is on disk.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MODULES = path.join(REPO, 'node_modules');
const bcrypt = require(path.join(MODULES, 'bcrypt'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let ok = true;
const check = (name, pass, detail = '') => { ok &&= !!pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

// ffmpeg for video processing: FFMPEG_PATH/FFPROBE_PATH if set, else the programs on the PATH
function ffmpegEnv() {
  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    return { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };
  }
  return {};
}
function hasFfmpeg() {
  const bin = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SHOTS = path.join(os.tmpdir(), 'noticeboard-test-shots');
function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, name);
}

// This working tree's uncommitted changes, onto a clone of it at dest. git lists a deleted file as
// modified too, so deleted files are removed rather than copied.
function copyChanges(dest) {
  const list = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const deleted = new Set(list(['ls-files', '--deleted']));
  for (const f of list(['ls-files', '--modified', '--others', '--exclude-standard'])) {
    if (deleted.has(f)) continue;
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dest, f));
  }
  for (const f of deleted) fs.rmSync(path.join(dest, f), { force: true });
}

// The working tree as a git clone with one extra commit holding uncommitted changes
function copyWorkingTree(dest) {
  git(path.dirname(dest), 'clone', '-q', REPO, path.basename(dest));
  copyChanges(dest);
  git(dest, 'add', '-A');
  git(dest, 'commit', '-qm', 'working tree', '--allow-empty');
}

function makeApp({ port = 3910, config = {}, keepSample = false } = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-test-'));
  const APP = path.join(T, 'app');
  copyWorkingTree(APP);
  for (const d of ['client/admin/dist', 'client/display/dist']) {
    if (!fs.existsSync(path.join(REPO, d))) throw new Error(`${d} is missing: run npm run build first`);
    fs.cpSync(path.join(REPO, d), path.join(APP, d), { recursive: true });
  }
  fs.mkdirSync(path.join(APP, 'data/slideshows'), { recursive: true });
  fs.writeFileSync(path.join(APP, 'data/config.json'), JSON.stringify({
    port, passwordHash: bcrypt.hashSync('Admin@12345', 4), jwtSecret: 'x'.repeat(64),
    macFiltering: { enabled: false, approved: [] }, display: { defaultSlideDurationSeconds: 10 }, slideshows: [],
    ...(keepSample ? {} : { sampleSlideshow: { folder: null, signature: 'skip' } }),
    ...config,
  }, null, 2));
  return { T, APP, port, base: `http://localhost:${port}` };
}

// Servers still running when a test exits (e.g. after an error) are stopped with it
const running = new Set();
process.on('exit', () => { for (const p of running) p.kill(); });

function server(env) {
  let proc = null;
  let cookie = '';
  const api = async (method, p, body, { auth = true, raw = false } = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(env.base + p, {
      method,
      headers: { ...(auth && cookie ? { Cookie: cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return {
    api,
    async start(extraEnv = {}) {
      proc = spawn(process.execPath, ['server/index.js'], {
        cwd: env.APP,
        env: { ...process.env, NODE_PATH: MODULES, ...ffmpegEnv(), ...extraEnv },
        stdio: 'ignore',
      });
      running.add(proc);
      for (let i = 0; i < 120; i++) {
        try { if ((await fetch(env.base + '/api/auth/status')).ok) return; } catch { /* not yet */ }
        await sleep(250);
      }
      throw new Error('server did not start');
    },
    async stop() {
      if (!proc) return;
      const p = proc;
      proc = null;
      running.delete(p);
      // Already ended by itself (e.g. a restart from the admin panel): nothing to wait for
      if (p.exitCode !== null || p.signalCode !== null) return;
      p.kill();
      await new Promise((r) => p.on('exit', r));
    },
    async login(password = 'Admin@12345') {
      const res = await fetch(env.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      cookie = (res.headers.get('set-cookie') || '').split(';')[0];
      return res.status;
    },
    cookie: () => cookie,
    setCookie: (c) => { cookie = c; },
  };
}

// Browser helpers on top of cdp.js
async function page(connect, { width = 1280, height = 720 } = {}) {
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  c.until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); } return false; };
  c.go = async (url) => { await c.send('Page.navigate', { url }); await sleep(300); };
  c.login = async (base, password = 'Admin@12345') => {
    await c.go(base + '/admin/login');
    await c.until(`!!document.querySelector('input[type=password]')`);
    await c.evaluate(`(() => { const i = document.querySelector('input[type=password]'); i.value = ${JSON.stringify(password)}; i.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
    await c.until(`location.pathname.startsWith('/admin/slideshows')`);
  };
  c.mouse = (x, y) => c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  c.click = (text) => c.evaluate(`(() => { const b = [...document.querySelectorAll('button, a, label')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('nothing to click: ' + ${JSON.stringify(text)}); b.click(); })()`);
  return c;
}

// A changed playlist reaches the screens when the slide on air ends (every screen in step,
// SYSTEM_DESIGN §18.8): wait for that moment of the playlist the screens have
async function untilSlideEnds(playlist, extraMs = 400) {
  const { boundaryAfter } = require('../../shared/slideTimeline.mjs');
  if (playlist?.slides?.length) await sleep(Math.max(0, boundaryAfter(playlist.slides, playlist.startedAt ?? Date.now(), Date.now()) - Date.now()) + extraMs);
}

function done(env) {
  if (env) fs.rmSync(env.T, { recursive: true, force: true });
  console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
}

module.exports = {
  REPO, MODULES, sleep, git, check, makeApp, server, page, done, ffmpegEnv, hasFfmpeg, shot, copyWorkingTree, copyChanges, untilSlideEnds,
  isOk: () => ok,
};
