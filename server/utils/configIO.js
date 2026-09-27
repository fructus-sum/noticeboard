// server/utils/configIO.js — reading and writing the JSON files in data/
//
// Responsibilities
//   The file formats: config.json may contain comments (JSON5, so an admin can annotate it);
//   everything is written as plain, pretty-printed JSON, replaced in one step (a temporary file,
//   then a rename), so a reader never sees half a file.
//
// Provides
//   readConfig(path)       → Promise<object>  JSON5; throws if missing or unreadable
//   writeConfig(path, v)   → Promise          atomic pretty JSON (creates the folder)
//   writeFileAtomic(path, text, { tmpSuffix })  → Promise  any text, replaced in one step
//                          (creates the folder); the temporary file is <path><tmpSuffix>,
//                          by default .<process id>.tmp
//   readJsonFile(path)     → object | null    plain JSON, synchronously; null if missing or broken
//
// Used by
//   configService (config.json), services/slideshowStore (slideshow.json),
//   services/updates/updateFiles (the files shared with update.sh), and the shell scripts:
//   installers/update.sh and install.sh run `node -e "require('./server/utils/configIO').readConfig(…)"`
//   to find the port. That file path and readConfig must not change (OLD_SYSTEM_DESIGN §15).
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

async function readConfig(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return JSON5.parse(raw);
}

async function writeFileAtomic(filePath, text, { tmpSuffix = `.${process.pid}.tmp` } = {}) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + tmpSuffix;
  await fs.promises.writeFile(tmpPath, text, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

function writeConfig(filePath, data) {
  return writeFileAtomic(filePath, JSON.stringify(data, null, 2), { tmpSuffix: '.tmp' });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { readConfig, writeConfig, writeFileAtomic, readJsonFile };
