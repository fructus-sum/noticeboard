// Delete All (SYSTEM_DESIGN §14 D40): the admin password gives a one-time token for that action
// only; with it, every slideshow except the sample is deleted, with its folder, and the screens
// are sent the new playlist; the sample, the settings and the logo are kept. Wrong passwords are
// counted together with the branch switch's (5 per 15 minutes).
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, check, done, sleep } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

const png = (colour) => sharp({ create: { width: 64, height: 36, channels: 3, background: colour } }).png().toBuffer();

(async () => {
  const env = makeApp({ port: 3944, keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();

  // Content and settings to delete or keep
  const folders = [];
  for (const [name, colour] of [['Front desk', '#39c'], ['Canteen', '#c93']]) {
    const folder = (await s.api('POST', '/api/slideshows', { name })).data.folder;
    folders.push(folder);
    const form = new FormData();
    form.append('files', new Blob([await png(colour)], { type: 'image/png' }), `${folder}.png`);
    await s.api('POST', `/api/slideshows/${folder}/slides`, form);
    await s.api('PUT', `/api/slideshows/${folder}`, { enabled: true });
  }
  await s.api('PUT', '/api/settings', { display: { backgroundColor: '#123456' } });
  const logo = new FormData();
  logo.append('logo', new Blob([await png('#f0f')], { type: 'image/png' }), 'logo.png');
  await s.api('POST', '/api/settings/logo', logo);
  await sleep(1500);
  const before = (await s.api('GET', '/api/slideshows')).data;
  const sample = before.find((x) => x.sample);
  check('set up: the sample and two slideshows', !!sample && before.length === 3);
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });   // the sample's own state is kept
  // An audio show (with an event), chosen as the sample's background audio
  const music = (await s.api('POST', '/api/audioshows', { name: 'Lobby music' })).data.folder;
  await s.api('PUT', `/api/audioshows/${music}/event`, { mode: 'now' });
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { audioShow: music });
  check('set up: an audio show, chosen by the sample', (await s.api('GET', `/api/slideshows/${sample.folder}`)).data.audioShow === music);

  const display = io(env.base, { transports: ['websocket'] });
  const playlists = [];
  display.on('connect', () => display.emit('display:ready'));
  display.on('playlist:update', (p) => playlists.push(p));
  await sleep(1500);

  // The password step
  const noAction = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345' });
  check('an unknown action is refused (400)', noAction.status === 400);
  const wrong = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'nope', action: 'delete-all' });
  check('a wrong password: 403, nothing changed', wrong.status === 403 && /Incorrect password/.test(wrong.data?.error));
  const noToken = await s.api('POST', '/api/settings/maintenance/delete-all', {});
  check('no token: 403, nothing deleted', noToken.status === 403 && (await s.api('GET', '/api/slideshows')).data.length === 3);

  // A branch-switch token is not a Delete All token
  const switchToken = await s.api('POST', '/api/settings/updates/verify-password', { password: 'Admin@12345', branch: 'main' });
  const crossed = await s.api('POST', '/api/settings/maintenance/delete-all', { token: switchToken.data?.token });
  check('a token for another action doesn\'t work', switchToken.status === 200 && crossed.status === 403);

  const ok = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'delete-all' });
  check('the right password gives a token', ok.status === 200 && typeof ok.data?.token === 'string');
  const shown = playlists.length;
  const del = await s.api('POST', '/api/settings/maintenance/delete-all', { token: ok.data.token });
  check('Delete All answers with the names deleted', del.status === 200 && JSON.stringify(del.data?.deleted?.sort()) === JSON.stringify(['Canteen', 'Front desk'])
    && JSON.stringify(del.data?.deletedAudio) === JSON.stringify(['Lobby music']), JSON.stringify(del.data));
  check('the audio shows are gone, with their folders', (await s.api('GET', '/api/audioshows')).data.length === 0 && !fs.existsSync(path.join(env.APP, 'data', 'audioshows', music)));
  check('  … and the sample no longer has background audio', !('audioShow' in (await s.api('GET', `/api/slideshows/${sample.folder}`)).data));

  const after = (await s.api('GET', '/api/slideshows')).data;
  check('only the sample is left, as it was (still published)', after.length === 1 && after[0].sample && after[0].enabled === true);
  check('the deleted slideshows\' folders are gone', folders.every((f) => !fs.existsSync(path.join(env.APP, 'data', 'slideshows', f))));
  check('the sample\'s folder is kept', fs.existsSync(path.join(env.APP, 'data', 'slideshows', sample.folder, 'slideshow.json')));
  const settings = (await s.api('GET', '/api/settings')).data;
  check('the settings are kept', settings.display?.backgroundColor === '#123456');
  check('the logo is kept', fs.existsSync(path.join(env.APP, 'data', 'branding', 'logo.png')) && (await s.api('GET', '/api/settings/logo')).data?.custom === true, JSON.stringify((await s.api('GET', '/api/settings/logo')).data));
  await sleep(1500);
  const last = playlists[playlists.length - 1];
  check('the screens were sent the new playlist, without the deleted slideshows', playlists.length > shown && last.slides.every((x) => x.slideshow === sample.folder), `${playlists.length - shown} sent`);

  const reused = await s.api('POST', '/api/settings/maintenance/delete-all', { token: ok.data.token });
  check('a token works once', reused.status === 403);

  // Wrong passwords count together across the password checks: 1 above, then 3 here + 1 on the switch
  for (let i = 0; i < 3; i++) await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'nope', action: 'delete-all' });
  await s.api('POST', '/api/settings/updates/verify-password', { password: 'nope', branch: 'main' });
  const limited = await s.api('POST', '/api/settings/maintenance/verify-password', { password: 'Admin@12345', action: 'delete-all' });
  check('after 5 wrong passwords (in either place), further tries are refused (429)', limited.status === 429, `HTTP ${limited.status}`);

  display.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
