#!/usr/bin/env node
// tests/run.js — runs the test groups: node tests/run.js <group> [filter]
//
// Groups
//   unit        node:test unit tests (server/test, client/display/test). Works on Node 20 too:
//               the files are listed here instead of relying on node --test globs (Node 22+).
//   api         tests/api/*.js       each starts its own throwaway server (tests/helpers/app.js)
//   browser     tests/browser/*.js   as api, plus Chrome; a headless Chrome is started if none is
//                                    listening on port 9222 (CHROME_PATH to choose one)
//   installers  tests/installers/*.sh  bash with stand-ins for systemd, apt, git remotes…
//   upgrade     tests/upgrade/*.sh     the upgrade rehearsal (see SYSTEM_DESIGN §17)
//   all         every group in that order
// filter: only files whose name contains it, e.g. node tests/run.js browser branch
// A file that fails is followed by how it ended (exit code, signal or start error) and how long it
// ran, so a test that stops without printing a failure still says why. A file whose Node.js process
// crashed (killed by a signal, or a Windows crash code such as 0xC0000409, seen now and then on
// Windows within a second of starting, before any check) is run once more, and the summary says
// so; a test that fails a check (exit code 1) is never run again. The summary gives every file's
// time and each group's, to show where a run's time goes.
// Only one run at a time may use the api, browser or upgrade groups (fixed ports, one Chrome): a
// run holds a lock (in the temporary folder, shared with tests/snapshot.js's runs) only while it's
// in one of those groups, so unit and installer tests can run beside a background full run.
//
// Needs: `npm run build` first (api, browser, upgrade copy the built apps); FFMPEG_PATH and
// FFPROBE_PATH, or ffmpeg on the PATH, for the video tests; bash (on Windows: Git Bash, or BASH).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GROUPS = ['unit', 'api', 'browser', 'installers', 'upgrade'];

function filesIn(dir, pattern, filter) {
  const full = path.join(REPO, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => pattern.test(f) && (!filter || f.includes(filter)))
    .sort()
    .map((f) => path.join(full, f));
}

