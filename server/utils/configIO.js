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

function readConfigSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON5.parse(raw);
}

module.exports = { readConfig, writeConfig, readConfigSync };
