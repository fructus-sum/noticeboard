// The shared foundations behave exactly like the copies they replaced (SYSTEM_DESIGN §14 D6, D7, D14,
// D18): the address helpers, the "the Server itself" rule for MAC filtering, the media type lists and
// the socket event names. Also the media name rule and what the admin panel shows as a name (D38).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainAddress, isLoopback, lanInterfaces } = require('../utils/network');
const { isLocalhost, lookupMac } = require('../utils/macLookup');
const mediaTypes = require('../services/mediaTypes');
const contract = require('../../shared/contract.json');

test('plainAddress strips the IPv4-in-IPv6 prefix, like normalizeIp and device.js did', () => {
  assert.equal(plainAddress('::ffff:192.168.1.20'), '192.168.1.20');
  assert.equal(plainAddress('192.168.1.20'), '192.168.1.20');
  assert.equal(plainAddress('::1'), '::1');
  assert.equal(plainAddress('fe80::1'), 'fe80::1');
  assert.equal(plainAddress(''), '');
  assert.equal(plainAddress(undefined), '');
  assert.equal(plainAddress(null), '');
});

test('isLoopback: the kiosk-exit rule (the whole 127.0.0.0/8 range and ::1)', () => {
  for (const a of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '::ffff:127.0.0.1', '::ffff:127.1.2.3']) assert.equal(isLoopback(a), true, a);
  for (const a of ['192.168.1.20', '::ffff:192.168.1.20', '', undefined, '::11', '10.127.0.1']) assert.equal(isLoopback(a), false, String(a));
});

test('isLocalhost: the MAC-filter rule (exact addresses; an empty one is not the Server, 0.6.4)', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) assert.equal(isLocalhost(a), true, String(a));
  for (const a of ['127.0.0.2', '192.168.1.20', '::ffff:192.168.1.20', '', undefined]) assert.equal(isLocalhost(a), false, String(a));
});

test('an empty address has no MAC, so MAC filtering refuses it (0.6.4)', async () => {
  assert.equal(await lookupMac(''), null);
  assert.equal(await lookupMac(undefined), null);
});

test('lanInterfaces lists IPv4, non-internal interfaces with name, ip and mac', () => {
  for (const i of lanInterfaces()) {
    assert.deepEqual(Object.keys(i).sort(), ['ip', 'mac', 'name']);
    assert.match(i.ip, /^\d+\.\d+\.\d+\.\d+$/);
    assert.notEqual(i.ip, '127.0.0.1');
  }
});

test('media type lists are exactly the ones their callers had', () => {
  assert.deepEqual([...mediaTypes.IMAGE_MIME], ['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  assert.deepEqual([...mediaTypes.VIDEO_MIME], ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg']);
  assert.deepEqual(mediaTypes.LOGO_MIME, ['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  assert.deepEqual(mediaTypes.SERVED_EXTENSIONS, ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.ogg']);
  assert.equal(mediaTypes.typeFromMime('image/webp'), 'image');
  assert.equal(mediaTypes.typeFromMime('video/quicktime'), 'video');
  assert.equal(mediaTypes.typeFromMime('text/plain'), null);
  for (const f of ['01-a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp']) assert.ok(mediaTypes.SAMPLE_IMAGE_EXT.test(f), f);
  for (const f of ['03-video.mp4', 'x.WEBM']) assert.ok(mediaTypes.SAMPLE_VIDEO_EXT.test(f), f);
  for (const f of ['sample.json', 'a.mov', 'a.png.txt']) assert.ok(!mediaTypes.SAMPLE_IMAGE_EXT.test(f) && !mediaTypes.SAMPLE_VIDEO_EXT.test(f), f);
});

test('socket event names in the shared contract are the ones open screens use', () => {
  assert.deepEqual(contract.socketEvents, {
    DISPLAY_READY: 'display:ready',
    PLAYLIST_UPDATE: 'playlist:update',
    DISPLAY_BUILD: 'display:build',
    DISPLAY_SETTINGS: 'display:settings',
    AUDIO_UPDATE: 'audio:update',   // added for background audio (§18.3); older screens ignore it
    TIME_PING: 'time:ping',         // added for screens in step (§18.8): a screen asks the time
    TIME_PONG: 'time:pong',         //   … and the Server answers with its own
  });
});

