// server/services/updates/index.js — software updates, as the admin panel sees them
//
// Responsibilities
//   Which GitHub branch this noticeboard follows, how updates went, and switching to another
//   branch. installers/update.sh does the updating (a systemd service set up by install.sh);
//   this side checks a branch, saves the switch, asks for an update and reads back what happened.
//   Errors meant for the admin carry `expose` and a status (routes answer them with jsonRoute).
//
// Provides
//   getInfo()              → what the Software updates card shows (or { available: false, reason })
//   versionInfo()          → { commit, date, installedAt, branch } for "Last updated", or null
//   getNotice(), dismissNotice(by)   the home page notice (e.g. "merged into main")
//   installerStatus()      → whether the running version needs the installer run again
//   listBranches()         → the branches on GitHub, main first
//   checkBranch(name)      → the checks update.sh makes before installing a branch, plus its
//                            latest commit, the software it needs and its installer needs.
//                            Downloads the branch, so the switch itself is quicker
//   requestSwitch(name, by, { acceptMissing })  saves the switch and starts update.sh
//   setSchedule(body, by)  → info: saves the update schedule, then asks update.sh to check
//                            (it works out the next install time)
//   setInstallAt(value, by) → info: a set time for the waiting update, then a check
//   installNow(by)         → info: installs the latest version of the followed branch now
//   waitingUpdate(info)    → the version waiting to be installed ({ commit, subject, date,
//                            nextInstall }), or null
//   updaterReady()         → info, or throws (409) when this noticeboard can't update itself
//   manualUpdateWaiting()  → whether the screens show the warning mark for it: manual
//                            updates, and a version waiting (SYSTEM_DESIGN §14 D41)
//   validBranchName                              (from branchName.js)
//   issueToken(branch), takeToken(token, branch) the password check's one-time token for a
//                            switch (services/actionTokens, action 'switch')
//
// Used by
//   routes/api/settings/updates.js
//
// Uses
//   ./git, ./branchName, ./updateFiles, ./installerVersion, ./schedule, services/actionTokens,
//   utils/systemCheck,
//   utils/logger
//
// Change impact
//   checkBranch must refuse what update.sh refuses (files in data/, tmp/, logs/ or .env; an
//   update.sh without branch switching), or the admin would be told a switch works that the
//   updater then cancels.
const { git } = require('./git');
const { validBranchName } = require('./branchName');
const files = require('./updateFiles');
const installer = require('./installerVersion');
const scheduleRules = require('./schedule');
const tokens = require('../actionTokens');
const { checkRequirements } = require('../../utils/systemCheck');
const logger = require('../../utils/logger');

// update.sh only installs another branch whose own update.sh mentions this file too (branch
// switching exists there), so the noticeboard can always be switched back
const SUPPORT_MARKER = 'update-branch.env';
// A requested or running update older than this didn't finish (e.g. the Pi lost power)
const STALE_MS = 60 * 60 * 1000;

// An error whose message is meant for the admin
function userError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

// A switch or update that hasn't finished yet
function inProgress(status) {
  return !!status
    && (status.state === 'requested' || status.state === 'updating')
    && Date.now() - Date.parse(status.time) < STALE_MS;
}

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
  const [configured, status, lastCheck, units, pending, schedule] = await Promise.all([
    files.readBranchSetting(),
    files.readStatus(),
    files.readCheck(),
    files.unitsEnabled(),
    files.requestPending(),
    files.readSchedule(),
  ]);
  return {
    available: true,
    branch: branch || null,        // null: not on a branch (someone checked out a commit)
    commit,
    configuredBranch: configured,
    autoUpdates: units.timer,      // checked every 15 minutes
    instant: units.path,           // a switch starts within seconds (else at the next check)
    pending,
    busy: inProgress(status),
    status,                        // the last update or switch (update.sh)
    lastCheck,                     // the last check for updates (update.sh)
    schedule,                      // { every, time, day, at } (data/update-schedule.env)
    waiting: waitingUpdate({ commit, lastCheck }),
  };
}

// A newer version update.sh found but hasn't installed yet (not due), or null
function waitingUpdate({ commit, lastCheck }) {
  if (lastCheck?.result !== 'available' || !lastCheck.available || lastCheck.available === commit) return null;
  return {
    commit: lastCheck.available,
    subject: lastCheck.availableSubject || '',
    date: lastCheck.availableDate || null,
    nextInstall: lastCheck.nextInstall || null,
  };
}

async function manualUpdateWaiting() {
  const [schedule, lastCheck, commit] = await Promise.all([
    files.readSchedule(),
    files.readCheck(),
    git(['rev-parse', 'HEAD']).catch(() => null),
  ]);
  return schedule.every === 'manual' && !!waitingUpdate({ commit, lastCheck });
}

