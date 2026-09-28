// server/services/updates/updateFiles.js — the files the server and installers/update.sh share
//
// Responsibilities
//   The one place in the server that knows the names and formats of the files through which
//   the admin panel and the updater talk (SYSTEM_DESIGN §4.2). They must stay exactly as
//   update.sh (including older copies of it on installed Servers) reads and writes them:
//     data/update-branch.env    NOTICEBOARD_BRANCH=<branch> (update.sh also adds
//                               NOTICEBOARD_MAIN_AT_SWITCH=<commit>)
//     data/update-status.json   the last update or switch (the server writes only "requested")
//     data/update-check.json    the last check for updates (update.sh only)
//     data/update-notice.json   the home page notice (update.sh writes, the admin closes it)
//     data/update-schedule.env  the update schedule (NOTICEBOARD_UPDATE_EVERY, _TIME, _DAY, _SINCE,
//                               _AT), read by installers/lib/schedule.sh; update.sh removes _AT once
//                               the set time has come
//     tmp/update-request        its existence starts update.sh (systemd's noticeboard-update.path);
//                               its text says what was asked: "install-now", "check",
//                               "restore-defaults", or a switch
//
// Provides
//   readBranchSetting()        → Promise<string>  the branch updates follow ('main' if none)
//   readStatus(), readCheck(), readNotice()  → the parsed file, or null
//   deleteNotice()             → Promise
//   requestPending()           → Promise<boolean>  tmp/update-request exists
//   unitsEnabled()             → Promise<{ timer, path }>  the updater's systemd units are enabled
//   readSchedule()             → Promise<{ every, time, day, at }> (the defaults if there is no file)
//   saveSchedule({ every, time, day }) → Promise  keeps a set time; records when (SINCE)
//   saveInstallAt(iso|null)    → Promise  sets or removes the set time, keeping the schedule
//   requestRun(what)           → Promise  writes tmp/update-request: "check" or "install-now"
//   saveInstallNow(status)     → Promise  the status ("requested"), then the request
//   saveRestoreRequest(status) → Promise  the status, then the "restore-defaults" request
//   saveSwitch(branch, status) → Promise  writes the branch setting, then the status, then the
//                                request, each in one step. If any write fails, all three are
//                                put back as they were and the error is thrown
//
// Used by
//   services/updates/index.js, services/updates/installerVersion.js (the branch),
//   services/contentReset.js (the Restore Defaults request)
//
// Uses
//   utils/configIO (writeFileAtomic, readJsonFile), utils/pathHelpers, services/updates/schedule
//   (the defaults)
const fs = require('fs/promises');
const path = require('path');
const { writeFileAtomic, readJsonFile } = require('../../utils/configIO');
const {
  updateBranchPath, updateStatusPath, updateCheckPath, updateNoticePath, updateRequestPath, updateSchedulePath,
  systemdDir,
} = require('../../utils/pathHelpers');
const { DEFAULT } = require('./schedule');

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

// The schedule file as KEY=value lines (the last value of a key wins, like update.sh's first
// match would for a file written only here)
async function readScheduleLines() {
  const text = await fs.readFile(updateSchedulePath(), 'utf8').catch(() => '');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^NOTICEBOARD_UPDATE_([A-Z]+)=(.*)$/);
    if (m && !(m[1] in values)) values[m[1]] = m[2].trim();
  }
  return values;
}

function writeScheduleLines(values) {
  const text = ['EVERY', 'TIME', 'DAY', 'SINCE', 'AT']
    .filter((k) => values[k] !== undefined && values[k] !== null && values[k] !== '')
    .map((k) => `NOTICEBOARD_UPDATE_${k}=${values[k]}\n`).join('');
  return writeFileAtomic(updateSchedulePath(), text);
}

// What update.sh will use: its own defaults for anything missing or not understood
async function readSchedule() {
  const v = await readScheduleLines();
  const every = ['15min', '2h', 'daily', 'weekly', 'manual'].includes(v.EVERY) ? v.EVERY : DEFAULT.every;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.TIME ?? '') ? v.TIME : DEFAULT.time;
  const day = /^[0-6]$/.test(v.DAY ?? '') ? Number(v.DAY) : DEFAULT.day;
  const at = v.AT && !Number.isNaN(Date.parse(v.AT)) ? v.AT : null;
  return { every, time, day, at };
}

async function saveSchedule({ every, time, day }) {
  const v = await readScheduleLines();
  await writeScheduleLines({ EVERY: every, TIME: time, DAY: String(day), SINCE: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), AT: v.AT });
}

async function saveInstallAt(at) {
  const v = await readScheduleLines();
  await writeScheduleLines({ ...v, AT: at });
}

function requestRun(what) {
  return writeFileAtomic(updateRequestPath(), `${what}\n`);
}

async function saveInstallNow(status) {
  await writeFileAtomic(updateStatusPath(), `${JSON.stringify(status)}\n`);
  await requestRun('install-now');
}

async function saveRestoreRequest(status) {
  await writeFileAtomic(updateStatusPath(), `${JSON.stringify(status)}\n`);
  await requestRun('restore-defaults');
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
  readSchedule,
  saveSchedule,
  saveInstallAt,
  requestRun,
  saveInstallNow,
  saveRestoreRequest,
  saveSwitch,
};