// shared/index.js is an ES module for the web apps (built by Vite, which reads contract.json
// itself), so it is loaded here with the contract written in
async function sharedModule() {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../shared/index.js'), 'utf8')
    .replace(/^import contract from '\.\/contract\.json';$/m, `const contract = ${JSON.stringify(contract)};`);
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test('the web apps make the same media URLs as the server, and use the same limits', async () => {
  const shared = await sharedModule();
  const { mediaUrl } = require('../utils/pathHelpers');
  for (const [folder, file] of [['sample', '01-welcome.png'], ['my-slideshow', '1700000000000-a1b2.mp4'], ['x', 'thumb-1.jpg']]) {
    assert.equal(shared.mediaUrl(folder, file), mediaUrl(folder, file));
  }
  assert.equal(shared.mediaUrl('my-slideshow', 'a.png'), '/media/my-slideshow/slides/a.png');
  const { audioUrl } = require('../utils/pathHelpers');
  assert.equal(shared.audioUrl('cafe-music', 'x.m4a'), audioUrl('cafe-music', 'x.m4a'));
  assert.equal(shared.audioUrl('cafe-music', 'x.m4a'), '/audio/cafe-music/tracks/x.m4a');
  assert.deepEqual(shared.AUDIO, contract.audio);
  assert.deepEqual(shared.LIMITS, { passwordMinLength: 8, slideSeconds: { min: 1, max: 3600 }, mediaNameMax: 200, port: { min: 1024, max: 65535, default: 3000 } });
  assert.deepEqual(shared.SOCKET_EVENTS, contract.socketEvents);
});

test('the installer command: main and a Release as they are, a development branch asked for by name (§18.7)', async () => {
  const shared = await sharedModule();
  const url = (ref) => `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/${ref}/installers/install.sh`;
  assert.equal(shared.installerCommand(), `${url('main')} | sudo bash`);
  assert.equal(shared.installerCommand('v0.9.0'), `${url('v0.9.0')} | sudo bash`);
  assert.equal(shared.installerCommand('feature/releases-installer'),
    `${url('feature/releases-installer')} | sudo NOTICEBOARD_INSTALL_BRANCH=feature/releases-installer bash`);
});

test('media names: the rule the server stores names by (D38)', () => {
  const { MAX_LENGTH, cleanName, nameFromUpload } = require('../services/mediaNames');
  assert.equal(MAX_LENGTH, contract.limits.mediaNameMax);
  assert.equal(cleanName('  Summer fair.jpg \n'), 'Summer fair.jpg');
  assert.equal(cleanName('a\u0000b\u001fc\u007fd'), 'abcd');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('Café – 日本'), 'Café – 日本');
  assert.equal(nameFromUpload('C:\\Users\\me\\Pictures\\poster.png'), 'poster.png');
  assert.equal(nameFromUpload('dir/sub/poster.png'), 'poster.png');
  assert.equal(nameFromUpload(''), null);
  assert.equal(nameFromUpload(undefined), null);
  assert.equal([...nameFromUpload('é'.repeat(300))].length, MAX_LENGTH);   // cut, never refused
});

test('mediaDisplayName: own name, else the uploaded name, else type and date added', async () => {
  const { mediaDisplayName } = await sharedModule();
  assert.equal(mediaDisplayName({ name: 'Front desk', originalName: 'IMG_1.png', type: 'image' }), 'Front desk');
  assert.equal(mediaDisplayName({ originalName: 'IMG_1.png', type: 'image' }), 'IMG_1.png');
  assert.equal(mediaDisplayName({ name: '', originalName: 'IMG_1.png', type: 'image' }), 'IMG_1.png');
  const old = mediaDisplayName({ type: 'video', addedAt: '2026-03-12T14:02:00.000Z', originalName: null });
  assert.match(old, /^Video, added .*2026/);
  assert.equal(mediaDisplayName({ type: 'image' }), 'Image');
  assert.equal(mediaDisplayName({ type: 'image', addedAt: 'not a date' }), 'Image');
});