function findBash() {
  if (process.env.BASH && fs.existsSync(process.env.BASH)) return process.env.BASH;
  if (process.platform !== 'win32') return 'bash';
  // Not C:\Windows\System32\bash.exe, which is WSL
  for (const p of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

async function chromeUp() {
  try {
    return (await fetch('http://127.0.0.1:9222/json/version')).ok;
  } catch {
    return false;
  }
}

// A headless Chrome for the browser tests, unless one is already listening
async function startChrome() {
  if (await chromeUp()) return { stop: async () => {} };
  const bin = findChrome();
  if (!bin) return null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-chrome-'));
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=9222', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await chromeUp()); i++) await new Promise((r) => setTimeout(r, 250));
  return {
    stop: async () => {
      proc.kill();
      await new Promise((r) => setTimeout(r, 500));
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

// → { code, how, crashed }: code 0 only when it exited normally with 0; how says how it ended;
// crashed when the process itself died (a signal, or a Windows NTSTATUS code: 0xC0000000 and up)
function run(cmd, args) {
  const started = Date.now();
  return new Promise((resolve) => {
    const took = () => `after ${((Date.now() - started) / 1000).toFixed(1)} s`;
    const child = spawn(cmd, args, { cwd: REPO, stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve({
      code: code ?? 1,
      how: signal ? `killed by ${signal}, ${took()}` : `exit code ${code} (0x${(code >>> 0).toString(16)}), ${took()}`,
      crashed: !!signal || (code >>> 0) >= 0xC0000000,
      ms: Date.now() - started,
    }));
    child.on('error', (e) => resolve({ code: 1, how: `could not start: ${e.message}`, ms: Date.now() - started }));
  });
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const minutes = (ms) => (ms < 60000 ? seconds(ms) : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

async function runGroup(group, filter) {
  const results = [];
  if (group === 'unit') {
    const files = [
      ...filesIn('server/test', /\.test\.js$/, filter),
      ...filesIn('client/display/test', /\.test\.mjs$/, filter),
    ];
    const started = Date.now();
    const code = spawnSync(process.execPath, ['--test', ...files], { cwd: REPO, stdio: 'inherit' }).status;
    return [{ name: `unit (${files.length} files)`, result: code === 0 ? 'pass' : 'FAIL', ms: Date.now() - started }];
  }

  const isShell = group === 'installers' || group === 'upgrade';
  const files = filesIn(`tests/${group}`, isShell ? /\.sh$/ : /\.js$/, filter);
  const bash = isShell ? findBash() : null;
  if (isShell && !bash) return files.map((f) => ({ name: path.basename(f), result: 'skipped (no bash)' }));

  let chrome = null;
  if (group === 'browser' && files.length) {
    chrome = await startChrome();
    if (!chrome) return files.map((f) => ({ name: path.basename(f), result: 'skipped (no Chrome)' }));
  }
  try {
    for (const file of files) {
      console.log(`\n━━ ${group}/${path.basename(file)}`);
      let { code, how, crashed, ms } = await run(isShell ? bash : process.execPath, [file]);
      if (code !== 0) console.log(`(${path.basename(file)} ended: ${how})`);
      let note = code === 0 ? '' : how;
      if (crashed) {
        console.log(`(${path.basename(file)}: the process crashed rather than failing a check; running it once more)`);
        const first = how;
        const again = await run(isShell ? bash : process.execPath, [file]);
        ({ code, how } = again);
        ms += again.ms;
        if (code !== 0) console.log(`(${path.basename(file)} ended: ${how})`);
        note = code === 0 ? `passed on a second run; the first crashed: ${first}` : `${how}; the first run crashed: ${first}`;
      }
      results.push({ name: `${group}/${path.basename(file)}`, result: code === 0 ? 'pass' : 'FAIL', how: note, ms });
    }
  } finally {
    if (chrome) await chrome.stop();
  }
  return results;
}

// The groups that start servers on fixed ports or use the one Chrome: only one run at a time may be
// in them, or two runs would test each other's servers. Unit and installer tests need no lock.
const LOCKED_GROUPS = ['api', 'browser', 'upgrade'];
const LOCK = path.join(os.tmpdir(), 'noticeboard-tests.lock');
let holdingLock = false;

function takeLock() {
  if (holdingLock) return;
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (pid !== process.pid) {
      process.kill(pid, 0);   // throws if that run has ended
      console.error(`Another test run (process ${pid}) is using the api, browser or upgrade tests; wait for it to finish, or run only unit or installer tests meanwhile.`);
      process.exit(2);
    }
  } catch {
    // No lock, or a stale one from a run that ended
  }
  fs.writeFileSync(LOCK, String(process.pid));
  holdingLock = true;
}

function releaseLock() {
  if (!holdingLock) return;
  try { fs.rmSync(LOCK); } catch { /* already gone */ }
  holdingLock = false;
}
process.on('exit', releaseLock);

(async () => {
  const [which = 'unit', filter] = process.argv.slice(2);
  const groups = which === 'all' ? GROUPS : [which];
  if (!groups.every((g) => GROUPS.includes(g))) {
    console.error(`Unknown group "${which}". Groups: ${GROUPS.join(', ')}, all`);
    process.exit(2);
  }
  const results = [];
  const groupTimes = [];
  for (const g of groups) {
    if (LOCKED_GROUPS.includes(g)) takeLock(); else releaseLock();
    const started = Date.now();
    results.push(...(await runGroup(g, filter)));
    groupTimes.push(`${g} ${minutes(Date.now() - started)}`);
  }
  releaseLock();
  console.log('\n━━ Summary');
  for (const r of results) {
    const time = r.ms !== undefined ? seconds(r.ms).padStart(8) : ''.padStart(8);
    console.log(`  ${r.result.padEnd(20)} ${time}  ${r.name}${r.how ? `  (${r.how})` : ''}`);
  }
  console.log(`\n  Time: ${groupTimes.join(', ')}`);
  const failed = results.filter((r) => r.result === 'FAIL').length;
  console.log(failed ? `\n${failed} failed` : '\nNo failures');
  process.exit(failed ? 1 : 0);
})();
