const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  ROOT, updateBranchPath, updateStatusPath, updateCheckPath, updateNoticePath, updateRequestPath, systemdDir,
} = require('../utils/pathHelpers');
const logger = require('../utils/logger');

// Software updates: which GitHub branch this noticeboard follows, and switching to another.
// installers/update.sh does the updating (a systemd service, set up by install.sh). This side
// checks a branch, saves the setting, asks for an update and reads back what happened.

const UPDATE_UNIT = 'noticeboard-update';
// update.sh only installs another branch whose own update.sh mentions this file too (branch
// switching exists there), so the noticeboard can always be switched back
const SUPPORT_MARKER = 'update-branch.env';
// A requested or running update older than this didn't finish (e.g. the Pi lost power)
const STALE_MS = 60 * 60 * 1000;
// Between the password check and the final confirmation
const TOKEN_MS = 5 * 60 * 1000;

// An error whose message is meant for the admin
function userError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: ROOT,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

// The same rules as valid_branch in update.sh
function validBranchName(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._/-]{1,100}$/.test(name)
    && !/^[-/.]|[/.]$|\.\.|\/\/|\/\.|\.lock$/.test(name)
    && name !== 'HEAD';
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// Replace a file in one step, so update.sh never reads half of it
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

// The branch updates follow: the admin's choice, else main
async function configuredBranch() {
  const text = await fs.readFile(updateBranchPath(), 'utf8').catch(() => '');
  const match = text.match(/^NOTICEBOARD_BRANCH=(.*)$/m);
  return (match && match[1].trim()) || 'main';
}

// A switch or update that hasn't finished yet
function inProgress(status) {
  return !!status
    && (status.state === 'requested' || status.state === 'updating')
    && Date.now() - Date.parse(status.time) < STALE_MS;
}

// Everything the Software updates card shows
async function getInfo() {
  let commit;
  let branch;
  try {
    commit = await git(['rev-parse', 'HEAD']);
    branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
  } catch {
    return {
      available: false,
      reason: "This copy of the noticeboard wasn't installed from GitHub by the installer, so it can't update itself.",
    };
  }
  const [configured, status, lastCheck, timer, pathUnit, pending] = await Promise.all([
    configuredBranch(),
    readJson(updateStatusPath()),
    readJson(updateCheckPath()),
    exists(path.join(systemdDir(), 'timers.target.wants', `${UPDATE_UNIT}.timer`)),
    exists(path.join(systemdDir(), 'paths.target.wants', `${UPDATE_UNIT}.path`)),
    exists(updateRequestPath()),
  ]);
  return {
    available: true,
    branch: branch || null,        // null: not on a branch (someone checked out a commit)
    commit,
    configuredBranch: configured,
    autoUpdates: timer,            // checked every 15 minutes
    instant: pathUnit,             // a switch starts within seconds (else at the next check)
    pending,
    busy: inProgress(status),
    status,                        // the last update or switch (update.sh)
    lastCheck,                     // the last check for updates (update.sh)
  };
}

// The installed version, for the admin panel's "Last updated": its commit and when that commit
// was made (the same on every Pi running it). null if this copy isn't a git clone.
async function versionInfo() {
  try {
    const [commit, date] = (await git(['log', '-1', '--format=%H%x00%cI'])).split('\0');
    const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
    return { commit, date, branch: branch || null };
  } catch {
    return null;
  }
}

// A notice for the admin home page (e.g. "your branch was merged into main, so this
// noticeboard went back to main"), written by update.sh and kept until an admin closes it
async function getNotice() {
  return readJson(updateNoticePath());
}

async function dismissNotice(by) {
  const notice = await getNotice();
  await fs.rm(updateNoticePath(), { force: true });
  if (notice) logger.info('Update notice closed', { type: notice.type, by });
}

// The branches on GitHub, main first
async function listBranches() {
  let out;
  try {
    out = await git(['ls-remote', '--heads', 'origin'], 20000);
  } catch {
    throw userError(502, "Couldn't reach GitHub to list the branches. Check this noticeboard's internet connection.");
  }
  return out.split('\n')
    .map((line) => line.split('\trefs/heads/')[1])
    .filter(validBranchName)
    .sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)));
}

