// Stage 1 foundations behave exactly like the copies they replaced (OLD_SYSTEM_DESIGN D6, D7, D14,
// D18): the address helpers, the "this Pi itself" rule for MAC filtering, the media type lists and
// the socket event names.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainAddress, isLoopback, lanInterfaces } = require('../utils/network');
const { isLocalhost } = require('../utils/macLookup');
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

test('isLocalhost: the MAC-filter rule is unchanged (exact addresses, and an empty one)', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '', undefined]) assert.equal(isLocalhost(a), true, String(a));
  for (const a of ['127.0.0.2', '192.168.1.20', '::ffff:192.168.1.20']) assert.equal(isLocalhost(a), false, a);
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
  });
});
