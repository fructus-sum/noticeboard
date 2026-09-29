#!/usr/bin/env node
// tests/snapshot.js — the test run on a snapshot of a commit, so coding can carry on meanwhile
//
//   node tests/snapshot.js [<commit> = HEAD] [<group> = all] [filter]
//
// Makes a git worktree of <commit> in the temporary folder, links this checkout's node_modules
// into it (nothing installs there, so it's never changed), builds it (npm run build) and runs
// tests/run.js <group> [filter] in it. Editing, building or committing in this checkout can't
// affect the run, as only <commit> is tested: changes not committed yet aren't in it (it says so).
// The output goes to the console and to <temporary folder>/noticeboard-snapshot-<commit>.log; the
// exit code is run.js's (1 if the build fails). The worktree is removed at the end, the link first,
// so removing the folder can never reach this checkout's node_modules.
//
// While it's in the api, browser or upgrade tests it holds run.js's lock, so a run in this
// checkout waits for those (unit and installer tests can run beside it). SYSTEM_DESIGN §17.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const WINDOWS = process.platform === 'win32';
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

const [ref = 'HEAD', group = 'all', filter] = process.argv.slice(2);
const commit = git('rev-parse', '--verify', `${ref}^{commit}`);
const short = commit.slice(0, 7);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nb-snapshot-${short}-`));
const logFile = path.join(os.tmpdir(), `noticeboard-snapshot-${short}.log`);
const log = fs.createWriteStream(logFile);
const say = (text) => { process.stdout.write(text); log.write(text); };

// Runs a command in the snapshot, its output to the console and the log
function step(cmd, args) {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows, which only starts through a shell: given as one command line
    const child = cmd === 'npm' ? spawn(['npm', ...args].join(' '), { cwd: dir, shell: true }) : spawn(cmd, args, { cwd: dir });
    child.stdout.on('data', say);
    child.stderr.on('data', say);
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (e) => { say(`${cmd} couldn't start: ${e.message}\n`); resolve(1); });
  });
}

function linkModules() {
  const target = path.join(REPO, 'node_modules');
  const link = path.join(dir, 'node_modules');
  if (WINDOWS) execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' });
  else fs.symlinkSync(target, link);
}

function cleanUp() {
  const link = path.join(dir, 'node_modules');
  try {
    if (fs.existsSync(link)) {
      if (WINDOWS) execFileSync('cmd', ['/c', 'rmdir', link], { stdio: 'ignore' });
      else fs.unlinkSync(link);
    }
  } catch (e) {
    // The link stays: never delete the folder through it
    say(`\nCouldn't remove the node_modules link in ${dir} (${e.message}); remove the link, then the folder.\n`);
    return;
  }
  try { git('worktree', 'remove', '--force', dir); } catch { /* removed below */ }
  fs.rmSync(dir, { recursive: true, force: true });
  try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
}

(async () => {
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  say(`Testing ${short} (${git('log', '-1', '--format=%s', commit)}) in ${dir}: ${group}${filter ? ` ${filter}` : ''}\n`);
  if (dirty && ref === 'HEAD') say('Changes not committed yet aren\'t in this run.\n');
  say(`Log: ${logFile}\n`);
  let code = 1;
  try {
    git('worktree', 'add', '--detach', '--quiet', dir, commit);
    linkModules();
    code = await step('npm', ['run', 'build']);
    if (code !== 0) say('\nThe build failed, so nothing was tested.\n');
    else code = await step(process.execPath, [path.join(dir, 'tests/run.js'), group, ...(filter ? [filter] : [])]);
  } catch (e) {
    say(`\nCouldn't set up the snapshot: ${e.message}\n`);
  } finally {
    cleanUp();
  }
  say(`\nSnapshot run of ${short}: ${code === 0 ? 'passed' : 'FAILED'}. Log: ${logFile}\n`);
  log.end(() => process.exit(code));
})();
