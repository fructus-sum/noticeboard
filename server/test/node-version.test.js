// The Node.js version rule exists twice: in the installer (installers/lib/system.sh node_new_enough,
// which runs before the repository exists) and in system-requirements.json (checked by the server
// before a branch switch). Both must accept and refuse the same versions (OLD_SYSTEM_DESIGN D29).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { satisfies, parseVersion } = require('../utils/systemCheck');

const ROOT = path.resolve(__dirname, '../..');

// The installer evaluates `process.exit(<condition> ? 0 : 1)` with major and minor from process.versions
function installerAccepts(version) {
  const script = fs.readFileSync(path.join(ROOT, 'installers/lib/system.sh'), 'utf8');
  const body = script.match(/node_new_enough\(\) \{[\s\S]*?process\.exit\(([\s\S]*?) \? 0 : 1\)/);
  assert.ok(body, 'node_new_enough found in installers/lib/system.sh');
  const [major, minor] = version.split('.').map(Number);
  return new Function('major', 'minor', `return ${body[1]};`)(major, minor);
}

test('the installer and system-requirements.json accept the same Node.js versions', () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'system-requirements.json'), 'utf8'));
  const range = list.software.find((s) => s.name === 'Node.js').versions;
  for (const v of ['18.20.0', '20.0.0', '20.18.3', '20.19.0', '20.20.2', '21.7.3', '22.0.0', '22.11.0', '22.12.0', '23.0.0', '24.15.0', '26.1.0']) {
    assert.equal(installerAccepts(v), satisfies(parseVersion(v), range), `Node.js ${v}`);
  }
});
