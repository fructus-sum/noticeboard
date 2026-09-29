// When the admin panel says to run the installer again: the version install.sh records against
// the one system-requirements.json asks for. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { installerNeeds } = require('../services/updates/installerVersion');

const ROOT = path.resolve(__dirname, '../..');
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'system-requirements.json'), 'utf8'));

test('install.sh and system-requirements.json give the same installer version', () => {
  const script = fs.readFileSync(path.join(ROOT, 'installers/install.sh'), 'utf8');
  const match = script.match(/^INSTALLER_VERSION=(\d+)$/m);
  assert.ok(match, 'install.sh sets INSTALLER_VERSION');
  assert.equal(Number(match[1]), list.installer.version);
});

test('every installer version up to the current one says what it brings', () => {
  const versions = list.installer.changes.map((c) => c.version);
  for (let v = 1; v <= list.installer.version; v++) assert.ok(versions.includes(v), `a change for version ${v}`);
  assert.ok(list.installer.changes.every((c) => typeof c.change === 'string' && c.change.length > 0));
});

const sample = {
  installer: {
    version: 3,
    changes: [
      { version: 1, change: 'one', displays: true },
      { version: 2, change: 'two' },
      { version: 3, change: 'three' },
    ],
  },
};

test('an older installer run: needed, with only the changes it missed', () => {
  assert.deepEqual(installerNeeds(sample, 1), { required: 3, installed: 1, needed: true, changes: ['two', 'three'], displays: false, clientsFollow: false });
  assert.deepEqual(installerNeeds(sample, 0).displays, true);
});

test('a change for the Clients: a run on each by hand before installer 7, by themselves from 7 on', () => {
  const list = { installer: { version: 8, changes: [
    { version: 6, change: 'six' }, { version: 7, change: 'seven', displays: true }, { version: 8, change: 'eight', displays: true },
  ] } };
  const before = installerNeeds(list, 5);
  assert.deepEqual([before.displays, before.clientsFollow], [true, false]);
  const after = installerNeeds(list, 7);
  assert.deepEqual([after.needed, after.displays, after.clientsFollow], [true, false, true]);
  const serverOnly = installerNeeds({ installer: { version: 8, changes: [{ version: 8, change: 'eight' }] } }, 7);
  assert.deepEqual([serverOnly.displays, serverOnly.clientsFollow], [false, false]);
});

test('an up-to-date or newer installer run: not needed', () => {
  assert.equal(installerNeeds(sample, 3).needed, false);
  assert.equal(installerNeeds(sample, 5).needed, false);
  assert.deepEqual(installerNeeds(sample, 3).changes, []);
});

test('not set up by the installer, or a version without an installer list: nothing to say', () => {
  assert.equal(installerNeeds(sample, null).needed, false);
  assert.deepEqual(installerNeeds({ software: [] }, 0), { required: 0, installed: 0, needed: false, changes: [], displays: false, clientsFollow: false });
  assert.equal(installerNeeds(null, 0).needed, false);
  assert.equal(installerNeeds({ installer: { version: '9' } }, 0).needed, false);
});