// Whether a branch exists and can safely be switched to: the same checks update.sh makes
// before installing it. Downloads it, so the switch itself is quicker.
async function checkBranch(name) {
  if (!validBranchName(name)) {
    throw userError(400, "That isn't a valid branch name. Branch names use letters, numbers, and . _ / -");
  }
  let found;
  try {
    found = await git(['ls-remote', '--heads', 'origin', `refs/heads/${name}`], 20000);
  } catch {
    throw userError(502, "Couldn't reach GitHub to check the branch. Check this noticeboard's internet connection and try again.");
  }
  if (!found) throw userError(404, `There's no branch called "${name}" on GitHub.`);
  try {
    await git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`], 180000);
  } catch {
    throw userError(502, `Couldn't download "${name}" from GitHub to check it. Try again.`);
  }
  const commit = await git(['rev-parse', `refs/remotes/origin/${name}`]);
  if (await git(['ls-tree', '-r', '--name-only', commit, '--', 'data', 'tmp', 'logs', '.env'])) {
    throw userError(422, `"${name}" can't be used: it contains files in data/, tmp/, logs/ or .env, which would overwrite this noticeboard's content or settings.`);
  }
  const updater = await git(['show', `${commit}:installers/update.sh`]).catch(() => '');
  if (!updater.includes(SUPPORT_MARKER)) {
    throw userError(422, `"${name}" can't be used: it's older than branch switching, so this noticeboard couldn't be switched back from the admin panel.`);
  }
  const [subject = '', date = ''] = (await git(['log', '-1', '--format=%s%x00%cI', commit])).split('\0');
  return { branch: name, commit, subject, date };
}

// One-time proof that the admin password was checked, for the final confirmation
const tokens = new Map();   // token -> { branch, expires }

function issueToken(branch) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { branch, expires: Date.now() + TOKEN_MS });
  return token;
}

function takeToken(token, branch) {
  const entry = typeof token === 'string' ? tokens.get(token) : undefined;
  tokens.delete(token);
  for (const [t, e] of tokens) {
    if (e.expires < Date.now()) tokens.delete(t);
  }
  return !!entry && entry.branch === branch && entry.expires >= Date.now();
}

// Save the new branch for this and all future updates, and ask update.sh to install it now.
// If anything can't be saved, everything is put back as it was.
async function requestSwitch(name, by) {
  const info = await getInfo();
  if (!info.available) throw userError(409, info.reason);
  if (!info.autoUpdates && !info.instant) {
    throw userError(409, "Automatic updates aren't set up on this noticeboard, so a switch would never be installed. Run the installer on the Pi to set them up.");
  }
  if (info.busy) throw userError(409, 'An update is already in progress. Wait for it to finish, then try again.');
  if (name === info.branch && name === info.configuredBranch) {
    throw userError(409, `This noticeboard already uses ${name}.`);
  }
  const target = await checkBranch(name);   // again: the branch may have changed since it was checked

  const when = info.instant ? 'It starts within a few seconds.' : 'It starts at the next update check, within 15 minutes.';
  const status = {
    state: 'requested',
    branch: name,
    previousBranch: info.branch,
    commit: info.commit,
    previousCommit: info.commit,
    target: target.commit,
    message: `Switch from ${info.branch || info.commit.slice(0, 7)} to ${name} requested. ${when}`,
    time: new Date().toISOString(),
  };
  const oldSetting = await fs.readFile(updateBranchPath(), 'utf8').catch(() => null);
  const oldStatus = await fs.readFile(updateStatusPath(), 'utf8').catch(() => null);
  try {
    await writeAtomic(updateBranchPath(), `NOTICEBOARD_BRANCH=${name}\n`);
    await writeAtomic(updateStatusPath(), `${JSON.stringify(status)}\n`);
    await writeAtomic(updateRequestPath(), `${status.time} ${name}\n`);
  } catch (err) {
    await fs.rm(updateRequestPath(), { force: true }).catch(() => {});
    await (oldSetting === null ? fs.rm(updateBranchPath(), { force: true }) : writeAtomic(updateBranchPath(), oldSetting)).catch(() => {});
    await (oldStatus === null ? fs.rm(updateStatusPath(), { force: true }) : writeAtomic(updateStatusPath(), oldStatus)).catch(() => {});
    logger.error('Could not save a branch switch', { err: err.message });
    throw userError(500, "Couldn't save the new branch, so nothing was changed.");
  }
  logger.warn('Branch switch requested', { from: info.branch, to: name, target: target.commit, by });
  return getInfo();
}

module.exports = {
  getInfo,
  versionInfo,
  getNotice,
  dismissNotice,
  listBranches,
  checkBranch,
  validBranchName,
  issueToken,
  takeToken,
  requestSwitch,
};