// The updater must be set up for any of these to happen
async function updaterReady() {
  const info = await getInfo();
  if (!info.available) throw userError(409, info.reason);
  if (!info.autoUpdates && !info.instant) {
    throw userError(409, "Automatic updates aren't set up on this noticeboard. Run the installer on the Pi to set them up.");
  }
  return info;
}

async function setSchedule(body, by) {
  const parsed = scheduleRules.parseSchedule(body);
  if (parsed.error) throw userError(400, parsed.error);
  await updaterReady();
  await files.saveSchedule(parsed);
  await files.requestRun('check');
  logger.info('Update schedule changed', { ...parsed, by });
  return getInfo();
}

async function setInstallAt(value, by) {
  const parsed = scheduleRules.parseInstallAt(value);
  if (parsed.error) throw userError(400, parsed.error);
  await updaterReady();
  await files.saveInstallAt(parsed.at);
  await files.requestRun('check');
  logger.info('Update time set', { at: parsed.at, by });
  return getInfo();
}

async function installNow(by) {
  const info = await updaterReady();
  if (info.busy) throw userError(409, 'An update is already in progress. Wait for it to finish.');
  const when = info.instant ? 'It starts within a few seconds.' : 'It starts at the next update check, within 15 minutes.';
  await files.saveInstallNow({
    state: 'requested',
    branch: info.branch || info.configuredBranch,
    previousBranch: info.branch,
    commit: info.commit,
    previousCommit: info.commit,
    target: info.waiting?.commit || '',
    message: `Update to the latest version of ${info.configuredBranch} requested. ${when}`,
    time: new Date().toISOString(),
  });
  logger.info('Update now requested', { by });
  return getInfo();
}

// When the installed version was made (date), and when this noticeboard installed it
// (installedAt: the last update's time, if that update installed the version running now)
async function versionInfo() {
  try {
    const [commit, date] = (await git(['log', '-1', '--format=%H%x00%cI'])).split('\0');
    const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
    const status = await files.readStatus();
    const installedAt = status?.state === 'updated' && status.commit === commit && !Number.isNaN(Date.parse(status.time))
      ? status.time : null;
    return { commit, date, installedAt, branch: branch || null };
  } catch {
    return null;
  }
}

function getNotice() {
  return files.readNotice();
}

async function dismissNotice(by) {
  const notice = await files.readNotice();
  await files.deleteNotice();
  if (notice) logger.info('Update notice closed', { type: notice.type, by });
}

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
  return { branch: name, commit, subject, date, ...(await requirementsOf(commit)) };
}

// The branch's system-requirements.json checked against this noticeboard (requirements:
// { listed: false } for a branch without one: it can't be checked), and its installer needs
async function requirementsOf(commit) {
  const text = await git(['show', `${commit}:system-requirements.json`]).catch(() => null);
  if (!text) return { requirements: { listed: false }, installer: installer.installerNeeds(null, null) };
  try {
    const list = JSON.parse(text);
    const [checked, installed] = await Promise.all([checkRequirements(list), installer.installedVersion()]);
    return { requirements: { listed: true, ...checked }, installer: installer.installerNeeds(list, installed) };
  } catch {
    return { requirements: { listed: false, unreadable: true }, installer: installer.installerNeeds(null, null) };
  }
}

// Save the new branch for this and all future updates, and ask update.sh to install it now.
// If anything can't be saved, everything is put back as it was.
async function requestSwitch(name, by, { acceptMissing = false } = {}) {
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
  // Software the branch needs but this noticeboard lacks: only with the admin's extra confirmation
  const missing = target.requirements.listed ? target.requirements.results.filter((r) => !r.ok) : [];
  if (missing.length && !acceptMissing) {
    throw userError(409, `This noticeboard is missing software ${name} needs: ${missing.map((r) => r.name).join(', ')}. Install it first, or confirm that you want to switch anyway.`);
  }

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
  try {
    await files.saveSwitch(name, status);
  } catch (err) {
    logger.error('Could not save a branch switch', { err: err.message });
    throw userError(500, "Couldn't save the new branch, so nothing was changed.");
  }
  logger.warn('Branch switch requested', { from: info.branch, to: name, target: target.commit, by, missingSoftware: missing.map((r) => r.name) });
  return getInfo();
}

module.exports = {
  getInfo,
  versionInfo,
  getNotice,
  dismissNotice,
  installerStatus: installer.status,
  listBranches,
  checkBranch,
  requestSwitch,
  setSchedule,
  setInstallAt,
  installNow,
  waitingUpdate,
  manualUpdateWaiting,
  updaterReady,
  validBranchName,
  issueToken: (branch) => tokens.issue('switch', branch),
  takeToken: (token, branch) => tokens.take(token, 'switch', branch),
};
