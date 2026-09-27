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
//   upgrade     tests/upgrade/*.sh     the upgrade rehearsal (see GOAL_SYSTEM_DESIGN §10)
//   all         every group in that order
// filter: only files whose name contains it, e.g. node tests/run.js browser branch
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

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function runGroup(group, filter) {
  const results = [];
  if (group === 'unit') {
    const files = [
      ...filesIn('server/test', /\.test\.js$/, filter),
      ...filesIn('client/display/test', /\.test\.mjs$/, filter),
    ];
    const code = spawnSync(process.execPath, ['--test', ...files], { cwd: REPO, stdio: 'inherit' }).status;
    return [{ name: `unit (${files.length} files)`, result: code === 0 ? 'pass' : 'FAIL' }];
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
      const code = await run(isShell ? bash : process.execPath, [file]);
      results.push({ name: `${group}/${path.basename(file)}`, result: code === 0 ? 'pass' : 'FAIL' });
    }
  } finally {
    if (chrome) await chrome.stop();
  }
  return results;
}

(async () => {
  const [which = 'unit', filter] = process.argv.slice(2);
  const groups = which === 'all' ? GROUPS : [which];
  if (!groups.every((g) => GROUPS.includes(g))) {
    console.error(`Unknown group "${which}". Groups: ${GROUPS.join(', ')}, all`);
    process.exit(2);
  }
  const results = [];
  for (const g of groups) results.push(...(await runGroup(g, filter)));
  console.log('\n━━ Summary');
  for (const r of results) console.log(`  ${r.result.padEnd(20)} ${r.name}`);
  const failed = results.filter((r) => r.result === 'FAIL').length;
  console.log(failed ? `\n${failed} failed` : '\nNo failures');
  process.exit(failed ? 1 : 0);
})();
