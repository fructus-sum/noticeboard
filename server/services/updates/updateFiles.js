// server/services/updates/updateFiles.js — the files the server and installers/update.sh share
//
// Responsibilities
//   The one place in the server that knows the names and formats of the files through which
//   the admin panel and the updater talk (SYSTEM_DESIGN §4.2). They must stay exactly as
//   update.sh (including older copies of it on installed Pis) reads and writes them:
//     data/update-branch.env    NOTICEBOARD_BRANCH=<branch> (update.sh also adds
//                               NOTICEBOARD_MAIN_AT_SWITCH=<commit>)
//     data/update-status.json   the last update or switch (the server writes only "requested")
//     data/update-check.json    the last check for updates (update.sh only)
//     data/update-notice.json   the home page notice (update.sh writes, the admin closes it)
//     tmp/update-request        its existence starts update.sh (systemd's noticeboard-update.path)
//
// Provides
//   readBranchSetting()        → Promise<string>  the branch updates follow ('main' if none)
//   readStatus(), readCheck(), readNotice()  → the parsed file, or null
//   deleteNotice()             → Promise
//   requestPending()           → Promise<boolean>  tmp/update-request exists
//   unitsEnabled()             → Promise<{ timer, path }>  the updater's systemd units are enabled
//   saveSwitch(branch, status) → Promise  writes the branch setting, then the status, then the
//                                request, each in one step. If any write fails, all three are
//                                put back as they were and the error is thrown
//
// Used by
//   services/updates/index.js, services/updates/installerVersion.js (the branch)
//
// Uses
//   utils/configIO (writeFileAtomic, readJsonFile), utils/pathHelpers
const fs = require('fs/promises');
const path = require('path');
const { writeFileAtomic, readJsonFile } = require('../../utils/configIO');
const {
  updateBranchPath, updateStatusPath, updateCheckPath, updateNoticePath, updateRequestPath, systemdDir,
} = require('../../utils/pathHelpers');

const UPDATE_UNIT = 'noticeboard-update';

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readBranchSetting() {
  const text = await fs.readFile(updateBranchPath(), 'utf8').catch(() => '');
  const match = text.match(/^NOTICEBOARD_BRANCH=(.*)$/m);
  return (match && match[1].trim()) || 'main';
}

const readStatus = async () => readJsonFile(updateStatusPath());
const readCheck = async () => readJsonFile(updateCheckPath());
const readNotice = async () => readJsonFile(updateNoticePath());

function deleteNotice() {
  return fs.rm(updateNoticePath(), { force: true });
}

function requestPending() {
  return exists(updateRequestPath());
}

async function unitsEnabled() {
  const [timer, pathUnit] = await Promise.all([
    exists(path.join(systemdDir(), 'timers.target.wants', `${UPDATE_UNIT}.timer`)),
    exists(path.join(systemdDir(), 'paths.target.wants', `${UPDATE_UNIT}.path`)),
  ]);
  return { timer, path: pathUnit };
}

// The request is written last: its appearance starts update.sh, which then finds the other two
async function saveSwitch(branch, status) {
  const oldSetting = await fs.readFile(updateBranchPath(), 'utf8').catch(() => null);
  const oldStatus = await fs.readFile(updateStatusPath(), 'utf8').catch(() => null);
  try {
    await writeFileAtomic(updateBranchPath(), `NOTICEBOARD_BRANCH=${branch}\n`);
    await writeFileAtomic(updateStatusPath(), `${JSON.stringify(status)}\n`);
    await writeFileAtomic(updateRequestPath(), `${status.time} ${branch}\n`);
  } catch (err) {
    await fs.rm(updateRequestPath(), { force: true }).catch(() => {});
    await (oldSetting === null ? fs.rm(updateBranchPath(), { force: true }) : writeFileAtomic(updateBranchPath(), oldSetting)).catch(() => {});
    await (oldStatus === null ? fs.rm(updateStatusPath(), { force: true }) : writeFileAtomic(updateStatusPath(), oldStatus)).catch(() => {});
    throw err;
  }
}

module.exports = {
  readBranchSetting,
  readStatus,
  readCheck,
  readNotice,
  deleteNotice,
  requestPending,
  unitsEnabled,
  saveSwitch,
};
