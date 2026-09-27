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
//   readJsonFile(path)     → object | null    plain JSON, synchronously; null if missing or broken
//
// Used by
//   configService (config.json), services/slideshowStore (slideshow.json), and the shell scripts:
//   installers/update.sh and install.sh run `node -e "require('./server/utils/configIO').readConfig(…)"`
//   to find the port. That file path and readConfig must not change (OLD_SYSTEM_DESIGN §15).
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

async function readConfig(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return JSON5.parse(raw);
}

async function writeConfig(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readConfigSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON5.parse(raw);
}

module.exports = { readConfig, writeConfig, readJsonFile, readConfigSync };
